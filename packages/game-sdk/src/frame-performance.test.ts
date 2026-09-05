import assert from "node:assert/strict";
import test from "node:test";
import { FramePerformance } from "./frame-performance.js";

test("FPS counts actual game intervals and updates at most once per second", () => {
  const labels: string[] = [];
  const meter = new FramePerformance((text) => labels.push(text));
  for (let frame = 0; frame < 50; frame++) meter.frame(frame * 20);
  assert.deepEqual(labels, []);
  meter.frame(1_000);
  assert.deepEqual(labels, ["50 FPS · 20.0 ms"]);
  for (let frame = 1; frame <= 25; frame++) meter.frame(1_000 + frame * 40);
  assert.deepEqual(labels, ["50 FPS · 20.0 ms", "25 FPS · 40.0 ms"]);
});

test("long frames remain visible instead of using the simulation delta clamp", () => {
  const labels: string[] = [];
  const meter = new FramePerformance((text) => labels.push(text));
  meter.frame(0);
  meter.frame(2_000);
  assert.deepEqual(labels, ["1 FPS · 2000.0 ms"]);
});

test("resume resets sampling so background time does not depress FPS", () => {
  const labels: string[] = [];
  const meter = new FramePerformance((text) => labels.push(text));
  meter.frame(0);
  meter.frame(20);
  meter.reset();
  for (let frame = 0; frame <= 50; frame++) meter.frame(60_000 + frame * 20);
  assert.deepEqual(labels, ["FPS —", "50 FPS · 20.0 ms"]);
});

test("invalid or nonmonotonic clock samples cannot produce invalid labels", () => {
  const labels: string[] = [];
  const meter = new FramePerformance((text) => labels.push(text));
  meter.frame(100);
  meter.frame(Number.NaN);
  meter.frame(Number.POSITIVE_INFINITY);
  meter.frame(0);
  meter.frame(1_000);
  assert.deepEqual(labels, ["FPS —", "1 FPS · 1000.0 ms"]);
});
