export const PENDING_FENCE = 9223372036854775807n;

export type PresentRecord = readonly [desired: bigint, actual: bigint, ready: bigint];

export interface PresentHistory {
  readonly refreshPeriodNs: bigint;
  readonly timestamps: readonly bigint[];
  readonly records: readonly PresentRecord[];
}

export interface HistorySnapshot {
  readonly history: PresentHistory;
  readonly collectedAtNs: bigint;
  readonly collectedAfterNs: bigint;
}

export interface ObservationWindow {
  readonly windowStartNs: bigint;
  readonly windowEndNs: bigint;
}

export interface RateOptions extends ObservationWindow {
  readonly targetFps: 60 | 120;
  readonly minimumDurationMs: number;
}

export type CoverageReason =
  | "observation_window_not_covered"
  | "device_clock_mismatch"
  | "display_refresh_changed"
  | "frame_history_coverage_gap"
  | "initial_frame_history_may_have_wrapped"
  | "unidentifiable_pending_fence"
  | "unresolved_present_fence"
  | "continuous_frame_history";

export interface CoverageResult {
  readonly pass: boolean;
  readonly reason: CoverageReason;
}

export type RateReason =
  | "insufficient_measurement_duration"
  | "insufficient_presented_frames"
  | "below_requested_fps"
  | "requested_present_rate_met";

export interface RateResult {
  readonly pass: boolean;
  readonly reason: RateReason;
  readonly frames: number;
  readonly durationMs: number;
  readonly fps: number;
  readonly intervalFps: number | null;
  readonly leadingIdleMs: number;
  readonly trailingIdleMs: number;
  readonly p95FrameMs: number | null;
  readonly maxFrameMs: number | null;
  readonly maxObservedGapMs: number;
}

export function validTime(time: unknown): time is bigint {
  return typeof time === "bigint" && time >= 0n && time < PENDING_FENCE;
}

export function orderedUnique(values: readonly bigint[]): readonly bigint[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function validateWindow(window: ObservationWindow): void {
  if (
    !validTime(window.windowStartNs) ||
    !validTime(window.windowEndNs) ||
    window.windowEndNs <= window.windowStartNs
  ) {
    throw new Error("An explicit increasing device-monotonic observation window is required");
  }
}
