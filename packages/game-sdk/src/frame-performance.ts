/** Samples completed game frames, never a second animation loop or server ticks. */
export class FramePerformance {
  #startedAt: number | undefined;
  #previousAt: number | undefined;
  #intervals = 0;

  constructor(private readonly show: (text: string) => void) {}

  frame(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    if (this.#previousAt !== undefined && nowMs <= this.#previousAt) {
      this.reset();
    }
    this.#previousAt = nowMs;
    if (this.#startedAt === undefined) {
      this.#startedAt = nowMs;
      return;
    }
    this.#intervals++;
    const elapsed = nowMs - this.#startedAt;
    if (elapsed < 1_000) return;
    this.show(`${Math.round(this.#intervals * 1_000 / elapsed)} FPS · ${(elapsed / this.#intervals).toFixed(1)} ms`);
    this.#startedAt = nowMs;
    this.#intervals = 0;
  }

  reset(): void {
    this.#startedAt = undefined;
    this.#previousAt = undefined;
    this.#intervals = 0;
    this.show("FPS —");
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
  container.style.cssText = "all:initial!important;position:fixed!important;top:max(4px,env(safe-area-inset-top))!important;right:max(4px,env(safe-area-inset-right))!important;z-index:2147483647!important;pointer-events:none!important;user-select:none!important;";
  const label = document.createElement("span");
  label.style.cssText = "display:block;padding:3px 5px;border-radius:3px;background:#000b;color:#fff;font:11px/1.3 monospace;white-space:nowrap;pointer-events:none;user-select:none;";
  container.attachShadow({ mode: "closed" }).append(label);
  const meter = new FramePerformance((text) => { label.textContent = text; });
  meter.reset();
  document.body.append(container);
  return {
    frame: (nowMs) => meter.frame(nowMs),
    reset: () => meter.reset(),
    remove: () => container.remove(),
  };
}
