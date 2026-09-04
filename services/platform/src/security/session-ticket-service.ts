import {
  createHmac,
  createSecretKey,
} from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { SurfaceRole } from "../domain/game-package.js";
import type { AccountSession } from "../ports/account-identity.js";
import type { GameSessionActivation } from "../session-registry/game-session-registry.js";

const SESSION_TICKET_ISSUER = "thorium-platform";
const SESSION_TICKET_AUDIENCE = "thorium-game-session";
export const MIN_ACCOUNT_SESSION_REMAINING_MS = 10_000;
const pendingSessionTicketBrand: unique symbol = Symbol("PendingSessionTicket");
const preparedSessionTicketIssueBrand: unique symbol = Symbol("PreparedSessionTicketIssue");

export interface SeatLeaseRequest {
  readonly surfaceId: string;
  readonly role: SurfaceRole;
  readonly playerSlots: readonly number[];
}

export interface SurfaceSessionTicket {
  readonly surfaceId: string;
  readonly role: SurfaceRole;
  readonly playerSlots: readonly number[];
  readonly ticket: string;
}

export interface SessionTicketBundle {
  readonly endpoint: string;
  readonly gameSessionId: string;
  readonly roomName: "game_session";
  readonly expiresAt: string;
  readonly joinOptions: {
    readonly gameSessionId: string;
    readonly packageId: string;
    readonly packageVersion: string;
    readonly packageDigest: string;
  };
  readonly surfaces: readonly SurfaceSessionTicket[];
}

export type SessionTicketScope = SessionTicketBundle["joinOptions"];

const SessionTicketClaimsSchema = z.object({
  sub: z.string().min(16).max(128),
  jti: z.string().uuid(),
  exp: z.number().int().positive(),
  gameSessionId: z.string().uuid(),
  generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  packageId: z.string().min(1).max(128),
  packageVersion: z.string().min(1).max(64),
  packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
  surfaceId: z.string().min(1).max(64),
  role: z.enum(["main", "companion"]),
  playerSlots: z.array(z.number().int().min(0).max(15)).max(16),
});

type PrivateSessionTicketClaims = z.infer<typeof SessionTicketClaimsSchema>;

export type SessionTicketClaims = Omit<PrivateSessionTicketClaims, "sub" | "jti" | "exp"> & {
  readonly accountScope: string;
  readonly capabilityId: string;
  readonly expiresAt: Date;
};

type VerifiedSessionTicketClaims = Omit<SessionTicketClaims, "expiresAt">;

/**
 * Server-internal proof carried from Colyseus matchmaking auth to room join.
 * Its unexported brand makes callers obtain it from verifyScope().
 */
export type PendingSessionTicket = Readonly<{
  claims: VerifiedSessionTicketClaims;
  /** @internal Rechecked immediately before durable admission. */
  expiresAtEpochMs: number;
  [pendingSessionTicketBrand]: true;
}>;

/** Server-internal, time-stable issuance context prepared before activation. */
export type PreparedSessionTicketIssue = Readonly<{
  account: AccountSession;
  issuedAtEpochSeconds: number;
  expiresAtEpochSeconds: number;
  [preparedSessionTicketIssueBrand]: true;
}>;

export class SessionTicketScopeMismatchError extends Error {
  constructor() {
    super("session_ticket_scope_mismatch");
  }
}

export class SessionTicketExpiredError extends Error {
  constructor() {
    super("session_ticket_expired");
  }
}

export class AccountSessionExpiringError extends Error {
  constructor() {
    super("account_session_expiring");
  }
}

export class SessionTicketService {
  readonly #key: ReturnType<typeof createSecretKey>;
  readonly #scopeSecret: string;
  readonly #endpoint: string;
  readonly #ttlSeconds: number;
  readonly #now: () => Date;

  constructor(options: {
    readonly secret: string;
    readonly endpoint: string;
    readonly ttlSeconds?: number;
    readonly now?: () => Date;
  }) {
    this.#key = createSecretKey(Buffer.from(options.secret, "utf8"));
    this.#scopeSecret = options.secret;
    this.#endpoint = options.endpoint;
    this.#ttlSeconds = options.ttlSeconds ?? 60;
    this.#now = options.now ?? (() => new Date());
  }

  prepareIssue(account: AccountSession): PreparedSessionTicketIssue {
    const now = this.#now();
    if (
      account.expiresAt.getTime() - now.getTime()
      < MIN_ACCOUNT_SESSION_REMAINING_MS
    ) {
      throw new AccountSessionExpiringError();
    }
    const issuedAtEpochSeconds = Math.floor(now.getTime() / 1_000);
    return {
      account,
      issuedAtEpochSeconds,
      expiresAtEpochSeconds: Math.min(
        issuedAtEpochSeconds + this.#ttlSeconds,
        Math.floor(account.expiresAt.getTime() / 1_000),
      ),
      [preparedSessionTicketIssueBrand]: true,
    };
  }

  async issueBundle(
    prepared: PreparedSessionTicketIssue,
    activation: GameSessionActivation,
  ): Promise<SessionTicketBundle> {
    const { account, issuedAtEpochSeconds, expiresAtEpochSeconds } = prepared;
    const accountScope = createHmac("sha256", this.#scopeSecret)
      .update(account.accountId)
      .update("\0")
      .update(account.accountSessionId)
      .update("\0")
      .update(activation.gameSessionId)
      .digest("base64url");

    const tickets = await Promise.all(activation.surfaces.map(async (surface) => ({
      surfaceId: surface.surfaceId,
      role: surface.role,
      playerSlots: [...surface.playerSlots],
      ticket: await new SignJWT({
        gameSessionId: activation.gameSessionId,
        generation: activation.generation,
        packageId: activation.release.packageId,
        packageVersion: activation.release.version,
        packageDigest: activation.release.contentDigest,
        surfaceId: surface.surfaceId,
        role: surface.role,
        playerSlots: [...surface.playerSlots],
      })
        .setProtectedHeader({ alg: "HS256", typ: "thorium-session+jwt" })
        .setIssuer(SESSION_TICKET_ISSUER)
        .setAudience(SESSION_TICKET_AUDIENCE)
        .setSubject(accountScope)
        .setJti(surface.capabilityId)
        .setIssuedAt(issuedAtEpochSeconds)
        .setExpirationTime(expiresAtEpochSeconds)
        .sign(this.#key),
    })));

    return {
      endpoint: this.#endpoint,
      gameSessionId: activation.gameSessionId,
      roomName: "game_session",
      expiresAt: new Date(expiresAtEpochSeconds * 1_000).toISOString(),
      joinOptions: {
        gameSessionId: activation.gameSessionId,
        packageId: activation.release.packageId,
        packageVersion: activation.release.version,
        packageDigest: activation.release.contentDigest,
      },
      surfaces: tickets,
    };
  }

  async verifyScope(
    token: string,
    expectedScope: SessionTicketScope,
  ): Promise<PendingSessionTicket> {
    const claims = await this.#verify(token, this.#now());
    this.#assertScope(claims, expectedScope);
    const expiresAt = new Date(claims.exp * 1_000);
    return {
      claims: this.#verifiedClaims(claims),
      expiresAtEpochMs: expiresAt.getTime(),
      [pendingSessionTicketBrand]: true,
    };
  }

  accept(pending: PendingSessionTicket): SessionTicketClaims {
    const now = this.#now();
    const expiresAt = new Date(pending.expiresAtEpochMs);
    if (now.getTime() >= expiresAt.getTime()) {
      throw new SessionTicketExpiredError();
    }
    return { ...pending.claims, expiresAt };
  }

  async #verify(token: string, now: Date): Promise<PrivateSessionTicketClaims> {
    try {
      const { payload } = await jwtVerify(token, this.#key, {
        algorithms: ["HS256"],
        issuer: SESSION_TICKET_ISSUER,
        audience: SESSION_TICKET_AUDIENCE,
        currentDate: now,
      });
      return SessionTicketClaimsSchema.parse(payload);
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ERR_JWT_EXPIRED"
      ) {
        throw new SessionTicketExpiredError();
      }
      throw error;
    }
  }

  #assertScope(
    claims: PrivateSessionTicketClaims,
    expectedScope: SessionTicketScope,
  ): void {
    if (
      claims.gameSessionId !== expectedScope.gameSessionId
      || claims.packageId !== expectedScope.packageId
      || claims.packageVersion !== expectedScope.packageVersion
      || claims.packageDigest !== expectedScope.packageDigest
    ) {
      throw new SessionTicketScopeMismatchError();
    }
  }

  #verifiedClaims(claims: PrivateSessionTicketClaims): VerifiedSessionTicketClaims {
    return {
      gameSessionId: claims.gameSessionId,
      generation: claims.generation,
      packageId: claims.packageId,
      packageVersion: claims.packageVersion,
      packageDigest: claims.packageDigest,
      surfaceId: claims.surfaceId,
      role: claims.role,
      playerSlots: claims.playerSlots,
      accountScope: claims.sub,
      capabilityId: claims.jti,
    };
  }
}
