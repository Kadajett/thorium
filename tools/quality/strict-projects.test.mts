import assert from "node:assert/strict";
import { test } from "node:test";
import { missingStrictFlags } from "./strict-projects.mts";

await test("strict alone cannot replace the additional compiler safeguards", () => {
  assert.deepEqual(missingStrictFlags({ strict: true }), [
    "noUncheckedIndexedAccess",
    "exactOptionalPropertyTypes",
    "noImplicitReturns",
    "noImplicitOverride",
    "noFallthroughCasesInSwitch",
  ]);
});

await test("all strict options are required and false is not treated as missing/default", () => {
  const options = {
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitReturns: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
  };
  assert.deepEqual(missingStrictFlags(options), []);
  assert.deepEqual(missingStrictFlags({ ...options, strict: false }), ["strict"]);
  assert.deepEqual(
    missingStrictFlags({ ...options, noImplicitAny: false, strictNullChecks: false }),
    ["noImplicitAny", "strictNullChecks"],
  );
});
