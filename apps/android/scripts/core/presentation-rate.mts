import {
  orderedUnique,
  validateWindow,
  validTime,
  type ObservationWindow,
  type RateOptions,
  type RateReason,
  type RateResult,
} from "./presentation-types.mts";

type Observation = Omit<RateResult, "pass" | "reason">;
type TimeSpan = readonly [first: bigint, last: bigint];

function validTarget(value: unknown): boolean {
  return value === 60 || value === 120;
}

function validateOptions(options: RateOptions): void {
  if (!validTarget(options.targetFps))
    throw new Error("The publication target must be 60 or 120 FPS");
  if (!Number.isFinite(options.minimumDurationMs) || options.minimumDurationMs < 1000)
    throw new Error("Invalid measurement duration");
  validateWindow(options);
}

function milliseconds(start: bigint, end: bigint): number {
  return nanoseconds(start, end) / 1e6;
}

function nanoseconds(start: bigint, end: bigint): number {
  return Number(end - start);
}

function interval(before: bigint | undefined, after: bigint): number {
  if (before === undefined) throw new Error("Missing preceding actual-present timestamp");
  return milliseconds(before, after);
}

function frameIntervals(ordered: readonly bigint[]): readonly number[] {
  return ordered
    .slice(1)
    .map((time, index) => interval(ordered[index], time))
    .sort((left, right) => left - right);
}

function bounds(ordered: readonly bigint[]): TimeSpan | null {
  const first = ordered.at(0);
  const last = ordered.at(-1);
  return first === undefined || last === undefined ? null : [first, last];
}

function intervalRate(ordered: readonly bigint[]): number | null {
  const span = bounds(ordered);
  if (span === null) return null;
  const [first, last] = span;
  return first === last ? null : intervalFrequency(ordered.length, first, last);
}

function intervalFrequency(frames: number, first: bigint, last: bigint): number {
  return ((frames - 1) * 1e9) / nanoseconds(first, last);
}

function idleGaps(
  ordered: readonly bigint[],
  { windowStartNs, windowEndNs }: ObservationWindow,
): Readonly<{ leadingIdleMs: number; trailingIdleMs: number }> {
  const span = bounds(ordered);
  const duration = milliseconds(windowStartNs, windowEndNs);
  if (span === null) return { leadingIdleMs: duration, trailingIdleMs: duration };
  return presentedIdleGaps(span, { windowStartNs, windowEndNs });
}

function presentedIdleGaps(
  span: TimeSpan,
  { windowStartNs, windowEndNs }: ObservationWindow,
): Readonly<{ leadingIdleMs: number; trailingIdleMs: number }> {
  const [first, last] = span;
  return {
    leadingIdleMs: milliseconds(windowStartNs, first),
    trailingIdleMs: milliseconds(last, windowEndNs),
  };
}

function observe(ordered: readonly bigint[], window: ObservationWindow): Observation {
  const durationMs = milliseconds(window.windowStartNs, window.windowEndNs);
  const intervals = frameIntervals(ordered);
  const gaps = idleGaps(ordered, window);
  const maxFrameMs = intervals.at(-1) ?? null;
  return {
    frames: ordered.length,
    durationMs,
    fps: (ordered.length * 1000) / durationMs,
    intervalFps: intervalRate(ordered),
    ...gaps,
    maxFrameMs,
    p95FrameMs: intervals[Math.ceil(intervals.length * 0.95) - 1] ?? null,
    maxObservedGapMs: Math.max(gaps.leadingIdleMs, gaps.trailingIdleMs, maxFrameMs ?? 0),
  };
}

function reason(observation: Observation, options: RateOptions): RateReason {
  if (observation.durationMs < options.minimumDurationMs)
    return "insufficient_measurement_duration";
  if (observation.frames < 2) return "insufficient_presented_frames";
  if (
    observation.fps < options.targetFps ||
    (observation.intervalFps !== null && observation.intervalFps < options.targetFps)
  )
    return "below_requested_fps";
  return "requested_present_rate_met";
}

function windowFrames(timestamps: readonly bigint[], options: RateOptions): readonly bigint[] {
  if (timestamps.some((time) => !validTime(time)))
    throw new Error("Invalid actual-present timestamp");
  return orderedUnique(timestamps).filter(
    (time) => time >= options.windowStartNs && time < options.windowEndNs,
  );
}

export function assessPresentRate(timestamps: readonly bigint[], options: RateOptions): RateResult {
  validateOptions(options);
  const observation = observe(windowFrames(timestamps, options), options);
  const decision = reason(observation, options);
  return { pass: decision === "requested_present_rate_met", reason: decision, ...observation };
}
