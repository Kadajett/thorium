import { inRange, isArray, isRecord, type UnknownRecord } from "./validation.js";
import {
  arrayValue,
  booleanIssues,
  check,
  duplicates,
  exceeds,
  integerIssues,
  matches,
  pathIssues,
  validPackagePath,
} from "./manifest-checks.js";

const PURPOSES = { main: "primary-gameplay", companion: "companion-controls" } as const;

export function runtimeFiles(runtime: unknown): readonly string[] {
  return isRecord(runtime) ? arrayValue(runtime.files).filter(validPackagePath) : [];
}

function fileIssues(value: unknown): readonly string[] {
  if (!isArray(value) || value.length === 0)
    return ["runtime.files must contain every file required by the web game"];
  const files: readonly string[] = value.filter(validPackagePath);
  return [
    ...value.flatMap((file) => pathIssues(file, "runtime.files[]")),
    ...duplicates(files, "runtime.files must not contain duplicates"),
    ...check(
      !files.includes("thorium.json"),
      "runtime.files must not include reserved thorium.json",
    ),
  ];
}

function entrypointIssues(
  value: unknown,
  role: "main" | "companion",
  files: readonly string[],
): readonly string[] {
  const path = "runtime.entrypoints." + role;
  if (!isRecord(value)) return [path + " must be an object"];
  const purpose = PURPOSES[role];
  return [
    ...entrypointFileIssues(value, role, files),
    ...check(value.purpose === purpose, path + ".purpose must be " + purpose),
  ];
}

function entrypointFileIssues(
  value: UnknownRecord,
  role: string,
  files: readonly string[],
): readonly string[] {
  const declared = !validPackagePath(value.path) || files.includes(value.path);
  return [
    ...pathIssues(value.path, "runtime.entrypoints." + role + ".path"),
    ...check(declared, "runtime.files must include the " + role + " entrypoint"),
  ];
}

function entrypointsIssues(value: unknown, files: readonly string[]): readonly string[] {
  if (!isRecord(value)) return ["runtime.entrypoints must be an object"];
  return [
    ...entrypointIssues(value.main, "main", files),
    ...entrypointIssues(value.companion, "companion", files),
  ];
}

export function runtimeIssues(value: unknown): readonly string[] {
  if (!isRecord(value) || value.kind !== "web-v1") return ["runtime.kind must be web-v1"];
  return [
    ...check(
      matches(value.sdkCompatibility, /^\^?\d+\.\d+\.\d+$/),
      "runtime.sdkCompatibility must be a version such as ^0.1.0",
    ),
    ...fileIssues(value.files),
    ...entrypointsIssues(value.entrypoints, runtimeFiles(value)),
  ];
}

function screenIssues(value: unknown, path: string): readonly string[] {
  if (!isRecord(value)) return [path + " must be an object"];
  const ratio = value.maximumDevicePixelRatio;
  const validRatio = typeof ratio === "number" && inRange(ratio, [1, 3]);
  return [
    ...integerIssues(value.logicalWidth, path + ".logicalWidth", [160, 4096]),
    ...integerIssues(value.logicalHeight, path + ".logicalHeight", [160, 4096]),
    ...check(validRatio, path + ".maximumDevicePixelRatio must be from 1 through 3"),
  ];
}

function requiredSurfacesIssues(value: unknown): readonly string[] {
  if (
    !isArray(value) ||
    value.length === 0 ||
    !value.every((role) => role === "main" || role === "companion")
  ) {
    return ["displays.requiredSurfaces must contain main and/or companion"];
  }
  return duplicates(value, "displays.requiredSurfaces must not contain duplicates");
}

export function displaysIssues(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["displays must be an object"];
  return [
    ...screenIssues(value.main, "displays.main"),
    ...screenIssues(value.companion, "displays.companion"),
    ...requiredSurfacesIssues(value.requiredSurfaces),
    ...booleanIssues(value.supportsSingleSurfaceFallback, "displays.supportsSingleSurfaceFallback"),
  ];
}

function fileCountIssues(budgets: UnknownRecord, files: readonly string[]): readonly string[] {
  return check(
    !exceeds(files.length, budgets.maxFileCount),
    "runtime.files exceeds budgets.maxFileCount",
  );
}

export function budgetIssues(value: unknown, files: readonly string[]): readonly string[] {
  if (!isRecord(value)) return ["budgets must be an object"];
  return [
    ...integerIssues(value.maxPackageBytes, "budgets.maxPackageBytes", [1, 134_217_728]),
    ...integerIssues(value.maxFileCount, "budgets.maxFileCount", [1, 2048]),
    ...integerIssues(
      value.maxLocalPeerMessageBytes,
      "budgets.maxLocalPeerMessageBytes",
      [1, 262_144],
    ),
    ...fileCountIssues(value, files),
  ];
}
