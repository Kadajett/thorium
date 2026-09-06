import { PENDING_FENCE, validTime, type PresentRecord } from "./presentation-types.mts";

export interface FenceState {
  readonly pending: ReadonlySet<string>;
  readonly resolved: ReadonlySet<string>;
  readonly unidentifiable: boolean;
}

function recordKey([desired, , ready]: PresentRecord): string | undefined {
  if (desired > 0n && validTime(desired)) return `desired:${String(desired)}`;
  return ready > 0n && validTime(ready) ? `ready:${String(ready)}` : undefined;
}

function pendingActual([desired, actual, ready]: PresentRecord): boolean {
  return actual === PENDING_FENCE || (actual === 0n && (desired > 0n || ready > 0n));
}

function pendingInWindow(record: PresentRecord, end: bigint): boolean {
  const ready = record[2];
  const outside = ready >= end && ready < PENDING_FENCE;
  return pendingActual(record) && !outside;
}

function resolveRecord(state: FenceState, record: PresentRecord, key: string): FenceState {
  return record[1] > 0n && validTime(record[1])
    ? { ...state, resolved: new Set([...state.resolved, key]) }
    : state;
}

function observeRecord(state: FenceState, record: PresentRecord, end: bigint): FenceState {
  const key = recordKey(record);
  if (pendingInWindow(record, end)) {
    return key === undefined
      ? { ...state, unidentifiable: true }
      : { ...state, pending: new Set([...state.pending, key]) };
  }
  return key === undefined ? state : resolveRecord(state, record, key);
}

export function observeFences(
  state: FenceState,
  records: readonly PresentRecord[],
  end: bigint,
): FenceState {
  return records.reduce<FenceState>(
    (current, record) => observeRecord(current, record, end),
    state,
  );
}
