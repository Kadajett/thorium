import { randomUUID } from "node:crypto";
import { admitSession, finishSession, isActiveSession } from "../core/session-lifecycle.js";
import type {
  ActivateGameSession,
  ActivateGameSessionResult,
  AdmitGameSessionSurface,
  AdmitGameSessionSurfaceResult,
  FinishGameSession,
  FinishGameSessionResult,
  GameSessionRegistry,
} from "../session-registry/game-session-registry.js";
import { activateMemorySession } from "./memory-session-activation.js";
import {
  createMemorySessionState,
  sessionSnapshot,
  type MemorySessionState,
} from "./memory-session-state.js";

function activate(
  state: MemorySessionState,
  input: ActivateGameSession,
  newId: () => string,
): Promise<ActivateGameSessionResult> {
  try {
    return Promise.resolve(activateMemorySession(state, input, newId));
  } catch (error) {
    return Promise.reject(
      error instanceof Error
        ? error
        : new Error("Game Session activation failed", { cause: error }),
    );
  }
}

function admit(
  state: MemorySessionState,
  input: AdmitGameSessionSurface,
): AdmitGameSessionSurfaceResult {
  const snapshot = sessionSnapshot(state, input.gameSessionId);
  const transition = admitSession(snapshot, input);
  if (transition.session !== undefined && transition.session !== snapshot.session) {
    state.sessions.set(input.gameSessionId, transition.session);
  }
  return transition.result;
}

function finish(state: MemorySessionState, input: FinishGameSession): FinishGameSessionResult {
  const transition = finishSession(sessionSnapshot(state, input.gameSessionId), input);
  if (
    transition.session !== undefined &&
    transition.result.ok &&
    transition.result.status === "finished"
  ) {
    state.sessions.set(input.gameSessionId, transition.session);
    state.activeByAccount.delete(transition.session.accountId);
  }
  return transition.result;
}

export function createInMemoryGameSessionRegistry(
  options: { readonly newId?: () => string } = {},
): GameSessionRegistry {
  const state = createMemorySessionState();
  const newId = options.newId ?? randomUUID;
  return {
    activate: (input) => activate(state, input, newId),
    admit: (input) => Promise.resolve(admit(state, input)),
    finish: (input) => Promise.resolve(finish(state, input)),
    isActive: (input) =>
      Promise.resolve(isActiveSession(sessionSnapshot(state, input.gameSessionId), input)),
  };
}

/** Constructor compatibility; the factory owns storage and pure functions own policy. */
export class InMemoryGameSessionRegistry implements GameSessionRegistry {
  readonly activate: GameSessionRegistry["activate"];
  readonly admit: GameSessionRegistry["admit"];
  readonly finish: GameSessionRegistry["finish"];
  readonly isActive: GameSessionRegistry["isActive"];

  constructor(options: { readonly newId?: () => string } = {}) {
    const registry = createInMemoryGameSessionRegistry(options);
    this.activate = (input) => registry.activate(input);
    this.admit = (input) => registry.admit(input);
    this.finish = (input) => registry.finish(input);
    this.isActive = (input) => registry.isActive(input);
  }
}
