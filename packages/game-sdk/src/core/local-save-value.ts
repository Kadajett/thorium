import type { JsonValue } from "../types.js";
import type { LocalSaveGrant } from "../local-save-types.js";
import { isArray, isRecord } from "./validation.js";
export const localSaveLimits: LocalSaveGrant = {
  protocolVersion: 1,
  maxValueBytes: 131072,
  maxKeys: 16,
  maxTotalBytes: 524288,
};
export const maxSaveEnvelopeBytes = localSaveLimits.maxValueBytes * 6 + 1024;
export function saveFailure(code: string): never {
  throw new Error(code, { cause: "local-save" });
}
export function saveBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
function validValue(value: unknown, ancestors: readonly object[]): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return validCollection(value, ancestors);
}
function validCollection(value: unknown, ancestors: readonly object[]): value is JsonValue {
  if (!isArray(value) && !isRecord(value)) return false;
  if (!safeCollection(value, ancestors)) return false;
  return saveProperties(value).every((key) => validProperty(value, key, [...ancestors, value]));
}
function safeCollection(value: object, ancestors: readonly object[]): boolean {
  return ancestors.length < 32 && !ancestors.includes(value) && plainCollection(value);
}
function plainCollection(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!isArray(value)) return plainPrototype(prototype);
  return prototype === Array.prototype && saveProperties(value).length === value.length;
}
function plainPrototype(value: unknown): boolean {
  return value === Object.prototype || value === null;
}
function saveProperties(value: object): readonly PropertyKey[] {
  const keys: readonly PropertyKey[] = Reflect.ownKeys(value);
  return isArray(value) ? keys.filter((key) => key !== "length") : keys;
}
function validProperty(value: object, key: PropertyKey, ancestors: readonly object[]): boolean {
  if (!validPropertyKey(value, key)) return false;
  const property: Readonly<PropertyDescriptor> | undefined = Object.getOwnPropertyDescriptor(
    value,
    key,
  );
  if (property?.enumerable !== true || !("value" in property)) return false;
  const child: unknown = property.value;
  return validValue(child, ancestors);
}
function validPropertyKey(value: object, key: PropertyKey): boolean {
  if (typeof key !== "string") return false;
  if (!isArray(value)) return true;
  return /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length;
}
export function encodeSaveValue(value: unknown, maximum = localSaveLimits.maxValueBytes): string {
  if (!validValue(value, [])) saveFailure("invalid_request");
  const encoded = JSON.stringify(value);
  if (saveBytes(encoded) > maximum) saveFailure("quota_exceeded");
  return encoded;
}
export function decodeSaveValue(
  valueJson: string,
  maximum = localSaveLimits.maxValueBytes,
): JsonValue {
  if (saveBytes(valueJson) > maximum) saveFailure("quota_exceeded");
  const value: unknown = JSON.parse(valueJson);
  if (!validValue(value, [])) saveFailure("invalid_request");
  return value;
}
export function saveKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]{0,63}$/.test(value))
    saveFailure("invalid_request");
  return value;
}
export function saveRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    saveFailure("invalid_request");
  return value;
}
