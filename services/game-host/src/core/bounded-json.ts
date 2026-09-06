import type { JsonObject, JsonValue } from "@thorium/game-host-api";
import { canonicalJson } from "./canonical-json.js";
import { isJsonScalar, isUnknownArray, isUnknownRecord } from "./json-shape.js";

interface Traversal {
  readonly depth: number;
  readonly members: number;
  readonly label: string;
}

interface Validated<T extends JsonValue = JsonValue> {
  readonly value: T;
  readonly members: number;
}

export function boundedJsonObject(value: unknown, label: string): JsonObject {
  if (!isUnknownRecord(value)) throw new Error(`${label}_must_be_an_object`);
  const result = validateRecord(value, { depth: 0, members: 0, label });
  if (new TextEncoder().encode(canonicalJson(result.value)).byteLength > 4_096) {
    throw new Error(`${label}_too_large`);
  }
  return canonicalObject(result.value);
}

function validateValue(value: unknown, traversal: Traversal): Validated {
  if (traversal.depth > 8) throw new Error(`${traversal.label}_too_deep`);
  if (isJsonScalar(value)) return validateScalar(value, traversal);
  if (isUnknownArray(value)) return validateArray(value, traversal);
  if (isUnknownRecord(value)) return validateRecord(value, traversal);
  throw new Error(`${traversal.label}_invalid_value`);
}

function validateScalar(value: string | boolean | number | null, traversal: Traversal): Validated {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`${traversal.label}_invalid_number`);
  }
  return { value: value === 0 ? 0 : value, members: traversal.members };
}

function containerMembers(traversal: Traversal, count: number): number {
  const members = traversal.members + count;
  if (members > 256) throw new Error(`${traversal.label}_too_many_members`);
  return members;
}

function validateArray(
  value: readonly unknown[],
  traversal: Traversal,
): Validated<readonly JsonValue[]> {
  const initial: Validated<readonly JsonValue[]> = {
    value: [],
    members: containerMembers(traversal, value.length),
  };
  return [...value].reduce<Validated<readonly JsonValue[]>>(
    (state, member): Validated<readonly JsonValue[]> => appendArrayValue(state, member, traversal),
    initial,
  );
}

function childTraversal(traversal: Traversal, members: number): Traversal {
  return { ...traversal, depth: traversal.depth + 1, members };
}

function appendArrayValue(
  state: Validated<readonly JsonValue[]>,
  member: unknown,
  traversal: Traversal,
): Validated<readonly JsonValue[]> {
  const child = validateValue(member, childTraversal(traversal, state.members));
  return { value: [...state.value, child.value], members: child.members };
}

function validateRecord(
  value: Readonly<Record<string, unknown>>,
  traversal: Traversal,
): Validated<JsonObject> {
  const keys: readonly string[] = Object.keys(value);
  const initial: Validated<JsonObject> = {
    value: {},
    members: containerMembers(traversal, keys.length),
  };
  return keys.reduce<Validated<JsonObject>>(
    (state, key): Validated<JsonObject> =>
      appendRecordValue(state, { key, value: value[key] }, traversal),
    initial,
  );
}

interface RecordMember {
  readonly key: string;
  readonly value: unknown;
}

function appendRecordValue(
  state: Validated<JsonObject>,
  member: RecordMember,
  traversal: Traversal,
): Validated<JsonObject> {
  if (["__proto__", "constructor", "prototype"].includes(member.key)) {
    throw new Error(`${traversal.label}_unsafe_key`);
  }
  const child = validateValue(member.value, childTraversal(traversal, state.members));
  return { value: { ...state.value, [member.key]: child.value }, members: child.members };
}

function canonicalObject(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.keys(value)
      .toSorted()
      .map((key): readonly [string, JsonValue] => [key, canonicalValue(value[key] ?? null)]),
  );
}

function canonicalValue(value: JsonValue): JsonValue {
  if (isUnknownArray(value)) return value.map(canonicalValue);
  if (typeof value === "object" && value !== null) return canonicalObject(value);
  return value;
}
