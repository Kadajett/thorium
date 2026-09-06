import {
  changeLoopStatus,
  initialFrameClock,
  nextGameFrame,
  type FrameClock,
  type LoopStatus,
} from "./core/frame-clock.js";
import type { FramePerformanceOverlay } from "./frame-performance.js";
import type { HostConnection } from "./host.js";
import type { FrameDriver, SurfaceGame } from "./types.js";

interface FrameLoopOptions {
  readonly game: SurfaceGame;
  readonly host: HostConnection;
  readonly driver: FrameDriver;
  readonly maximumDeltaMs: number;
  readonly overlay: FramePerformanceOverlay | undefined;
}

interface LoopAdapterState {
  clock: FrameClock;
  handle: number;
}

function renderFrame(state: LoopAdapterState, options: FrameLoopOptions, nowMs: number): void {
  if (state.clock.status !== "active") return;
  const next = nextGameFrame(state.clock, nowMs, options.maximumDeltaMs);
  state.clock = next.clock;
  options.game.tick(next.frame);
  options.host.flushPeerMessages();
  options.overlay?.frame(nowMs);
}

function schedule(
  state: LoopAdapterState,
  driver: FrameDriver,
  frame: (nowMs: number) => void,
): void {
  if (state.clock.status === "active") state.handle = driver.request(frame);
}

function change(state: LoopAdapterState, options: FrameLoopOptions, status: LoopStatus): boolean {
  const next = changeLoopStatus(state.clock, status);
  if (next === state.clock) return false;
  state.clock = next;
  options.driver.cancel(state.handle);
  if (status === "suspended") options.overlay?.reset();
  if (status === "stopped") options.overlay?.remove();
  return true;
}

/** Only scheduling and authored game calls are effects; frame transitions are pure. */
export function createFrameLoop(options: FrameLoopOptions) {
  const state: LoopAdapterState = { clock: initialFrameClock, handle: 0 };
  const frame = (nowMs: number): void => {
    renderFrame(state, options, nowMs);
    schedule(state, options.driver, frame);
  };
  schedule(state, options.driver, frame);
  return {
    change(status: LoopStatus): void {
      if (change(state, options, status)) schedule(state, options.driver, frame);
    },
  };
}
