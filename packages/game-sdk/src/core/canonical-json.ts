import type { JsonValue } from "../types.js";
import { isArray, isRecord, type UnknownRecord } from "./validation.js";
function normalizedEntries(value: UnknownRecord): readonly (readonly [string, JsonValue])[] {
  return Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, normalize(value[key])] as const);
}
function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return value;
  }
  if (isArray(value)) return value.map(normalize);
  if (isRecord(value)) return Object.fromEntries(normalizedEntries(value));
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
}
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}
