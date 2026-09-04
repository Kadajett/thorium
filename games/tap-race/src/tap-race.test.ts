import assert from "node:assert/strict";
import test from "node:test";
import { playerSlot, type FrameContext, type GameContext } from "@thorium/game-sdk";
import { createTestDevice, twoPlayersOneAccount } from "@thorium/game-sdk/testing";
import { CompanionTapRace, MainTapRace } from "./tap-race.ts";

function fakeCanvas(): {
  canvas: HTMLCanvasElement;
  pointerDown(x: number): void;
  drawCalls: string[];
  renderedText: string[];
} {
  const listeners = new Map<string, (event: PointerEvent) => void>();
  const drawCalls: string[] = [];
  const renderedText: string[] = [];
  const drawing = {
    fillStyle: "",
    font: "",
    textAlign: "center",
    textBaseline: "middle",
    setTransform: () => undefined,
    fillRect: () => drawCalls.push("rect"),
    fillText: (text: string) => {
      drawCalls.push("text");
      renderedText.push(text);
    },
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 960,
    height: 540,
    getContext: () => drawing,
    addEventListener: (name: string, listener: (event: PointerEvent) => void) => listeners.set(name, listener),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    drawCalls,
    renderedText,
    pointerDown(x: number) {
      listeners.get("pointerdown")?.({ clientX: x, preventDefault: () => undefined } as PointerEvent);
    },
  };
}

function context(canvas: HTMLCanvasElement, host: GameContext["host"]): GameContext {
  return {
    surface: host.bootstrap.surface,
    canvas,
    host,
    players: host.bootstrap.players,
    viewport: () => ({
      logicalWidth: 960,
      logicalHeight: 540,
      backingWidth: 960,
      backingHeight: 540,
      devicePixelRatio: 1,
    }),
  };
}

const frame: FrameContext = { number: 0, nowMs: 0, deltaMs: 0 };

test("one AccountSession exposes two slots while companion input stays surface-scoped", () => {
  const device = createTestDevice({
    gameId: "dev.yougotserved.tap-race",
    accountSessions: twoPlayersOneAccount,
    controls: [{ id: "tap", label: "Tap", kind: "button" }],
  });
  const mainCanvas = fakeCanvas();
  const companionCanvas = fakeCanvas();
  const main = new MainTapRace();
  const companion = new CompanionTapRace();
  main.start(context(mainCanvas.canvas, device.main));
  companion.start(context(companionCanvas.canvas, device.companion));

  companionCanvas.pointerDown(100);
  companionCanvas.pointerDown(800);
  companionCanvas.pointerDown(800);
  device.main.flushPeerMessages();
  main.tick(frame);
  companion.tick(frame);

  assert.equal(device.accountSessions.length, 1);
  assert.deepEqual(device.accountSessions[0]?.playerSlots, [playerSlot(0), playerSlot(1)]);
  assert.equal(main.score(playerSlot(0)), 0);
  assert.equal(main.score(playerSlot(1)), 3);
  assert.equal(companion.score(playerSlot(0)), 0);
  assert.equal(companion.score(playerSlot(1)), 3);
  assert.ok(mainCanvas.drawCalls.includes("text"), "main screen was drawn");
  assert.ok(companionCanvas.drawCalls.includes("rect"), "companion screen was drawn");
  assert.ok(mainCanvas.renderedText.includes("Player 1"), "main renders the full roster");
  assert.ok(mainCanvas.renderedText.includes("Player 2"), "main renders the full roster");
  assert.equal(companionCanvas.renderedText.includes("Player 1"), false);
  assert.ok(companionCanvas.renderedText.includes("Player 2"), "companion renders its lease");
  assert.equal(JSON.stringify(device.main.bootstrap).includes("account-session:test-only"), false);
});
