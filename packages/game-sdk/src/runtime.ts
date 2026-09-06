import { createHostClient, type HostClient } from "./host.js";
import { createFramePerformanceOverlay } from "./frame-performance.js";
import { createFrameLoop } from "./frame-loop.js";
import { ensureCanvas, observeCanvas, viewport } from "./canvas.js";
import {
  SurfaceRole,
  type DualSurfaceGame,
  type FrameDriver,
  type GameContext,
  type HostTransport,
  type SurfaceGame,
} from "./types.js";

const browserFrameDriver: FrameDriver = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => {
    window.cancelAnimationFrame(handle);
  },
};

export interface RunGameOptions {
  readonly host?: HostClient;
  readonly transport?: HostTransport;
  readonly canvas?: HTMLCanvasElement;
  readonly frameDriver?: FrameDriver;
  readonly autoResize?: boolean;
  readonly maximumDeltaMs?: number;
  /** Per-surface game-loop FPS / average frame interval. Enabled by default. */
  readonly fpsOverlay?: boolean;
}

export interface RunningGame {
  readonly host: HostClient;
  readonly game: SurfaceGame;
  stop(): void;
}

function gameContext(canvas: HTMLCanvasElement, host: HostClient): GameContext {
  return {
    surface: host.bootstrap.surface,
    canvas,
    host,
    players: host.bootstrap.players,
    viewport: () => viewport(canvas, host),
  };
}

function startLoop(
  game: SurfaceGame,
  host: HostClient,
  options: RunGameOptions,
  disconnectResize: () => void,
): () => void {
  const loop = createFrameLoop({
    game,
    host,
    driver: options.frameDriver ?? browserFrameDriver,
    maximumDeltaMs: options.maximumDeltaMs ?? 50,
    overlay: options.fpsOverlay === false ? undefined : createFramePerformanceOverlay(),
  });
  let stopped = false;
  let unsubscribe = (): void => undefined;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    loop.change("stopped");
    disconnectResize();
    unsubscribe();
  };
  unsubscribe = host.onLifecycle((state) => {
    if (state === "stopped") stop();
    else loop.change(state);
  });
  return stop;
}

export async function runGame(
  definition: DualSurfaceGame,
  options: RunGameOptions = {},
): Promise<RunningGame> {
  const host = options.host ?? (await createHostClient(options.transport));
  const canvas = options.canvas ?? ensureCanvas();
  const game =
    host.bootstrap.surface === SurfaceRole.Main ? definition.main() : definition.companion();
  const disconnectResize =
    options.autoResize === false ? (): void => undefined : observeCanvas(canvas, host);
  await game.start(gameContext(canvas, host));
  host.ready();
  return { host, game, stop: startLoop(game, host, options, disconnectResize) };
}
