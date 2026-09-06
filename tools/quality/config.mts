import type { Linter } from "eslint";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";
import functional from "eslint-plugin-functional";
import { halsteadRule } from "./halstead.mts";

const typedFiles = ["**/*.{ts,mts,cts,tsx}"];
const sourceFiles = ["**/*.{ts,mts,cts,tsx,js,mjs,cjs}"];
const testFiles = ["**/*.test.{ts,mts,mjs}", "**/test/**", "**/tests/**"];
const ignoredFiles = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/target/**",
  "**/coverage/**",
  "**/artifacts/**",
  "**/candidates/*/server.mjs",
  "**/vendor/**",
  "**/test-output/**",
  "**/test-results/**",
  "**/playwright-report/**",
  "**/.dev-state/**",
];

const structuralRules: Linter.RulesRecord = {
  complexity: ["error", 10],
  "sonarjs/cognitive-complexity": ["error", 10],
  "thorium/halstead": "error",
  "max-depth": ["error", 3],
  "max-lines": ["error", { max: 400, skipBlankLines: true }],
  "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
  "max-nested-callbacks": ["error", 3],
  "max-params": ["error", 4],
  "max-statements": ["error", 20],
  "no-eval": "error",
  "no-param-reassign": "error",
  "no-else-return": ["error", { allowElseIf: false }],
  "prefer-const": "error",
};

const typedRules: Linter.RulesRecord = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/consistent-type-imports": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/strict-boolean-expressions": [
    "error",
    { allowNullableBoolean: false, allowNullableObject: false },
  ],
};

const coreRules: Linter.RulesRecord = {
  "functional/immutable-data": "error",
  "functional/no-let": "error",
  "functional/no-classes": "error",
  "functional/no-this-expressions": "error",
  "functional/prefer-immutable-types": [
    "error",
    {
      parameters: { enforcement: "ReadonlyDeep" },
      returnTypes: { enforcement: "ReadonlyDeep" },
      variables: { enforcement: "ReadonlyDeep" },
    },
  ],
  "no-restricted-imports": ["error", { patterns: ["node:*", "**/adapters/**"] }],
  "no-restricted-globals": [
    "error",
    "window",
    "document",
    "fetch",
    "localStorage",
    "setTimeout",
    "setInterval",
    "Date",
    "performance",
    "crypto",
    "WebSocket",
  ],
  "no-restricted-properties": [
    "error",
    { object: "Math", property: "random" },
    { object: "Date", property: "now" },
  ],
};

const structuralConfig: Linter.Config = {
  files: sourceFiles,
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
  plugins: { sonarjs, thorium: { rules: { halstead: halsteadRule } } },
  rules: structuralRules,
};

const coreConfig: Linter.Config = {
  files: [
    "**/core/**/*.{ts,mts,cts,tsx}",
    "**/domain/**/*.{ts,mts,cts,tsx}",
    "**/simulation.{ts,mts,cts,tsx}",
    "**/rules.{ts,mts,cts,tsx}",
  ],
  ignores: testFiles,
  rules: coreRules,
};

export function qualityConfig(root: string): Linter.Config[] {
  return [
    { ignores: ignoredFiles },
    structuralConfig,
    ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: typedFiles })),
    {
      files: typedFiles,
      languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } },
      plugins: { functional },
      rules: typedRules,
    },
    {
      files: ["**/*.{js,mjs,cjs}"],
      rules: { ...eslint.configs.recommended.rules, "no-undef": "off" },
    },
    {
      files: testFiles,
      rules: {
        "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
        "max-statements": ["error", 30],
      },
    },
    coreConfig,
  ];
}
