import { isJsonScalar, isUnknownArray, isUnknownRecord } from "./json-shape.js";

export function canonicalJson(value: unknown): string {
  if (isJsonScalar(value)) return canonicalScalar(value);
  if (isUnknownArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isUnknownRecord(value)) return canonicalRecord(value);
  throw new Error("unsupported_canonical_json_value");
}

function canonicalScalar(value: string | boolean | number | null): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("non_finite_canonical_json");
  }
  return JSON.stringify(value);
}

function canonicalRecord(value: Readonly<Record<string, unknown>>): string {
  const keys: readonly string[] = Object.keys(value).toSorted();
  const members: readonly string[] = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  );
  return `{${members.join(",")}}`;
}
