import { initialPerformanceState, samplePerformance } from "./core/frame-clock.js";

export interface FramePerformanceMeter {
  readonly frame: (nowMs: number) => void;
  readonly reset: () => void;
}

/** Samples completed game frames, never a second animation loop or server ticks. */
export function createFramePerformance(show: (text: string) => void): FramePerformanceMeter {
  let state = initialPerformanceState;
  return {
    frame(nowMs: number): void {
      const sample = samplePerformance(state, nowMs);
      state = sample.state;
      sample.labels.forEach(show);
    },
    reset(): void {
      state = initialPerformanceState;
      show("FPS —");
    },
  };
}

/** Constructible compatibility adapter around the factory; no sampling state. */
export class FramePerformance implements FramePerformanceMeter {
  readonly frame: FramePerformanceMeter["frame"];
  readonly reset: FramePerformanceMeter["reset"];
  constructor(show: (text: string) => void) {
    const meter = createFramePerformance(show);
    this.frame = meter.frame;
    this.reset = meter.reset;
  }
}

export interface FramePerformanceOverlay {
  frame(nowMs: number): void;
  reset(): void;
  remove(): void;
}

export function createFramePerformanceOverlay(): FramePerformanceOverlay | undefined {
  if (typeof document === "undefined") return undefined;
  const container = document.createElement("div");
  container.dataset.thoriumFps = "true";
  container.setAttribute("aria-hidden", "true");
  // Isolate the label from authored game CSS and never enter controller/touch focus.
  container.style.cssText =
    "all:initial!important;position:fixed!important;top:max(4px,env(safe-area-inset-top))!important;right:max(4px,env(safe-area-inset-right))!important;z-index:2147483647!important;pointer-events:none!important;user-select:none!important;";
  const label = document.createElement("span");
  label.style.cssText =
    "display:block;padding:3px 5px;border-radius:3px;background:#000b;color:#fff;font:11px/1.3 monospace;white-space:nowrap;pointer-events:none;user-select:none;";
  container.attachShadow({ mode: "closed" }).append(label);
  const meter = createFramePerformance((text) => {
    label.textContent = text;
  });
  meter.reset();
  document.body.append(container);
  return {
    frame: meter.frame,
    reset: meter.reset,
    remove: () => {
      container.remove();
    },
  };
}
