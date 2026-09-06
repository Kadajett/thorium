import type { FrameContext } from "../types.js";

export type LoopStatus = "active" | "suspended" | "stopped";
export interface FrameClock {
  readonly status: LoopStatus;
  readonly number: number;
  readonly previousNow: number | undefined;
}

export const initialFrameClock: FrameClock = {
  status: "active",
  number: 0,
  previousNow: undefined,
};

export function changeLoopStatus(clock: FrameClock, status: LoopStatus): FrameClock {
  if (clock.status === "stopped" || clock.status === status) return clock;
  return { ...clock, status, previousNow: undefined };
}

interface FrameStep {
  readonly clock: FrameClock;
  readonly frame: FrameContext;
}

function frameContext(clock: FrameClock, nowMs: number, maximumDeltaMs: number): FrameContext {
  const deltaMs =
    clock.previousNow === undefined ? 0 : Math.min(maximumDeltaMs, nowMs - clock.previousNow);
  return { number: clock.number, nowMs, deltaMs };
}

export function nextGameFrame(clock: FrameClock, nowMs: number, maximumDeltaMs: number): FrameStep {
  return {
    clock: { ...clock, previousNow: nowMs, number: clock.number + 1 },
    frame: frameContext(clock, nowMs, maximumDeltaMs),
  };
}

export interface PerformanceState {
  readonly startedAt: number | undefined;
  readonly previousAt: number | undefined;
  readonly intervals: number;
}

export const initialPerformanceState: PerformanceState = {
  startedAt: undefined,
  previousAt: undefined,
  intervals: 0,
};
interface PerformanceSample {
  readonly state: PerformanceState;
  readonly labels: readonly string[];
}

function advancePerformance(state: PerformanceState, nowMs: number): PerformanceSample {
  if (state.startedAt === undefined)
    return { state: { ...state, startedAt: nowMs, previousAt: nowMs }, labels: [] };
  return completePerformance(
    { ...state, previousAt: nowMs, intervals: state.intervals + 1 },
    nowMs - state.startedAt,
  );
}

function performanceLabel(intervals: number, elapsed: number): string {
  const fps = Math.round((intervals * 1_000) / elapsed);
  return String(fps) + " FPS · " + (elapsed / intervals).toFixed(1) + " ms";
}

function completePerformance(state: PerformanceState, elapsed: number): PerformanceSample {
  if (elapsed < 1_000) return { state, labels: [] };
  return {
    state: { ...state, startedAt: state.previousAt, intervals: 0 },
    labels: [performanceLabel(state.intervals, elapsed)],
  };
}

function resetPerformance(nowMs: number): PerformanceSample {
  const sample = advancePerformance(initialPerformanceState, nowMs);
  return { ...sample, labels: ["FPS —", ...sample.labels] };
}

export function samplePerformance(state: PerformanceState, nowMs: number): PerformanceSample {
  if (!Number.isFinite(nowMs)) return { state, labels: [] };
  if (state.previousAt === undefined || nowMs > state.previousAt)
    return advancePerformance(state, nowMs);
  return resetPerformance(nowMs);
}
