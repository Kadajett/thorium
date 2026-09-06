import { expect, it } from "vitest";
import { boundedJsonObject } from "../src/core/bounded-json.js";
import { canonicalJson } from "../src/canonical-json.js";

it("returns a canonical detached snapshot without mutating input", () => {
  const input: { z: Readonly<{ b: number; a: boolean }>[]; a: number } = {
    z: [Object.freeze({ b: 1, a: true })],
    a: -0,
  };
  const result = boundedJsonObject(input, "scope");
  input.z.push({ b: 2, a: false });
  expect(JSON.stringify(result)).toBe('{"a":0,"z":[{"a":true,"b":1}]}');
  expect(Object.is(result["a"], -0)).toBe(false);
});

it.each([null, 0, false, "text", [], undefined].map((value) => ({ value })))(
  "rejects a non-object root: $value",
  ({ value }) => {
    expect(() => boundedJsonObject(value, "scope")).toThrow("scope_must_be_an_object");
  },
);

it.each([Infinity, -Infinity, NaN])("rejects non-finite number %s", (value) => {
  expect(() => boundedJsonObject({ value }, "scope")).toThrow("scope_invalid_number");
});

it.each([undefined, 1n, Symbol("value")])("rejects non-JSON member %s", (value) => {
  expect(() => boundedJsonObject({ value }, "scope")).toThrow("scope_invalid_value");
});

it.each(["__proto__", "constructor", "prototype"])("rejects unsafe member %s", (key) => {
  expect(() => boundedJsonObject({ [key]: 0 }, "scope")).toThrow("scope_unsafe_key");
});

it("counts array and object members across the whole input", () => {
  const maximum = { values: Array.from({ length: 255 }, () => 0) };
  const exceeded = { values: Array.from({ length: 256 }, () => 0) };
  expect(boundedJsonObject(maximum, "scope")).toEqual(maximum);
  expect(() => boundedJsonObject(exceeded, "scope")).toThrow("scope_too_many_members");
});

function nested(depth: number): unknown {
  return depth === 0 ? 0 : { value: nested(depth - 1) };
}

it("keeps the depth-eight boundary and fails cycles closed", () => {
  expect(boundedJsonObject(nested(8), "scope")).toEqual(nested(8));
  expect(() => boundedJsonObject(nested(9), "scope")).toThrow("scope_too_deep");
  const cyclic: Record<string, unknown> = {};
  cyclic["value"] = cyclic;
  expect(() => boundedJsonObject(cyclic, "scope")).toThrow("scope_too_deep");
});

it("uses UTF-8 byte size rather than UTF-16 string length", () => {
  const exact = { text: "x".repeat(4085) };
  expect(boundedJsonObject(exact, "scope")).toEqual(exact);
  expect(() => boundedJsonObject({ text: "x".repeat(4086) }, "scope")).toThrow("scope_too_large");
  expect(() => boundedJsonObject({ text: "😀".repeat(1022) }, "scope")).toThrow("scope_too_large");
});

it("rejects sparse arrays rather than silently skipping missing members", () => {
  expect(() => boundedJsonObject({ values: new Array<unknown>(1) }, "scope")).toThrow(
    "scope_invalid_value",
  );
});

it("keeps canonical release hashing order and rejects unsupported values", () => {
  expect(canonicalJson({ z: [2, 1], a: { c: true, b: null } })).toBe(
    '{"a":{"b":null,"c":true},"z":[2,1]}',
  );
  expect(() => canonicalJson(NaN)).toThrow("non_finite_canonical_json");
  expect(() => canonicalJson(undefined)).toThrow("unsupported_canonical_json_value");
});
