import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { qualityConfig } from "./config.mts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const filePath = fileURLToPath(new URL("./fixtures/core/pure.mts", import.meta.url));
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: true,
  overrideConfig: qualityConfig(root),
});

await test("immutable candidate server bundles are generated but candidate source is still checked", async () => {
  assert.equal(await eslint.isPathIgnored("candidates/0.1.3/server.mjs"), true);
  assert.equal(await eslint.isPathIgnored("candidates/0.1.3/policy.mts"), false);
  assert.equal(await eslint.isPathIgnored("src/server.mjs"), false);
});

async function rules(code: string): Promise<readonly (string | null)[]> {
  const results = await eslint.lintText(code, { filePath });
  return results.flatMap((result) => result.messages.map((message) => message.ruleId));
}

await test("the shared config accepts readonly pure transitions", async () => {
  const code =
    "export const next = (state: Readonly<{ count: number }>): Readonly<{ count: number }> => ({ count: state.count + 1 });";
  assert.deepEqual(await rules(code), []);
});

await test("readonly mapped schema fields do not taint later readonly tuples", async () => {
  const code = `
    type Row = { name: string; score: number };
    interface Entry extends Readonly<Row> { readonly id: string }
    export function entries(value: Entry): readonly Entry[] { return [value]; }
    export function ids(value: readonly [string, string]): readonly [string, string] { return value; }
  `;
  assert.deepEqual(await rules(code), []);
});

await test("readonly generic caches cannot accept mutable elements", async () => {
  const code = `
    export function strings(value: readonly string[]): readonly string[] { return value; }
    export function unsafe(value: readonly { count: number }[]): number { return value.length; }
  `;
  assert.deepEqual(await rules(code), ["functional/prefer-immutable-types"]);
});

await test("mutable elements cannot taint unrelated readonly arrays", async () => {
  const code = `
    export function unsafe(value: readonly { count: number }[]): number { return value.length; }
    export function strings(value: readonly string[]): readonly string[] { return value; }
  `;
  assert.deepEqual(await rules(code), ["functional/prefer-immutable-types"]);
});

await test("recursive readonly trees pass while mutable descendants still fail", async () => {
  const code = `
    interface Tree { readonly value: number; readonly children: readonly Tree[] }
    interface MutableTree { readonly value: number; readonly children: MutableTree[] }
    export function tree(value: Tree): Tree { return value; }
    export function unsafe(value: MutableTree): number { return value.value; }
  `;
  assert.deepEqual(await rules(code), ["functional/prefer-immutable-types"]);
});

await test("explicit mutable overrides cannot inherit a readonly allowance", async () => {
  const code = `
    interface Base { count: number }
    interface Override extends Readonly<Base> { count: number }
    export function unsafe(value: Override): number { return value.count; }
  `;
  assert.deepEqual(await rules(code), ["functional/prefer-immutable-types"]);
});

await test("core mutation cannot be hidden by an inline disable", async () => {
  const code =
    "/* eslint-disable functional/immutable-data */\nexport const next = (state: { count: number }): number => ++state.count;";
  assert((await rules(code)).includes("functional/immutable-data"));
});

await test("core classes and ambient clocks fail the gate", async () => {
  const classRules = await rules("export class Clock { now(): number { return Date.now(); } }");
  assert(classRules.includes("functional/no-classes"));
  assert(classRules.includes("no-restricted-globals"));
});

await test("core cannot import I/O and unsafe any fails type-aware lint", async () => {
  const importRules = await rules(
    'import { readFile } from "node:fs/promises"; export const read = readFile;',
  );
  assert(importRules.includes("no-restricted-imports"));
  const typeRules = await rules("export const unsafe = (value: any): any => value;");
  assert(typeRules.includes("@typescript-eslint/no-explicit-any"));
});
