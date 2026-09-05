import {
  createSecretKey,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  importSPKI,
  jwtVerify,
  SignJWT,
  type CryptoKey,
} from "jose";
import { z } from "zod";
import type {
  AdmissionExpectedScope,
  ExactGameRelease,
  GameHostAdmissionPort,
  JsonObject,
  PendingPlatformAdmission,
  PendingTransferAdmission,
  RegistryFence,
  SurfaceAdmission,
  TransferAdmission,
  TransferCapability,
  TransferRequest,
} from "@thorium/game-host-api";
import { canonicalJson, sha256 } from "./canonical-json.js";
import type { NonceStore } from "./nonce-store.js";
import { physicalRoomName } from "./room-name.js";

const Release = z.strictObject({
  packageId: z.string().max(128).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
  packageVersion: z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const Surface = z.strictObject({
  sub: z.string().min(16).max(256),
  jti: z.string().uuid(),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  gameSessionId: z.string().uuid(),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  surfaceId: z.string().min(1).max(64),
  role: z.enum(["main", "companion"]),
  playerSlots: z.array(z.number().int().min(0).max(15)).max(16),
  roomName: z.string().regex(/^g_[a-f0-9]{32}$/),
  joinOptionsHash: z.string().regex(/^[a-f0-9]{64}$/),
  ...Release.shape,
});
const Fence = z.strictObject({
  gameSessionId: z.string().uuid(),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  roomInstanceId: z.string().min(1).max(128),
  release: z.strictObject({
    packageId: Release.shape.packageId,
    version: Release.shape.packageVersion,
    contentDigest: Release.shape.packageDigest,
  }),
});
const Transfer = Surface.extend({
  sourceCapabilityId: z.string().uuid(),
  fence: Fence,
  moduleClaims: z.record(z.string(), z.unknown()),
}).strict();

type PlatformClaims = z.infer<typeof Surface>;
type TransferClaims = z.infer<typeof Transfer>;

function applicationClaims(payload: Record<string, unknown>): Record<string, unknown> {
  // `jwtVerify` validates these registered claims. They remain outside the
  // strict game-specific schema so an unexpected application claim is still
  // rejected instead of silently accepted.
  const { iss: _issuer, aud: _audience, ...claims } = payload;
  return claims;
}

interface PendingPlatformRecord {
  readonly claims: PlatformClaims;
}

interface PendingTransferRecord {
  readonly claims: TransferClaims;
}

function sameRelease(left: ExactGameRelease, right: ExactGameRelease): boolean {
  return left.packageId === right.packageId && left.version === right.version
    && left.contentDigest === right.contentDigest;
}

function releaseFromClaims(claims: PlatformClaims): ExactGameRelease {
  return {
    packageId: claims.packageId,
    version: claims.packageVersion,
    contentDigest: claims.packageDigest,
  };
}

function surfaceFromClaims(claims: PlatformClaims): SurfaceAdmission {
  return {
    accountScope: claims.sub,
    capabilityId: claims.jti,
    expiresAtEpochMs: claims.exp * 1_000,
    gameSessionId: claims.gameSessionId,
    generation: claims.generation,
    release: releaseFromClaims(claims),
    surfaceId: claims.surfaceId,
    role: claims.role,
    playerSlots: claims.playerSlots,
  };
}

function boundedJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}_must_be_an_object`);
  }
  let members = 0;
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 8) throw new Error(`${label}_too_deep`);
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new Error(`${label}_invalid_number`);
      return;
    }
    if (Array.isArray(candidate)) {
      members += candidate.length;
      if (members > 256) throw new Error(`${label}_too_many_members`);
      for (const member of candidate) visit(member, depth + 1);
      return;
    }
    if (typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      const keys = Object.keys(record);
      members += keys.length;
      if (members > 256) throw new Error(`${label}_too_many_members`);
      for (const key of keys) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          throw new Error(`${label}_unsafe_key`);
        }
        visit(record[key], depth + 1);
      }
      return;
    }
    throw new Error(`${label}_invalid_value`);
  };
  visit(value, 0);
  const canonical = canonicalJson(value);
  if (Buffer.byteLength(canonical) > 4_096) throw new Error(`${label}_too_large`);
  return JSON.parse(canonical) as JsonObject;
}

function hashJoinOptions(options: JsonObject): string {
  return sha256(canonicalJson(boundedJsonObject(options, "join_options")));
}

function assertScope(
  claims: PlatformClaims,
  release: ExactGameRelease,
  expected: AdmissionExpectedScope,
): void {
  if (
    !sameRelease(releaseFromClaims(claims), release)
    || claims.roomName !== physicalRoomName(release, expected.localRoomName)
    || !timingSafeEqual(
      Buffer.from(claims.joinOptionsHash, "hex"),
      Buffer.from(hashJoinOptions(expected.joinOptions), "hex"),
    )
  ) throw new Error("admission_scope_mismatch");
}

export interface AdmissionServiceOptions {
  readonly endpoint: string;
  readonly nonceStore: NonceStore;
  readonly platformPublicKeyPem: string;
  readonly transferSecret: string;
  readonly now?: () => Date;
}

export class AdmissionService {
  readonly #endpoint: string;
  readonly #nonceStore: NonceStore;
  readonly #platformKey: Promise<CryptoKey>;
  readonly #transferKey: ReturnType<typeof createSecretKey>;
  readonly #now: () => Date;
  readonly #pendingPlatform = new WeakMap<object, PendingPlatformRecord>();
  readonly #pendingTransfer = new WeakMap<object, PendingTransferRecord>();

  constructor(options: AdmissionServiceOptions) {
    if (Buffer.byteLength(options.transferSecret) < 32) {
      throw new Error("transfer signing secret must be at least 32 bytes");
    }
    this.#endpoint = options.endpoint;
    this.#nonceStore = options.nonceStore;
    this.#platformKey = importSPKI(options.platformPublicKeyPem, "EdDSA");
    this.#transferKey = createSecretKey(Buffer.from(options.transferSecret));
    this.#now = options.now ?? (() => new Date());
  }

  async ready(): Promise<void> {
    await this.#platformKey;
  }

  scoped(
    release: ExactGameRelease,
    isRegisteredLocalRoom: (name: string) => boolean,
    isFenceActive: (fence: RegistryFence) => Promise<boolean>,
  ): GameHostAdmissionPort {
    return {
      verifyPlatform: async (token, expected) => {
        if (!isRegisteredLocalRoom(expected.localRoomName)) throw new Error("room_not_registered");
        const { payload } = await jwtVerify(token, await this.#platformKey, {
          algorithms: ["EdDSA"],
          issuer: "thorium-platform",
          audience: "thorium-game-host",
          currentDate: this.#now(),
        });
        const claims = Surface.parse(applicationClaims(payload));
        const nowSeconds = Math.floor(this.#now().getTime() / 1_000);
        if (claims.iat > nowSeconds + 5 || claims.exp - claims.iat > 120) {
          throw new Error("invalid_admission_lifetime");
        }
        assertScope(claims, release, expected);
        const pending = Object.freeze({}) as PendingPlatformAdmission;
        this.#pendingPlatform.set(pending, { claims });
        return pending;
      },
      consumePlatform: async (pending) => {
        const record = this.#pendingPlatform.get(pending);
        if (record === undefined) throw new Error("invalid_or_consumed_pending_admission");
        this.#pendingPlatform.delete(pending);
        this.#nonceStore.consume(
          `platform:${record.claims.jti}`,
          record.claims.exp,
          Math.floor(this.#now().getTime() / 1_000),
        );
        return surfaceFromClaims(record.claims);
      },
      issueTransfer: async (source, fence, request) => {
        if (!sameRelease(source.release, release) || !sameRelease(fence.release, release)) {
          throw new Error("transfer_release_scope_mismatch");
        }
        if (
          source.gameSessionId !== fence.gameSessionId
          || source.generation !== fence.generation
          || !isRegisteredLocalRoom(request.targetLocalRoomName)
        ) throw new Error("transfer_parent_scope_mismatch");
        if (!await isFenceActive(fence)) {
          throw new Error("inactive_or_superseded_registry_fence");
        }
        const moduleClaims = boundedJsonObject(request.moduleClaims, "module_claims");
        const joinOptions = boundedJsonObject(request.joinOptions, "join_options");
        const nowSeconds = Math.floor(this.#now().getTime() / 1_000);
        const requestedLifetime = request.expiresInSeconds ?? 30;
        if (!Number.isInteger(requestedLifetime) || requestedLifetime < 1 || requestedLifetime > 30) {
          throw new Error("invalid_transfer_lifetime");
        }
        // The durable registry fence, not an already-consumed ticket's expiry,
        // is the renewable authority for a running session. Every transfer is
        // still independently one-use and capped at 30 seconds.
        const expiry = nowSeconds + requestedLifetime;
        const roomName = physicalRoomName(release, request.targetLocalRoomName);
        const token = await new SignJWT({
          gameSessionId: source.gameSessionId,
          generation: source.generation,
          packageId: release.packageId,
          packageVersion: release.version,
          packageDigest: release.contentDigest,
          surfaceId: source.surfaceId,
          role: source.role,
          playerSlots: [...source.playerSlots],
          roomName,
          joinOptionsHash: hashJoinOptions(joinOptions),
          sourceCapabilityId: source.capabilityId,
          fence,
          moduleClaims,
        })
          .setProtectedHeader({ alg: "HS256", typ: "thorium-room-transfer+jwt" })
          .setIssuer("thorium-game-host")
          .setAudience("thorium-game-host-transfer")
          .setSubject(source.accountScope)
          .setJti(randomUUID())
          .setIssuedAt(nowSeconds)
          .setExpirationTime(expiry)
          .sign(this.#transferKey);
        return {
          endpoint: this.#endpoint,
          roomName,
          token,
          expiresAtEpochMs: expiry * 1_000,
          joinOptions,
        } satisfies TransferCapability;
      },
      verifyTransfer: async (token, expected) => {
        if (!isRegisteredLocalRoom(expected.localRoomName)) throw new Error("room_not_registered");
        const { payload } = await jwtVerify(token, this.#transferKey, {
          algorithms: ["HS256"],
          issuer: "thorium-game-host",
          audience: "thorium-game-host-transfer",
          currentDate: this.#now(),
        });
        const claims = Transfer.parse(applicationClaims(payload));
        const nowSeconds = Math.floor(this.#now().getTime() / 1_000);
        if (claims.iat > nowSeconds + 5 || claims.exp - claims.iat > 30) {
          throw new Error("invalid_transfer_lifetime");
        }
        assertScope(claims, release, expected);
        const pending = Object.freeze({}) as PendingTransferAdmission;
        this.#pendingTransfer.set(pending, { claims });
        return pending;
      },
      consumeTransfer: async (pending) => {
        const record = this.#pendingTransfer.get(pending);
        if (record === undefined) throw new Error("invalid_or_consumed_pending_transfer");
        this.#pendingTransfer.delete(pending);
        this.#nonceStore.consume(
          `transfer:${record.claims.jti}`,
          record.claims.exp,
          Math.floor(this.#now().getTime() / 1_000),
        );
        return {
          source: surfaceFromClaims(record.claims),
          fence: record.claims.fence,
          moduleClaims: boundedJsonObject(record.claims.moduleClaims, "module_claims"),
        } satisfies TransferAdmission;
      },
    };
  }
}
