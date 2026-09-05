import { createHostClient, HostClient } from "./host.js";
import {
  SurfaceRole,
  type DualSurfaceGame,
  type FrameDriver,
  type GameContext,
  type HostTransport,
  type SurfaceGame,
  type Viewport,
} from "./types.js";

const browserFrameDriver: FrameDriver = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

export interface RunGameOptions {
  readonly host?: HostClient;
  readonly transport?: HostTransport;
  readonly canvas?: HTMLCanvasElement;
  readonly frameDriver?: FrameDriver;
  readonly autoResize?: boolean;
  readonly maximumDeltaMs?: number;
}

export interface RunningGame {
  readonly host: HostClient;
  readonly game: SurfaceGame;
  stop(): void;
}

function ensureCanvas(): HTMLCanvasElement {
  const existing = document.querySelector<HTMLCanvasElement>("canvas[data-thorium-game]");
  const canvas = existing ?? document.createElement("canvas");
  if (!existing) {
    canvas.dataset.thoriumGame = "true";
    canvas.setAttribute("aria-label", "Game surface");
    document.body.replaceChildren(canvas);
  }
  // A predeclared canvas needs the same independent CSS size as a new one.
  // Otherwise its intrinsic backing size feeds back into ResizeObserver at DPR > 1.
  Object.assign(document.documentElement.style, { width: "100%", height: "100%", margin: "0" });
  Object.assign(document.body.style, {
    width: "100%",
    height: "100%",
    margin: "0",
    overflow: "hidden",
    touchAction: "none",
    background: "#000",
  });
  Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
  return canvas;
}

function resizeCanvas(canvas: HTMLCanvasElement, host: HostClient): void {
  const render = host.bootstrap.render;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(globalThis.devicePixelRatio || 1, render.maximumDevicePixelRatio);
  const width = Math.max(1, Math.round((rect.width || render.logicalWidth) * dpr));
  const height = Math.max(1, Math.round((rect.height || render.logicalHeight) * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function viewport(canvas: HTMLCanvasElement, host: HostClient): Viewport {
  const render = host.bootstrap.render;
  return {
    logicalWidth: render.logicalWidth,
    logicalHeight: render.logicalHeight,
    backingWidth: canvas.width,
    backingHeight: canvas.height,
    devicePixelRatio: Math.min(globalThis.devicePixelRatio || 1, render.maximumDevicePixelRatio),
  };
}

export async function runGame(
  definition: DualSurfaceGame,
  options: RunGameOptions = {},
): Promise<RunningGame> {
  const host = options.host ?? (await createHostClient(options.transport));
  const canvas = options.canvas ?? ensureCanvas();
  const driver = options.frameDriver ?? browserFrameDriver;
  const game =
    host.bootstrap.surface === SurfaceRole.Main ? definition.main() : definition.companion();

  let resizeObserver: ResizeObserver | undefined;
  let fallbackResize: (() => void) | undefined;
  if (options.autoResize !== false) {
    resizeCanvas(canvas, host);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => resizeCanvas(canvas, host));
      resizeObserver.observe(canvas);
    } else {
      fallbackResize = () => resizeCanvas(canvas, host);
      window.addEventListener("resize", fallbackResize);
    }
  }

  const context: GameContext = {
    surface: host.bootstrap.surface,
    canvas,
    host,
    players: host.bootstrap.players,
    viewport: () => viewport(canvas, host),
  };
  await game.start(context);
  host.ready();

  let stopped = false;
  let active = true;
  let frameHandle = 0;
  let frameNumber = 0;
  let previousNow: number | undefined;
  const maximumDeltaMs = options.maximumDeltaMs ?? 50;

  const frame = (nowMs: number) => {
    if (stopped || !active) return;
    const deltaMs = previousNow === undefined ? 0 : Math.min(maximumDeltaMs, nowMs - previousNow);
    previousNow = nowMs;
    game.tick({ number: frameNumber++, nowMs, deltaMs });
    host.flushPeerMessages();
    frameHandle = driver.request(frame);
  };
  frameHandle = driver.request(frame);

  let unsubscribeLifecycle: () => void = () => undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    driver.cancel(frameHandle);
    resizeObserver?.disconnect();
    if (fallbackResize) window.removeEventListener("resize", fallbackResize);
    unsubscribeLifecycle();
  };
  unsubscribeLifecycle = host.onLifecycle((state) => {
    if (state === "suspended" && active) {
      active = false;
      driver.cancel(frameHandle);
      previousNow = undefined;
    } else if (state === "active" && !active && !stopped) {
      active = true;
      frameHandle = driver.request(frame);
    } else if (state === "stopped") {
      stop();
    }
  });

  return {
    host,
    game,
    stop,
  };
}
