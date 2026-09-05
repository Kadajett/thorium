import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT, type CryptoKey } from "jose";
import type { ExactGameRelease, GameSessionActivation } from "../session-registry/game-session-registry.js";
import type { PreparedSessionTicketIssue, SessionTicketBundle } from "./session-ticket-service.js";

const LOCAL_ROOM_NAME = "game_session";
const HOST_AUDIENCE = "thorium-game-host";
const HOST_ISSUER = "thorium-platform";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_canonical_json");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  throw new Error("unsupported_canonical_json_value");
}

export function sharedHostPhysicalRoomName(
  release: ExactGameRelease,
  localRoomName = LOCAL_ROOM_NAME,
): string {
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(localRoomName)) throw new Error("invalid_local_room_name");
  const scope = [
    release.packageId,
    release.version,
    release.contentDigest,
    localRoomName,
  ].join("\0");
  return `g_${createHash("sha256").update(scope).digest("hex").slice(0, 32)}`;
}

export interface SharedGameHostAuthorityOptions {
  readonly endpoint: string;
  readonly admissionPrivateKeyFile: string;
  readonly serviceTokenFile: string;
  readonly scopeSecret: string;
  readonly now?: () => Date;
  readonly readSecret?: (path: string) => string;
}

/**
 * The single trusted boundary between Thorium Platform and the shared game host.
 * Game modules receive host-owned ports and never receive this key or service token.
 */
export class SharedGameHostAuthority {
  readonly #endpoint: string;
  readonly #signingKey: Promise<CryptoKey>;
  readonly #serviceToken: Buffer;
  readonly #scopeSecret: string;
  readonly #now: () => Date;

  constructor(options: SharedGameHostAuthorityOptions) {
    const endpoint = new URL(options.endpoint);
    if (
      endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== ""
      || endpoint.search !== "" || endpoint.hash !== ""
    ) throw new Error("invalid_game_host_public_endpoint");
    const readSecret = options.readSecret ?? ((path: string) => readFileSync(path, "utf8"));
    const privateKey = readSecret(options.admissionPrivateKeyFile);
    const serviceToken = readSecret(options.serviceTokenFile).trim();
    if (
      serviceToken.length < 32 || serviceToken.length > 4_096 || /\s/.test(serviceToken)
    ) throw new Error("invalid_game_host_service_token");
    if (options.scopeSecret.length < 32) throw new Error("invalid_game_host_scope_secret");

    this.#endpoint = endpoint.toString().replace(/\/$/, "");
    this.#signingKey = importPKCS8(privateKey, "EdDSA");
    this.#serviceToken = Buffer.from(serviceToken);
    this.#scopeSecret = options.scopeSecret;
    this.#now = options.now ?? (() => new Date());
  }

  async ready(): Promise<void> {
    await this.#signingKey;
  }

  authenticateService(token: string): boolean {
    const candidate = Buffer.from(token);
    return candidate.byteLength === this.#serviceToken.byteLength
      && timingSafeEqual(candidate, this.#serviceToken);
  }

  async issueBundle(
    prepared: PreparedSessionTicketIssue,
    activation: GameSessionActivation,
  ): Promise<SessionTicketBundle> {
    const release = activation.release;
    const roomName = sharedHostPhysicalRoomName(release);
    const joinOptions = {
      gameSessionId: activation.gameSessionId,
      packageId: release.packageId,
      packageVersion: release.version,
      packageDigest: release.contentDigest,
    };
    const joinOptionsHash = createHash("sha256")
      .update(canonicalJson(joinOptions))
      .digest("hex");
    const accountScope = createHmac("sha256", this.#scopeSecret)
      .update(prepared.account.accountId)
      .update("\0")
      .update(release.packageId)
      .digest("base64url");
    const nowSeconds = Math.floor(this.#now().getTime() / 1_000);
    const expiresAtSeconds = Math.min(prepared.expiresAtEpochSeconds, nowSeconds + 60);
    if (expiresAtSeconds <= nowSeconds) throw new Error("account_session_expiring");

    const surfaces = await Promise.all(activation.surfaces.map(async (surface) => ({
      surfaceId: surface.surfaceId,
      role: surface.role,
      playerSlots: [...surface.playerSlots],
      ticket: await new SignJWT({
        gameSessionId: activation.gameSessionId,
        generation: activation.generation,
        packageId: release.packageId,
        packageVersion: release.version,
        packageDigest: release.contentDigest,
        surfaceId: surface.surfaceId,
        role: surface.role,
        playerSlots: [...surface.playerSlots],
        roomName,
        joinOptionsHash,
      })
        .setProtectedHeader({ alg: "EdDSA", typ: "thorium-game-admission+jwt" })
        .setIssuer(HOST_ISSUER)
        .setAudience(HOST_AUDIENCE)
        .setSubject(accountScope)
        .setJti(surface.capabilityId ?? randomUUID())
        .setIssuedAt(nowSeconds)
        .setExpirationTime(expiresAtSeconds)
        .sign(await this.#signingKey),
    })));

    return {
      endpoint: this.#endpoint,
      gameSessionId: activation.gameSessionId,
      roomName,
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
      joinOptions,
      surfaces,
    };
  }
}
