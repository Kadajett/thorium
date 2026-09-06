import type {
  AdmitGameSessionSurface,
  AdmitGameSessionSurfaceResult,
  ExactGameRelease,
  FinishGameSession,
  FinishGameSessionResult,
  GameSessionActivation,
  GameSessionRoomFence,
  GameSessionSurfaceGrant,
} from "../session-registry/game-session-registry.js";
import { normalizePlayerSlots, validRelease } from "./session-activation.js";

export interface StoredGameSession {
  readonly accountId: string;
  readonly activation: GameSessionActivation;
  readonly admittedCapabilities: ReadonlySet<string>;
  readonly roomInstanceId?: string;
  readonly status: "active" | "finished" | "superseded";
}

interface SessionSnapshot {
  readonly session: StoredGameSession | undefined;
  readonly activeSessionId: string | undefined;
}

export interface SessionTransition<Result> {
  readonly result: Result;
  readonly session: StoredGameSession | undefined;
}

type AdmissionFailure = Extract<AdmitGameSessionSurfaceResult, { ok: false }>;
type FinishFailure = Extract<FinishGameSessionResult, { ok: false }>;

function admissionConflict(
  code: AdmissionFailure["conflict"]["code"],
  message: string,
): AdmissionFailure {
  return { ok: false, conflict: { code, message } };
}

function finishConflict(code: FinishFailure["conflict"]["code"], message: string): FinishFailure {
  return { ok: false, conflict: { code, message } };
}

function sameRelease(left: ExactGameRelease, right: ExactGameRelease): boolean {
  return (
    validRelease(left) &&
    validRelease(right) &&
    left.packageId === right.packageId &&
    left.version === right.version &&
    left.contentDigest === right.contentDigest
  );
}

function roomConflict(session: StoredGameSession, room: string): AdmissionFailure | undefined {
  if (typeof room !== "string" || room.length === 0 || room.length > 128) {
    return admissionConflict("ROOM_FENCE_MISMATCH", "The Colyseus room identity is invalid.");
  }
  if (session.roomInstanceId !== undefined && session.roomInstanceId !== room) {
    return admissionConflict(
      "ROOM_FENCE_MISMATCH",
      "The Game Session is already bound to another Colyseus room.",
    );
  }
  return undefined;
}

function admissionFence(
  session: StoredGameSession,
  input: AdmitGameSessionSurface,
): AdmissionFailure | undefined {
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
  return roomConflict(session, input.roomInstanceId);
}

function sameSlots(left: readonly number[], right: readonly number[]): boolean {
  const slots = normalizePlayerSlots(right);
  return (
    slots !== null &&
    left.length === slots.length &&
    slots.every((slot, index) => slot === left[index])
  );
}

function matchesGrant(grant: GameSessionSurfaceGrant, input: AdmitGameSessionSurface): boolean {
  return (
    grant.surfaceId === input.surfaceId &&
    grant.role === input.role &&
    sameSlots(grant.playerSlots, input.playerSlots)
  );
}

function consumeGrant(
  session: StoredGameSession,
  input: AdmitGameSessionSurface,
): SessionTransition<AdmitGameSessionSurfaceResult> {
  const grant = session.activation.surfaces.find(
    (candidate) => candidate.capabilityId === input.capabilityId,
  );
  if (grant === undefined || !matchesGrant(grant, input)) {
    return {
      session,
      result: admissionConflict(
        "SURFACE_SCOPE_MISMATCH",
        "The capability does not match its Surface Role or PlayerSlot lease.",
      ),
    };
  }
  if (session.admittedCapabilities.has(input.capabilityId)) {
    return {
      session,
      result: admissionConflict(
        "CAPABILITY_REPLAYED",
        "The surface capability was already admitted.",
      ),
    };
  }
  return admitted(session, input);
}

function admitted(
  session: StoredGameSession,
  input: AdmitGameSessionSurface,
): SessionTransition<AdmitGameSessionSurfaceResult> {
  return {
    session: {
      ...session,
      roomInstanceId: input.roomInstanceId,
      admittedCapabilities: new Set([...session.admittedCapabilities, input.capabilityId]),
    },
    result: {
      ok: true,
      admission: {
        gameSessionId: session.activation.gameSessionId,
        generation: session.activation.generation,
        surfaceId: input.surfaceId,
        role: input.role,
        playerSlots: [...input.playerSlots].sort((a, b) => a - b),
      },
    },
  };
}

export function admitSession(
  snapshot: SessionSnapshot,
  input: AdmitGameSessionSurface,
): SessionTransition<AdmitGameSessionSurfaceResult> {
  const session = snapshot.session;
  if (
    session === undefined ||
    session.status !== "active" ||
    snapshot.activeSessionId !== input.gameSessionId
  ) {
    return {
      session,
      result: admissionConflict(
        "SESSION_NOT_ACTIVE",
        "The Game Session is not active for this durable account.",
      ),
    };
  }
  const conflict = admissionFence(session, input);
  return conflict === undefined ? consumeGrant(session, input) : { session, result: conflict };
}

function finishFence(
  session: StoredGameSession,
  input: FinishGameSession,
): FinishFailure | undefined {
  if (input.release !== undefined && !sameRelease(session.activation.release, input.release)) {
    return finishConflict(
      "RELEASE_SCOPE_MISMATCH",
      "The delegated service cannot finish another exact release.",
    );
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
  return undefined;
}

function finishActive(
  snapshot: SessionSnapshot,
  session: StoredGameSession,
): SessionTransition<FinishGameSessionResult> {
  if (session.status === "finished")
    return { session, result: { ok: true, status: "already-finished" } };
  if (snapshot.activeSessionId !== session.activation.gameSessionId) {
    return {
      session,
      result: finishConflict(
        "SESSION_SUPERSEDED",
        "The Game Session is no longer the active generation.",
      ),
    };
  }
  return { session: { ...session, status: "finished" }, result: { ok: true, status: "finished" } };
}

export function finishSession(
  snapshot: SessionSnapshot,
  input: FinishGameSession,
): SessionTransition<FinishGameSessionResult> {
  const session = snapshot.session;
  if (session === undefined)
    return {
      session,
      result: finishConflict("SESSION_NOT_FOUND", "The Game Session does not exist."),
    };
  const conflict = finishFence(session, input);
  return conflict === undefined ? finishActive(snapshot, session) : { session, result: conflict };
}

export function isActiveSession(snapshot: SessionSnapshot, input: GameSessionRoomFence): boolean {
  const session = snapshot.session;
  return (
    session !== undefined &&
    session.status === "active" &&
    session.activation.generation === input.generation &&
    session.roomInstanceId === input.roomInstanceId &&
    (input.release === undefined || sameRelease(session.activation.release, input.release)) &&
    snapshot.activeSessionId === input.gameSessionId
  );
}
