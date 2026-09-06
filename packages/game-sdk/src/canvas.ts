import type { HostConnection } from "./host.js";
import type { Viewport } from "./types.js";

export function ensureCanvas(): HTMLCanvasElement {
  const existing = document.querySelector<HTMLCanvasElement>("canvas[data-thorium-game]");
  const canvas = existing ?? document.createElement("canvas");
  if (existing === null) {
    canvas.dataset.thoriumGame = "true";
    canvas.setAttribute("aria-label", "Game surface");
    document.body.replaceChildren(canvas);
  }
  Object.assign(document.documentElement.style, { width: "100%", height: "100%", margin: "0" });
  Object.assign(document.body.style, {
    width: "100%",
    height: "100%",
    margin: "0",
    overflow: "hidden",
    touchAction: "none",
    background: "#000",
  });
  // Independent CSS dimensions prevent DPR backing pixels feeding back into layout.
  Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
  return canvas;
}

function devicePixelRatio(host: HostConnection): number {
  const ratio = globalThis.devicePixelRatio || 1;
  return Math.min(ratio, host.bootstrap.render.maximumDevicePixelRatio);
}

function resizeCanvas(canvas: HTMLCanvasElement, host: HostConnection): void {
  const render = host.bootstrap.render;
  const rect = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio(host);
  const width = Math.max(1, Math.round((rect.width || render.logicalWidth) * dpr));
  const height = Math.max(1, Math.round((rect.height || render.logicalHeight) * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

export function observeCanvas(canvas: HTMLCanvasElement, host: HostConnection): () => void {
  const resize = (): void => {
    resizeCanvas(canvas, host);
  };
  resize();
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }
  window.addEventListener("resize", resize);
  return () => {
    window.removeEventListener("resize", resize);
  };
}

export function viewport(canvas: HTMLCanvasElement, host: HostConnection): Viewport {
  const render = host.bootstrap.render;
  return {
    logicalWidth: render.logicalWidth,
    logicalHeight: render.logicalHeight,
    backingWidth: canvas.width,
    backingHeight: canvas.height,
    devicePixelRatio: devicePixelRatio(host),
  };
}
