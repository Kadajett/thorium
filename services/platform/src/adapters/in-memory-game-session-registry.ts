import { randomUUID } from "node:crypto";
import type { SurfaceRole } from "../domain/game-package.js";
import type {
  ActivateGameSession,
  ActivateGameSessionConflictCode,
  ActivateGameSessionResult,
  AdmitGameSessionSurface,
  AdmitGameSessionSurfaceConflictCode,
  AdmitGameSessionSurfaceResult,
  ExactGameRelease,
  FinishGameSession,
  FinishGameSessionConflictCode,
  FinishGameSessionResult,
  GameSessionActivation,
  GameSessionRegistry,
  GameSessionRegistryConflict,
  GameSessionSurfaceGrant,
  RequestedGameSessionSurface,
  GameSessionRoomFence,
} from "../session-registry/game-session-registry.js";

interface NormalizedActivation {
  readonly requestId: string;
  readonly accountId: string;
  readonly release: ExactGameRelease;
  readonly surfaces: readonly RequestedGameSessionSurface[];
  readonly fingerprint: string;
}

interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly gameSessionId: string;
}

interface StoredGameSession {
  readonly accountId: string;
  readonly activation: GameSessionActivation;
  readonly admittedCapabilities: Set<string>;
  roomInstanceId?: string;
  status: "active" | "finished" | "superseded";
}

const packageIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const digestPattern = /^[a-f0-9]{64}$/;
const surfaceIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const roleOrder: Readonly<Record<SurfaceRole, number>> = { main: 0, companion: 1 };

export class InMemoryGameSessionRegistry implements GameSessionRegistry {
  readonly #newId: () => string;
  readonly #activeByAccount = new Map<string, string>();
  readonly #generationByAccount = new Map<string, number>();
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  readonly #sessions = new Map<string, StoredGameSession>();

  constructor(options: { readonly newId?: () => string } = {}) {
    this.#newId = options.newId ?? randomUUID;
  }

  async activate(input: ActivateGameSession): Promise<ActivateGameSessionResult> {
    const normalized = normalizeActivation(input);
    if ("conflict" in normalized) return normalized;

    const idempotencyKey = key(normalized.accountId, normalized.requestId);
    const previousRequest = this.#idempotency.get(idempotencyKey);
    if (previousRequest !== undefined) {
      if (previousRequest.fingerprint !== normalized.fingerprint) {
        return activationConflict(
          "REQUEST_ID_REUSED",
          "The requestId was already used with another activation payload.",
        );
      }
      const previousSession = this.#sessions.get(previousRequest.gameSessionId);
      if (
        previousSession === undefined
        || previousSession.status !== "active"
        || this.#activeByAccount.get(previousSession.accountId)
          !== previousSession.activation.gameSessionId
      ) {
        return activationConflict(
          "REQUEST_NO_LONGER_ACTIVE",
          "The idempotent activation is no longer this account's active Game Session.",
        );
      }
      return { ok: true, replayed: true, activation: cloneActivation(previousSession.activation) };
    }

    const currentId = this.#activeByAccount.get(normalized.accountId);
    const current = currentId === undefined ? undefined : this.#sessions.get(currentId);
    const generation = (this.#generationByAccount.get(normalized.accountId) ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) {
      throw new RangeError("The Game Session generation exceeded the safe integer range.");
    }

    // Generate everything before mutating state so a failing injected ID source
    // cannot partially supersede the prior activation.
    const gameSessionId = this.#newId();
    const capabilityIds = normalized.surfaces.map(() => this.#newId());
    if (
      !isInternalId(gameSessionId)
      || capabilityIds.some((capabilityId) => !isInternalId(capabilityId))
      || new Set([gameSessionId, ...capabilityIds]).size !== capabilityIds.length + 1
      || this.#sessions.has(gameSessionId)
    ) {
      throw new Error("The Game Session ID source returned an invalid or duplicate value.");
    }

    const grants: GameSessionSurfaceGrant[] = normalized.surfaces.map((surface, index) => ({
      surfaceId: surface.surfaceId,
      role: surface.role,
      playerSlots: [...surface.playerSlots],
      capabilityId: capabilityIds[index]!,
    }));
    const activation: GameSessionActivation = {
      gameSessionId,
      generation,
      release: cloneRelease(normalized.release),
      surfaces: grants,
      ...(current === undefined ? {} : { supersededGameSessionId: current.activation.gameSessionId }),
    };

    if (current !== undefined) current.status = "superseded";
    this.#sessions.set(gameSessionId, {
      accountId: normalized.accountId,
      activation,
      admittedCapabilities: new Set(),
      status: "active",
    });
    this.#activeByAccount.set(normalized.accountId, gameSessionId);
    this.#generationByAccount.set(normalized.accountId, generation);
    this.#idempotency.set(idempotencyKey, {
      fingerprint: normalized.fingerprint,
      gameSessionId,
    });

    return { ok: true, replayed: false, activation: cloneActivation(activation) };
  }

  async admit(input: AdmitGameSessionSurface): Promise<AdmitGameSessionSurfaceResult> {
    const session = this.#sessions.get(input.gameSessionId);
    if (
      session === undefined
      || session.status !== "active"
      || this.#activeByAccount.get(session.accountId) !== input.gameSessionId
    ) {
      return admissionConflict(
        "SESSION_NOT_ACTIVE",
        "The Game Session is not active for this durable account.",
      );
    }
    if (session.activation.generation !== input.generation) {
      return admissionConflict(
        "GENERATION_MISMATCH",
        "The surface grant carries a stale Game Session generation.",
      );
    }
    if (!sameRelease(session.activation.release, input.release)) {
      return admissionConflict(
        "RELEASE_SCOPE_MISMATCH",
        "The surface grant does not match the active exact Game Release.",
      );
    }
    if (!isBoundedString(input.roomInstanceId, 128)) {
      return admissionConflict(
        "ROOM_FENCE_MISMATCH",
        "The Colyseus room identity is invalid.",
      );
    }
    if (
      session.roomInstanceId !== undefined
      && session.roomInstanceId !== input.roomInstanceId
    ) {
      return admissionConflict(
        "ROOM_FENCE_MISMATCH",
        "The Game Session is already bound to another Colyseus room.",
      );
    }

    const grant = session.activation.surfaces.find((candidate) =>
      candidate.capabilityId === input.capabilityId);
    if (
      grant === undefined
      || grant.surfaceId !== input.surfaceId
      || grant.role !== input.role
      || !samePlayerSlots(grant.playerSlots, input.playerSlots)
    ) {
      return admissionConflict(
        "SURFACE_SCOPE_MISMATCH",
        "The capability does not match its Surface Role or PlayerSlot lease.",
      );
    }
    if (session.admittedCapabilities.has(input.capabilityId)) {
      return admissionConflict(
        "CAPABILITY_REPLAYED",
        "The surface capability was already admitted.",
      );
    }

    session.roomInstanceId = input.roomInstanceId;
    session.admittedCapabilities.add(input.capabilityId);
    return {
      ok: true,
      admission: {
        gameSessionId: session.activation.gameSessionId,
        generation: session.activation.generation,
        surfaceId: grant.surfaceId,
        role: grant.role,
        playerSlots: [...grant.playerSlots],
      },
    };
  }

  async finish(input: FinishGameSession): Promise<FinishGameSessionResult> {
    const session = this.#sessions.get(input.gameSessionId);
    if (session === undefined) {
      return finishConflict("SESSION_NOT_FOUND", "The Game Session does not exist.");
    }
    if (session.activation.generation !== input.generation) {
      return finishConflict(
        "GENERATION_MISMATCH",
        "The finish request carries a stale Game Session generation.",
      );
    }
    if (session.status === "superseded") {
      return finishConflict(
        "SESSION_SUPERSEDED",
        "A superseded Game Session cannot mutate the active generation.",
      );
    }
    if (session.roomInstanceId !== input.roomInstanceId) {
      return finishConflict(
        "ROOM_FENCE_MISMATCH",
        "Only the bound Colyseus room may finish this Game Session.",
      );
    }
    if (session.status === "finished") return { ok: true, status: "already-finished" };
    if (this.#activeByAccount.get(session.accountId) !== input.gameSessionId) {
      return finishConflict(
        "SESSION_SUPERSEDED",
        "The Game Session is no longer the active generation.",
      );
    }

    session.status = "finished";
    this.#activeByAccount.delete(session.accountId);
    return { ok: true, status: "finished" };
  }

  async isActive(input: GameSessionRoomFence): Promise<boolean> {
    const session = this.#sessions.get(input.gameSessionId);
    return session !== undefined
      && session.status === "active"
      && session.activation.generation === input.generation
      && session.roomInstanceId === input.roomInstanceId
      && this.#activeByAccount.get(session.accountId) === input.gameSessionId;
  }
}

function normalizeActivation(
  input: ActivateGameSession,
): NormalizedActivation | Extract<ActivateGameSessionResult, { ok: false }> {
  if (!isBoundedString(input.requestId, 128) || !isBoundedString(input.accountId, 128)) {
    return activationConflict(
      "INVALID_ACTIVATION",
      "requestId and accountId must be non-empty strings of at most 128 characters.",
    );
  }
  if (
    typeof input.release !== "object"
    || input.release === null
    || !packageIdPattern.test(input.release.packageId)
    || input.release.packageId.length > 128
    || !versionPattern.test(input.release.version)
    || input.release.version.length > 64
    || !digestPattern.test(input.release.contentDigest)
  ) {
    return activationConflict(
      "INVALID_ACTIVATION",
      "The activation must identify one exact Game Release.",
    );
  }
  if (!Array.isArray(input.surfaces) || input.surfaces.length < 1 || input.surfaces.length > 2) {
    return activationConflict(
      "INVALID_ACTIVATION",
      "An activation must contain one or two surfaces.",
    );
  }

  const surfaceIds = new Set<string>();
  const roles = new Set<SurfaceRole>();
  const allPlayerSlots = new Set<number>();
  const surfaces: RequestedGameSessionSurface[] = [];
  for (const surface of input.surfaces) {
    if (
      typeof surface !== "object"
      || surface === null
      || !surfaceIdPattern.test(surface.surfaceId)
      || (surface.role !== "main" && surface.role !== "companion")
      || surfaceIds.has(surface.surfaceId)
      || roles.has(surface.role)
      || !Array.isArray(surface.playerSlots)
      || surface.playerSlots.length > 16
    ) {
      return activationConflict(
        "INVALID_ACTIVATION",
        "Surface IDs and roles must be valid and unique.",
      );
    }
    const playerSlots = [...surface.playerSlots].sort((left, right) => left - right);
    for (const playerSlot of playerSlots) {
      if (
        !Number.isInteger(playerSlot)
        || playerSlot < 0
        || playerSlot > 15
        || allPlayerSlots.has(playerSlot)
      ) {
        return activationConflict(
          "INVALID_ACTIVATION",
          "PlayerSlots must be unique integers from 0 through 15.",
        );
      }
      allPlayerSlots.add(playerSlot);
    }
    surfaceIds.add(surface.surfaceId);
    roles.add(surface.role);
    surfaces.push({
      surfaceId: surface.surfaceId,
      role: surface.role,
      playerSlots,
    });
  }
  if (allPlayerSlots.size === 0) {
    return activationConflict(
      "INVALID_ACTIVATION",
      "An activation must lease at least one PlayerSlot.",
    );
  }

  surfaces.sort((left, right) =>
    roleOrder[left.role] - roleOrder[right.role]
    || left.surfaceId.localeCompare(right.surfaceId));
  const release = cloneRelease(input.release);
  return {
    requestId: input.requestId,
    accountId: input.accountId,
    release,
    surfaces,
    fingerprint: JSON.stringify({ release, surfaces }),
  };
}

function activationConflict(
  code: ActivateGameSessionConflictCode,
  message: string,
): Extract<ActivateGameSessionResult, { ok: false }> {
  return { ok: false, conflict: { code, message } };
}

function admissionConflict(
  code: AdmitGameSessionSurfaceConflictCode,
  message: string,
): Extract<AdmitGameSessionSurfaceResult, { ok: false }> {
  return { ok: false, conflict: { code, message } };
}

function finishConflict(
  code: FinishGameSessionConflictCode,
  message: string,
): Extract<FinishGameSessionResult, { ok: false }> {
  return { ok: false, conflict: { code, message } };
}

function cloneActivation(activation: GameSessionActivation): GameSessionActivation {
  return {
    gameSessionId: activation.gameSessionId,
    generation: activation.generation,
    release: cloneRelease(activation.release),
    surfaces: activation.surfaces.map((surface) => ({
      capabilityId: surface.capabilityId,
      surfaceId: surface.surfaceId,
      role: surface.role,
      playerSlots: [...surface.playerSlots],
    })),
    ...(activation.supersededGameSessionId === undefined
      ? {}
      : { supersededGameSessionId: activation.supersededGameSessionId }),
  };
}

function cloneRelease(release: ExactGameRelease): ExactGameRelease {
  return {
    packageId: release.packageId,
    version: release.version,
    contentDigest: release.contentDigest,
  };
}

function sameRelease(left: ExactGameRelease, right: ExactGameRelease): boolean {
  return left.packageId === right.packageId
    && left.version === right.version
    && left.contentDigest === right.contentDigest;
}

function samePlayerSlots(left: readonly number[], right: readonly number[]): boolean {
  if (!Array.isArray(right) || left.length !== right.length) return false;
  const normalized = [...right].sort((a, b) => a - b);
  return normalized.every((value, index) => value === left[index]);
}

function key(accountId: string, requestId: string): string {
  return `${accountId}\0${requestId}`;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isInternalId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
