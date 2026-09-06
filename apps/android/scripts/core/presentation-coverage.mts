import { observeFences, type FenceState } from "./presentation-fences.mts";
import {
  validateWindow,
  validTime,
  type CoverageReason,
  type CoverageResult,
  type HistorySnapshot,
  type ObservationWindow,
} from "./presentation-types.mts";

interface CoverageState {
  readonly previous: HistorySnapshot | undefined;
  readonly fences: FenceState;
  readonly failure: CoverageReason | undefined;
}

interface CoverageContext {
  readonly refreshPeriodNs: bigint;
  readonly windowEndNs: bigint;
}

function bracketsWindow(snapshots: readonly HistorySnapshot[], window: ObservationWindow): boolean {
  const first = snapshots[0];
  const last = snapshots.at(-1);
  return (
    snapshots.length >= 2 &&
    first !== undefined &&
    last !== undefined &&
    first.collectedAtNs <= window.windowStartNs &&
    last.collectedAfterNs >= window.windowEndNs
  );
}

function validClock(snapshot: HistorySnapshot, previous: HistorySnapshot | undefined): boolean {
  return (
    validCollectionBounds(snapshot) &&
    (previous === undefined || snapshot.collectedAfterNs >= previous.collectedAtNs) &&
    snapshot.history.timestamps.every((time) => time <= snapshot.collectedAtNs)
  );
}

function validCollectionBounds(snapshot: HistorySnapshot): boolean {
  return (
    validTime(snapshot.collectedAfterNs) &&
    validTime(snapshot.collectedAtNs) &&
    snapshot.collectedAfterNs <= snapshot.collectedAtNs
  );
}

function initialRingFailure(current: HistorySnapshot): CoverageReason | undefined {
  const zeroPadded = current.history.records.some((row) => row.every((time) => time === 0n));
  return current.history.timestamps.length > 0 && !zeroPadded
    ? "initial_frame_history_may_have_wrapped"
    : undefined;
}

function ringFailure(
  previous: HistorySnapshot | undefined,
  current: HistorySnapshot,
): CoverageReason | undefined {
  if (previous === undefined) return undefined;
  const before = previous.history.timestamps;
  if (before.length === 0) return initialRingFailure(current);
  return before.some((time) => current.history.timestamps.includes(time))
    ? undefined
    : "frame_history_coverage_gap";
}

function snapshotFailure(
  state: CoverageState,
  snapshot: HistorySnapshot,
  context: CoverageContext,
): CoverageReason | undefined {
  if (!validClock(snapshot, state.previous)) return "device_clock_mismatch";
  if (snapshot.history.refreshPeriodNs !== context.refreshPeriodNs)
    return "display_refresh_changed";
  return ringFailure(state.previous, snapshot);
}

function observeSnapshot(
  state: CoverageState,
  snapshot: HistorySnapshot,
  context: CoverageContext,
): CoverageState {
  if (state.failure !== undefined) return state;
  const failure = snapshotFailure(state, snapshot, context);
  if (failure !== undefined) return { ...state, failure };
  const fences = observeFences(state.fences, snapshot.history.records, context.windowEndNs);
  return {
    previous: snapshot,
    fences,
    failure: fences.unidentifiable ? "unidentifiable_pending_fence" : undefined,
  };
}

function coverageResult(state: CoverageState): CoverageResult {
  if (state.failure !== undefined) return { pass: false, reason: state.failure };
  if ([...state.fences.pending].some((key) => !state.fences.resolved.has(key))) {
    return { pass: false, reason: "unresolved_present_fence" };
  }
  return { pass: true, reason: "continuous_frame_history" };
}

export function assessHistoryCoverage(
  snapshots: readonly HistorySnapshot[],
  window: ObservationWindow,
): CoverageResult {
  validateWindow(window);
  const first = snapshots[0];
  if (!bracketsWindow(snapshots, window) || first === undefined)
    return { pass: false, reason: "observation_window_not_covered" };
  const context: CoverageContext = {
    refreshPeriodNs: first.history.refreshPeriodNs,
    windowEndNs: window.windowEndNs,
  };
  const initial: CoverageState = {
    previous: undefined,
    failure: undefined,
    fences: { pending: new Set(), resolved: new Set(), unidentifiable: false },
  };
  return coverageResult(
    snapshots.reduce((state, snapshot) => observeSnapshot(state, snapshot, context), initial),
  );
}
