import type {
  LocalSaveCommand,
  LocalSaveGrant,
  LocalSaveOutcome,
  LocalSaveWireEntry,
} from "../local-save-types.js";
import {
  decodeSaveValue,
  localSaveLimits,
  saveBytes,
  saveFailure,
  saveKey,
  saveRevision,
} from "./local-save-value.js";
export interface LocalSaveState {
  readonly revision: number;
  readonly entries: Readonly<Record<string, LocalSaveWireEntry>>;
}
export interface SaveTransition {
  readonly state: LocalSaveState;
  readonly result: LocalSaveOutcome;
}
export function initialSaveState(): LocalSaveState {
  return { revision: 0, entries: {} };
}
function expected(
  command: Exclude<LocalSaveCommand, { operation: "read" }>,
  current: LocalSaveWireEntry | undefined,
): void {
  if (command.expectedRevision !== null) saveRevision(command.expectedRevision);
  if ((current?.revision ?? null) !== command.expectedRevision) saveFailure("conflict");
}
function write(
  state: LocalSaveState,
  command: Extract<LocalSaveCommand, { operation: "write" }>,
  limits: LocalSaveGrant,
): SaveTransition {
  decodeSaveValue(command.valueJson, limits.maxValueBytes);
  const revision = saveRevision(state.revision + 1);
  const entries: LocalSaveState["entries"] = {
    ...state.entries,
    [command.key]: { revision, valueJson: command.valueJson },
  };
  checkQuota(entries, limits);
  return { state: { revision, entries }, result: { operation: "write", revision } };
}
function checkQuota(entries: LocalSaveState["entries"], limits: LocalSaveGrant): void {
  const values: readonly LocalSaveWireEntry[] = Object.values(entries);
  if (values.length > limits.maxKeys) saveFailure("quota_exceeded");
  const bytes = values.reduce((total, entry) => total + saveBytes(entry.valueJson), 0);
  if (bytes > limits.maxTotalBytes) saveFailure("quota_exceeded");
}
function remove(state: LocalSaveState, key: string): SaveTransition {
  const revision = saveRevision(state.revision + 1);
  const entries: LocalSaveState["entries"] = Object.fromEntries(
    Object.entries(state.entries).filter(
      ([candidate]: readonly [string, LocalSaveWireEntry]) => candidate !== key,
    ),
  );
  return { state: { revision, entries }, result: { operation: "remove" } };
}
export function transitionSave(
  state: LocalSaveState,
  command: LocalSaveCommand,
  limits: LocalSaveGrant = localSaveLimits,
): SaveTransition {
  const key = saveKey(command.key),
    current = Object.hasOwn(state.entries, key) ? state.entries[key] : undefined;
  if (command.operation === "read")
    return { state, result: { operation: "read", entry: current ?? null } };
  expected(command, current);
  return command.operation === "write" ? write(state, command, limits) : remove(state, key);
}
