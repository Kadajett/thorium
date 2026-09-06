import { globSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const required = [
  "strict",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "noImplicitReturns",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
] as const;

const strictOptions = [
  "noImplicitAny",
  "noImplicitThis",
  "strictNullChecks",
  "strictFunctionTypes",
  "strictBindCallApply",
  "strictPropertyInitialization",
  "strictBuiltinIteratorReturn",
  "alwaysStrict",
  "useUnknownInCatchVariables",
] as const;

export function missingStrictFlags(options: ts.CompilerOptions): readonly string[] {
  return [
    ...required.filter((name) => options[name] !== true),
    ...strictOptions.filter((name) => options[name] === false),
  ];
}

export function checkStrictProjects(root: string): readonly string[] {
  const paths = globSync("**/tsconfig*.json", {
    cwd: root,
    exclude: [
      "**/node_modules/**",
      "**/artifacts/**",
      "**/vendor/**",
      "**/dist/**",
      "**/build/**",
      "**/target/**",
    ],
  });
  if (paths.length === 0) return ["No tsconfig.json found; strict TypeScript coverage is missing."];
  return paths.flatMap((path) => checkProject(resolve(root, path)));
}

function checkProject(path: string): readonly string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  if (parsed === undefined) return [`${path}: configuration could not be parsed`];
  const diagnostics = parsed.errors.map((error) =>
    ts.flattenDiagnosticMessageText(error.messageText, "\n"),
  );
  return [
    ...diagnostics,
    ...missingStrictFlags(parsed.options).map((name) => `${path}: ${name} must be true`),
  ];
}
