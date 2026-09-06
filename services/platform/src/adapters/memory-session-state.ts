import type { IdempotencyRecord } from "../core/session-activation-plan.js";
import type { StoredGameSession } from "../core/session-lifecycle.js";

export interface MemorySessionState {
  readonly activeByAccount: Map<string, string>;
  readonly generationByAccount: Map<string, number>;
  readonly idempotency: Map<string, IdempotencyRecord>;
  readonly sessions: Map<string, StoredGameSession>;
}

export function createMemorySessionState(): MemorySessionState {
  return {
    activeByAccount: new Map(),
    generationByAccount: new Map(),
    idempotency: new Map(),
    sessions: new Map(),
  };
}

export function sessionSnapshot(state: MemorySessionState, gameSessionId: string) {
  const session = state.sessions.get(gameSessionId);
  const activeSessionId =
    session === undefined ? undefined : state.activeByAccount.get(session.accountId);
  return { session, activeSessionId };
}
