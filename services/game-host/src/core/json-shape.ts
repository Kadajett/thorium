export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !isUnknownArray(value);
}

export function isJsonScalar(value: unknown): value is string | boolean | number | null {
  return value === null || ["string", "boolean", "number"].includes(typeof value);
}
