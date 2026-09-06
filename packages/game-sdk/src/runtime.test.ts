import assert from "node:assert/strict";
import test from "node:test";
import { runGame, type RunningGame, type RunGameOptions } from "./runtime.js";
import { ManualFrameDriver } from "./testing.js";
import {
  canvasDocument,
  emptyGame,
  overlayDocument,
  restoreGlobals,
  runtimeHost,
} from "./quality-runtime-fixtures.js";

function advance(driver: ManualFrameDriver, start: number, count: number, interval: number): void {
  for (let frame = 0; frame <= count; frame++) driver.advance(start + frame * interval);
}
function verifyOverlay(fixture: ReturnType<typeof overlayDocument>): void {
  assert.equal(fixture.mounts(), 1);
  const container = fixture.element(0),
    label = fixture.element(1);
  assert.equal(container.attributes["aria-hidden"], "true");
  assert.match(container.style.cssText, /pointer-events:none/);
  assert.equal(label.textContent, "FPS —");
}
function verifyLifecycle(
  fixture: ReturnType<typeof overlayDocument>,
  host: ReturnType<typeof runtimeHost>,
  driver: ManualFrameDriver,
): void {
  const label = fixture.element(1);
  advance(driver, 0, 50, 20);
  assert.equal(label.textContent, "50 FPS · 20.0 ms");
  host.deliver({ kind: "lifecycle", state: "suspended" });
  assert.throws(() => {
    driver.advance(2_000);
  }, /No frame/);
  assert.equal(label.textContent, "FPS —");
  host.deliver({ kind: "lifecycle", state: "active" });
  advance(driver, 60_000, 25, 40);
  assert.equal(label.textContent, "25 FPS · 40.0 ms");
  host.deliver({ kind: "lifecycle", state: "stopped" });
  assert.equal(fixture.element(0).removed, true);
  assert.throws(() => {
    driver.advance(62_000);
  }, /No frame/);
}
await test("default FPS overlay follows game frames and lifecycle; opt-out creates no DOM", async () => {
  const restore = restoreGlobals(["document"]),
    fixture = overlayDocument();
  const host = runtimeHost("dev.yougotserved.fps-test"),
    driver = new ManualFrameDriver();
  const options = overlayOptions(host, driver);
  let running: RunningGame | undefined;
  try {
    running = await runGame(emptyGame, options);
    verifyOverlay(fixture);
    verifyLifecycle(fixture, host, driver);
    running.stop();
    running = await runGame(emptyGame, { ...options, fpsOverlay: false });
    advance(driver, 0, 50, 20);
    assert.equal(fixture.mounts(), 1);
    assert.equal(fixture.elements.length, 2);
  } finally {
    running?.stop();
    restore();
  }
});
function overlayOptions(
  host: ReturnType<typeof runtimeHost>,
  driver: ManualFrameDriver,
): RunGameOptions {
  return {
    host: host.host,
    canvas: { width: 960, height: 540 } as HTMLCanvasElement,
    autoResize: false,
    frameDriver: driver,
  };
}
function verifyCanvas(
  fixture: ReturnType<typeof canvasDocument>,
  width: number,
  backing: number,
): void {
  assert.deepEqual(fixture.canvas.getBoundingClientRect(), { width, height: 540 });
  assert.equal(fixture.canvas.width, backing);
  assert.equal(fixture.canvas.height, 1080);
}
await test("auto-managed predeclared canvas cannot feed DPR-scaled backing pixels into its layout", async () => {
  const restore = restoreGlobals(["document", "ResizeObserver", "devicePixelRatio"]);
  const fixture = canvasDocument(),
    host = runtimeHost("dev.yougotserved.canvas-test");
  let running: RunningGame | undefined;
  try {
    running = await runGame(emptyGame, {
      host: host.host,
      frameDriver: new ManualFrameDriver(),
      fpsOverlay: false,
    });
    verifyResizeSequence(fixture);
  } finally {
    running?.stop();
    restore();
  }
});
function verifyResizeSequence(fixture: ReturnType<typeof canvasDocument>): void {
  for (let count = 0; count < 3; count++) fixture.resize();
  verifyCanvas(fixture, 960, 1920);
  assert.equal(
    fixture.replacements(),
    0,
    "Adopting an existing canvas must preserve its surrounding DOM",
  );
  fixture.width(620);
  fixture.resize();
  fixture.resize();
  verifyCanvas(fixture, 620, 1240);
}
