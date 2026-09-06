import { normalizeActivation, type NormalizedActivation } from "../core/session-activation.js";
import {
  cloneActivation,
  nextSessionGeneration,
  planActivation,
  replayActivation,
} from "../core/session-activation-plan.js";
import type {
  ActivateGameSession,
  ActivateGameSessionResult,
  GameSessionActivation,
} from "../session-registry/game-session-registry.js";
import type { MemorySessionState } from "./memory-session-state.js";

function replay(
  state: MemorySessionState,
  input: NormalizedActivation,
): ActivateGameSessionResult | undefined {
  const request = state.idempotency.get(requestKey(input));
  const session = request === undefined ? undefined : state.sessions.get(request.gameSessionId);
  return replayActivation(
    { request, session, activeSessionId: state.activeByAccount.get(input.accountId) },
    input.fingerprint,
  );
}

function requestKey(input: NormalizedActivation): string {
  return `${input.accountId}\0${input.requestId}`;
}

function supersede(state: MemorySessionState, previousId: string | undefined): void {
  const previous = previousId === undefined ? undefined : state.sessions.get(previousId);
  if (previous !== undefined)
    state.sessions.set(previous.activation.gameSessionId, { ...previous, status: "superseded" });
}

function commitActivation(
  state: MemorySessionState,
  input: NormalizedActivation,
  activation: GameSessionActivation,
): void {
  supersede(state, activation.supersededGameSessionId);
  state.sessions.set(activation.gameSessionId, {
    accountId: input.accountId,
    activation,
    admittedCapabilities: new Set(),
    status: "active",
  });
  state.activeByAccount.set(input.accountId, activation.gameSessionId);
  state.generationByAccount.set(input.accountId, activation.generation);
  state.idempotency.set(requestKey(input), {
    fingerprint: input.fingerprint,
    gameSessionId: activation.gameSessionId,
  });
}

export function activateMemorySession(
  state: MemorySessionState,
  input: ActivateGameSession,
  newId: () => string,
): ActivateGameSessionResult {
  const normalized = normalizeActivation(input);
  if ("conflict" in normalized) return normalized;
  const replayed = replay(state, normalized);
  if (replayed !== undefined) return replayed;
  const generation = nextSessionGeneration(
    state.generationByAccount.get(normalized.accountId) ?? 0,
  );
  const identifiers = {
    gameSessionId: newId(),
    capabilityIds: normalized.surfaces.map(() => newId()),
  };
  const activation = planActivation(normalized, {
    generation,
    previousSessionId: state.activeByAccount.get(normalized.accountId),
    identifiers,
    sessionIdExists: state.sessions.has(identifiers.gameSessionId),
  });
  commitActivation(state, normalized, activation);
  return { ok: true, replayed: false, activation: cloneActivation(activation) };
}
