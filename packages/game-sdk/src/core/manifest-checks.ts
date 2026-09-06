import { inRange, isArray, type UnknownRecord } from "./validation.js";

export function check(valid: boolean, message: string): readonly string[] {
  return valid ? [] : [message];
}

export function integerInRange(value: unknown, range: readonly [number, number]): value is number {
  return typeof value === "number" && Number.isInteger(value) && inRange(value, range);
}

export function integerIssues(
  value: unknown,
  path: string,
  range: readonly [number, number],
): readonly string[] {
  return check(
    integerInRange(value, range),
    path + " must be an integer from " + String(range[0]) + " through " + String(range[1]),
  );
}

export function matches(value: unknown, pattern: Readonly<RegExp>): value is string {
  return typeof value === "string" && pattern.test(value);
}

export function validPackagePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/") || value.includes("\\") || /[\0-\x1f]/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function pathIssues(value: unknown, path: string): readonly string[] {
  return check(
    validPackagePath(value),
    path + " must be a relative package path without '..' or backslashes",
  );
}

export function duplicates(values: readonly unknown[], message: string): readonly string[] {
  return check(new Set(values).size === values.length, message);
}

export function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

export function arrayValue(value: unknown): readonly unknown[] {
  return isArray(value) ? value : [];
}

export function booleanIssues(value: unknown, path: string): readonly string[] {
  return check(typeof value === "boolean", path + " must be boolean");
}

export function exceeds(first: unknown, second: unknown): boolean {
  return typeof first === "number" && typeof second === "number" && first > second;
}

export function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
