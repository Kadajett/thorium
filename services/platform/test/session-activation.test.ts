import { expect, it } from "vitest";
import { normalizeActivation } from "../src/core/session-activation.js";

const release = Object.freeze({
  packageId: "dev.thorium.test",
  version: "0.1.0",
  contentDigest: "a".repeat(64),
});
const main = Object.freeze({
  surfaceId: "upper",
  role: "main",
  playerSlots: Object.freeze([3, 1]),
});
const companion = Object.freeze({
  surfaceId: "lower",
  role: "companion",
  playerSlots: Object.freeze([2, 0]),
});
const request = Object.freeze({
  requestId: "request",
  accountId: "account",
  release,
  surfaces: Object.freeze([companion, main]),
});

it("normalizes order deterministically without mutating caller-owned data", () => {
  const first = normalizeActivation(request);
  const second = normalizeActivation({ ...request, surfaces: [main, companion] });
  expect(first).toEqual(second);
  expect(first).toMatchObject({ surfaces: [{ playerSlots: [1, 3] }, { playerSlots: [0, 2] }] });
  expect(request.surfaces).toEqual([companion, main]);
  expect(main.playerSlots).toEqual([3, 1]);
});

it.each([null, undefined, [], "request", 123])("rejects malformed top-level input %s", (input) => {
  expect(normalizeActivation(input)).toMatchObject({
    ok: false,
    conflict: { code: "INVALID_ACTIVATION" },
  });
});

it.each(
  [
    [],
    [null],
    [main, main],
    [{ ...main, playerSlots: [] }],
    [{ ...main, role: "other" }],
    [{ ...main, playerSlots: [1, 1] }],
    [{ ...main, playerSlots: [16] }],
    [{ ...main, playerSlots: ["1"] }],
    [{ ...main, playerSlots: [0.5] }],
    [{ ...main, playerSlots: [NaN] }],
    [main, { ...companion, playerSlots: [3] }],
  ].map((surfaces) => ({ surfaces })),
)("rejects malformed, duplicate, empty or overlapping leases %j", ({ surfaces }) => {
  expect(normalizeActivation({ ...request, surfaces })).toMatchObject({ ok: false });
});

it("does not allow extra release metadata into the persisted fingerprint", () => {
  expect(normalizeActivation({ ...request, release: { ...release, unexpected: true } })).toEqual(
    normalizeActivation(request),
  );
});
