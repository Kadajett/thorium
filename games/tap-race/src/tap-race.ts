import {
  playerSlot,
  type DualSurfaceGame,
  type FrameContext,
  type GameContext,
  type JsonValue,
  type PlayerSlot,
  type SurfaceGame,
} from "@thorium/game-sdk";

const colors = ["#ff4d8d", "#42d9ff", "#ffd166", "#78e08f"] as const;
const finishScore = 50;

function drawingContext(context: GameContext): CanvasRenderingContext2D {
  const drawing = context.canvas.getContext("2d", { alpha: false });
  if (!drawing) throw new Error("Tap Race requires a Canvas 2D context");
  const view = context.viewport();
  drawing.setTransform(
    view.backingWidth / view.logicalWidth,
    0,
    0,
    view.backingHeight / view.logicalHeight,
    0,
    0,
  );
  return drawing;
}

function scoresPayload(scores: ReadonlyMap<PlayerSlot, number>): JsonValue {
  return Object.fromEntries([...scores].map(([slot, score]) => [String(slot), score]));
}

export class MainTapRace implements SurfaceGame {
  #context: GameContext | undefined;
  readonly #scores = new Map<PlayerSlot, number>();

  start(context: GameContext): void {
    this.#context = context;
    for (const player of context.players) this.#scores.set(player.slot, 0);
    context.host.onControl((event) => {
      if (event.control !== "tap" || event.phase !== "pressed") return;
      this.#scores.set(event.player, (this.#scores.get(event.player) ?? 0) + 1);
      context.host.sendToPeer("score", scoresPayload(this.#scores));
    });
  }

  tick(_frame: FrameContext): void {
    const context = this.#context;
    if (!context) return;
    const drawing = drawingContext(context);
    drawing.fillStyle = "#0d1020";
    drawing.fillRect(0, 0, 960, 540);
    drawing.textAlign = "center";
    drawing.textBaseline = "middle";
    drawing.font = "700 52px system-ui, sans-serif";
    drawing.fillStyle = "#ffffff";
    drawing.fillText("TAP RACE", 480, 70);

    const players = context.players.slice(0, 4);
    const cardWidth = 820 / Math.max(1, players.length);
    players.forEach((player, index) => {
      const score = this.#scores.get(player.slot) ?? 0;
      const x = 70 + index * cardWidth;
      drawing.fillStyle = colors[index % colors.length] ?? "#fff";
      drawing.fillRect(x + 10, 130, cardWidth - 20, 320);
      drawing.fillStyle = "#101322";
      drawing.font = "700 30px system-ui, sans-serif";
      drawing.fillText(player.displayName, x + cardWidth / 2, 190);
      drawing.font = "900 112px system-ui, sans-serif";
      drawing.fillText(String(score), x + cardWidth / 2, 315);
      drawing.font = "600 24px system-ui, sans-serif";
      drawing.fillText(score >= finishScore ? "WINNER!" : `${finishScore - score} TO GO`, x + cardWidth / 2, 410);
    });
  }

  score(slot: PlayerSlot): number {
    return this.#scores.get(slot) ?? 0;
  }
}

export class CompanionTapRace implements SurfaceGame {
  #context: GameContext | undefined;
  readonly #controlledPlayerSlots = new Set<PlayerSlot>();
  readonly #scores = new Map<PlayerSlot, number>();

  start(context: GameContext): void {
    this.#context = context;
    for (const slot of context.host.bootstrap.controlledPlayerSlots) {
      this.#controlledPlayerSlots.add(slot);
      this.#scores.set(slot, 0);
    }
    context.host.onPeer("score", ({ payload }) => {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return;
      for (const [rawSlot, rawScore] of Object.entries(payload)) {
        const numericSlot = Number(rawSlot);
        if (
          !Number.isInteger(numericSlot) ||
          numericSlot < 0 ||
          numericSlot > 15 ||
          typeof rawScore !== "number" ||
          !Number.isInteger(rawScore)
        ) continue;
        const slot = playerSlot(numericSlot);
        if (this.#controlledPlayerSlots.has(slot)) this.#scores.set(slot, rawScore);
      }
    });
    context.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const controlledPlayers = this.#controlledPlayers(context);
      if (controlledPlayers.length === 0) return;
      const rect = context.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const cellWidth = rect.width / controlledPlayers.length;
      const index = Math.min(controlledPlayers.length - 1, Math.max(0, Math.floor(x / cellWidth)));
      const player = controlledPlayers[index];
      if (!player) return;
      context.host.emitControl({
        control: "tap",
        player: player.slot,
        phase: "pressed",
        value: 1,
      });
    });
  }

  tick(_frame: FrameContext): void {
    const context = this.#context;
    if (!context) return;
    const drawing = drawingContext(context);
    drawing.fillStyle = "#090b13";
    drawing.fillRect(0, 0, 960, 540);
    const players = this.#controlledPlayers(context);
    const cardWidth = 960 / Math.max(1, players.length);
    players.forEach((player, index) => {
      const x = index * cardWidth;
      drawing.fillStyle = colors[player.slot % colors.length] ?? "#fff";
      drawing.fillRect(x + 18, 18, cardWidth - 36, 504);
      drawing.fillStyle = "#111526";
      drawing.textAlign = "center";
      drawing.textBaseline = "middle";
      drawing.font = "800 44px system-ui, sans-serif";
      drawing.fillText(player.displayName, x + cardWidth / 2, 125);
      drawing.font = "900 100px system-ui, sans-serif";
      drawing.fillText(String(this.#scores.get(player.slot) ?? 0), x + cardWidth / 2, 270);
      drawing.font = "900 56px system-ui, sans-serif";
      drawing.fillText("TAP!", x + cardWidth / 2, 425);
    });
  }

  score(slot: PlayerSlot): number {
    return this.#scores.get(slot) ?? 0;
  }

  #controlledPlayers(context: GameContext): GameContext["players"] {
    return context.players.filter((player) => this.#controlledPlayerSlots.has(player.slot));
  }
}

export const tapRace: DualSurfaceGame = {
  main: () => new MainTapRace(),
  companion: () => new CompanionTapRace(),
};
