import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { halsteadRule } from "./halstead.mts";

function inspect(code: string): readonly Linter.LintMessage[] {
  return new Linter().verify(
    code,
    [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tseslint.parser },
        plugins: { thorium: { rules: { halstead: halsteadRule } } },
        rules: { "thorium/halstead": "error" },
      },
    ],
    "fixture.ts",
  );
}

await test("accepts a small typed pure function and an empty adapter", () => {
  assert.deepEqual(inspect("function add(a: number, b: number): number { return a + b; }"), []);
  assert.deepEqual(inspect("function noop(): void {}"), []);
});

await test("rejects high volume even if the function is compressed onto one line", () => {
  const expressions = Array.from({ length: 180 }, (_, index) => `value + ${String(index)}`).join(
    " + ",
  );
  const messages = inspect(`const calculate = (value: number) => ${expressions};`);
  assert(messages.some((message) => message.messageId === "volume"));
});

await test("rejects high difficulty independently from line length", () => {
  const expression =
    "a += b; a -= b; a *= b; a /= b; a %= b; a &= b; a |= b; a ^= b; a <<= b; a >>= b; a >>>= b;";
  const messages = inspect(
    `function difficult(a: number, b: number) { ${expression.repeat(4)} return a; }`,
  );
  assert(messages.some((message) => message.messageId === "difficulty"));
});

await test("measures nested callbacks and methods, not only top-level declarations", () => {
  const expression = Array.from({ length: 180 }, (_, index) => `value + ${String(index)}`).join(
    " + ",
  );
  const messages = inspect(
    `const adapter = { run(value: number) { return [value].map(value => ${expression}); } };`,
  );
  assert(messages.filter((message) => message.messageId === "volume").length >= 2);
});

await test("type syntax, comments and formatting do not prevent analysis", () => {
  const expression = Array.from({ length: 180 }, (_, index) => `value + ${String(index)}`).join(
    " + ",
  );
  const compact = inspect(`function f<T extends number>(value: T) { return ${expression}; }`);
  const spaced = inspect(
    `function f<T extends number>(value: T) {\n/* comment */\nreturn ${expression};\n}`,
  );
  assert.deepEqual(
    compact.map(({ message }) => message),
    spaced.map(({ message }) => message),
  );
  assert(compact.some((message) => message.messageId === "volume"));
});
