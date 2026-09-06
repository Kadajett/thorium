import type { NormalizedActivation } from "./session-activation.js";
import type { StoredGameSession } from "./session-lifecycle.js";
import type {
  ActivateGameSessionResult,
  GameSessionActivation,
  GameSessionSurfaceGrant,
  RequestedGameSessionSurface,
} from "../session-registry/game-session-registry.js";

export interface IdempotencyRecord {
  readonly fingerprint: string;
  readonly gameSessionId: string;
}

export interface ActivationIdentifiers {
  readonly gameSessionId: string;
  readonly capabilityIds: readonly string[];
}

export function nextSessionGeneration(previous: number): number {
  const next = previous + 1;
  if (!Number.isSafeInteger(next))
    throw new RangeError("The Game Session generation exceeded the safe integer range.");
  return next;
}

interface ReplaySnapshot {
  readonly request: IdempotencyRecord | undefined;
  readonly session: StoredGameSession | undefined;
  readonly activeSessionId: string | undefined;
}

interface ActivationContext {
  readonly generation: number;
  readonly previousSessionId: string | undefined;
  readonly identifiers: ActivationIdentifiers;
  readonly sessionIdExists: boolean;
}

type Failure = Extract<ActivateGameSessionResult, { ok: false }>;

function conflict(code: Failure["conflict"]["code"], message: string): Failure {
  return { ok: false, conflict: { code, message } };
}

export function replayActivation(
  snapshot: ReplaySnapshot,
  fingerprint: string,
): ActivateGameSessionResult | undefined {
  if (snapshot.request === undefined) return undefined;
  if (snapshot.request.fingerprint !== fingerprint) {
    return conflict(
      "REQUEST_ID_REUSED",
      "The requestId was already used with another activation payload.",
    );
  }
  const session = snapshot.session;
  if (
    session === undefined ||
    session.status !== "active" ||
    snapshot.activeSessionId !== session.activation.gameSessionId
  ) {
    return conflict(
      "REQUEST_NO_LONGER_ACTIVE",
      "The idempotent activation is no longer this account's active Game Session.",
    );
  }
  return { ok: true, replayed: true, activation: cloneActivation(session.activation) };
}

function validIdentifier(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function assertIdentifiers(ids: ActivationIdentifiers, expected: number, exists: boolean): void {
  const values: readonly string[] = [ids.gameSessionId, ...ids.capabilityIds];
  if (
    exists ||
    ids.capabilityIds.length !== expected ||
    !values.every(validIdentifier) ||
    new Set(values).size !== values.length
  ) {
    throw new Error("The Game Session ID source returned an invalid or duplicate value.");
  }
}

function surfaceGrant(
  surface: RequestedGameSessionSurface,
  capabilityId: string | undefined,
): GameSessionSurfaceGrant {
  if (capabilityId === undefined)
    throw new Error("The Game Session ID source omitted a surface capability.");
  return {
    surfaceId: surface.surfaceId,
    role: surface.role,
    playerSlots: [...surface.playerSlots],
    capabilityId,
  };
}

export function planActivation(
  input: NormalizedActivation,
  context: ActivationContext,
): GameSessionActivation {
  if (!Number.isSafeInteger(context.generation)) {
    throw new RangeError("The Game Session generation exceeded the safe integer range.");
  }
  assertIdentifiers(context.identifiers, input.surfaces.length, context.sessionIdExists);
  return {
    gameSessionId: context.identifiers.gameSessionId,
    generation: context.generation,
    release: { ...input.release },
    surfaces: input.surfaces.map((surface, index) =>
      surfaceGrant(surface, context.identifiers.capabilityIds[index]),
    ),
    ...(context.previousSessionId === undefined
      ? {}
      : { supersededGameSessionId: context.previousSessionId }),
  };
}

export function cloneActivation(activation: GameSessionActivation): GameSessionActivation {
  return {
    ...activation,
    release: { ...activation.release },
    surfaces: activation.surfaces.map((surface) => surfaceGrant(surface, surface.capabilityId)),
  };
}
