import type { JsonValue } from "./types.js";
import type {
  LocalSaveCommand,
  LocalSaveEntry,
  LocalSaveOutcome,
  LocalSavePort,
} from "./local-save-types.js";
import {
  decodeSaveValue,
  encodeSaveValue,
  saveKey,
  saveRevision,
} from "./core/local-save-value.js";
import { LocalSaveError, localSaveError } from "./local-save-errors.js";
export type SaveExecutor = (command: LocalSaveCommand) => Promise<LocalSaveOutcome>;
async function execute(
  port: SaveExecutor,
  create: () => LocalSaveCommand,
): Promise<LocalSaveOutcome> {
  try {
    return await port(create());
  } catch (error) {
    throw localSaveError(error);
  }
}
function readResult(result: LocalSaveOutcome): LocalSaveEntry | null {
  if (result.operation !== "read") throw new LocalSaveError("invalid_request");
  const entry = result.entry;
  return entry === null
    ? null
    : { revision: entry.revision, value: decodeSaveValue(entry.valueJson) };
}
async function read(port: SaveExecutor, key: string): Promise<LocalSaveEntry | null> {
  return readResult(await execute(port, () => ({ operation: "read", key: saveKey(key) })));
}
async function write(
  port: SaveExecutor,
  key: string,
  value: JsonValue,
  expectedRevision: number | null,
): Promise<number> {
  const result = await execute(port, () => ({
    operation: "write",
    key: saveKey(key),
    valueJson: encodeSaveValue(value),
    expectedRevision: expected(expectedRevision),
  }));
  if (result.operation !== "write") throw new LocalSaveError("invalid_request");
  return result.revision;
}
function expected(value: number | null): number | null {
  return value === null ? null : saveRevision(value);
}
async function remove(port: SaveExecutor, key: string, expectedRevision: number): Promise<void> {
  const result = await execute(port, () => ({
    operation: "remove",
    key: saveKey(key),
    expectedRevision: saveRevision(expectedRevision),
  }));
  if (result.operation !== "remove") throw new LocalSaveError("invalid_request");
}
export function createSavePort(port: SaveExecutor): LocalSavePort {
  return {
    read: (key) => read(port, key),
    write: (key, value, revision) => write(port, key, value, revision),
    remove: (key, revision) => remove(port, key, revision),
  };
}
