import assert from "node:assert/strict";
import test from "node:test";
import { encodeSaveValue, decodeSaveValue } from "./core/local-save-value.js";

await test("save encoding rejects objects JSON would silently transform", () => {
  for (const value of [new Date(0), new Map(), new Set(), new Number(3)]) {
    assert.throws(() => encodeSaveValue(value), { message: "invalid_request" });
  }
});

await test("save encoding rejects sparse arrays and ignored properties", () => {
  const sparse = [1, , 3];
  const decorated = Object.assign([1], { note: "lost" });
  const hidden = Object.defineProperty({}, "score", { value: 7 });
  const symbolKey = { [Symbol("score")]: 7 };
  for (const value of [sparse, decorated, hidden, symbolKey]) {
    assert.throws(() => encodeSaveValue(value), { message: "invalid_request" });
  }
});

await test("save validation never invokes accessors or serialization hooks", () => {
  let calls = 0;
  const accessor = {
    get score() {
      calls++;
      return 7;
    },
  };
  const hooked = {
    toJSON() {
      calls++;
      return 7;
    },
  };
  assert.throws(() => encodeSaveValue(accessor), { message: "invalid_request" });
  assert.throws(() => encodeSaveValue(hooked), { message: "invalid_request" });
  assert.equal(calls, 0);
});

await test("ordinary JSON and shared non-cyclic children round trip", () => {
  const child = Object.freeze({ score: 7, label: "火" });
  const value = Object.freeze({ a: child, b: child, list: [null, true, 3] });
  assert.deepEqual(decodeSaveValue(encodeSaveValue(value)), value);
});
