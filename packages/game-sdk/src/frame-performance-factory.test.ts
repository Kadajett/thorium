import assert from "node:assert/strict";
import test from "node:test";
import { createFramePerformance } from "./frame-performance.js";

await test("independent meter factories cannot mutate each other's clock state", () => {
  const firstLabels: string[] = [];
  const secondLabels: string[] = [];
  const first = createFramePerformance((label) => {
    firstLabels.push(label);
  });
  const second = createFramePerformance((label) => {
    secondLabels.push(label);
  });
  first.frame(0);
  first.frame(1000);
  second.frame(500);
  first.reset();
  second.frame(1500);
  assert.deepEqual(firstLabels, ["1 FPS · 1000.0 ms", "FPS —"]);
  assert.deepEqual(secondLabels, ["1 FPS · 1000.0 ms"]);
});

await test("nonmonotonic meter reset preserves its first subsequent interval", () => {
  const labels: string[] = [];
  const meter = createFramePerformance((label) => {
    labels.push(label);
  });
  meter.frame(10_000);
  meter.frame(10_500);
  meter.frame(5);
  meter.frame(1005);
  assert.deepEqual(labels, ["FPS —", "1 FPS · 1000.0 ms"]);
});
