import type {
  LocalSaveGrant,
  LocalSaveOutcome,
  LocalSaveResponse,
  LocalSaveWireEntry,
} from "../local-save-types.js";
import { localSaveErrorCodes } from "../local-save-types.js";
import { choice, integer, matchingText, record, text, type UnknownRecord } from "./validation.js";
import { decodeSaveValue, localSaveLimits, saveFailure, saveRevision } from "./local-save-value.js";
const INVALID = "Invalid local save response";
function exactKeys(value: UnknownRecord, keys: readonly string[]): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(","))
    saveFailure("invalid_request");
}
export function parseLocalSaveGrant(value: unknown): LocalSaveGrant {
  const source = record(value, INVALID);
  exactKeys(source, ["protocolVersion", "maxValueBytes", "maxKeys", "maxTotalBytes"]);
  return {
    protocolVersion: choice(source.protocolVersion, [1], INVALID),
    maxValueBytes: integer(source.maxValueBytes, [1, localSaveLimits.maxValueBytes], INVALID),
    maxKeys: integer(source.maxKeys, [1, localSaveLimits.maxKeys], INVALID),
    maxTotalBytes: integer(source.maxTotalBytes, [1, localSaveLimits.maxTotalBytes], INVALID),
  };
}
function entry(value: unknown): LocalSaveWireEntry | null {
  if (value === null) return null;
  const source = record(value, INVALID);
  exactKeys(source, ["revision", "valueJson"]);
  const valueJson = text(source.valueJson, INVALID);
  decodeSaveValue(valueJson);
  return { revision: saveRevision(source.revision), valueJson };
}
function outcome(value: unknown): LocalSaveOutcome {
  const source = record(value, INVALID);
  switch (source.operation) {
    case "read":
      exactKeys(source, ["operation", "entry"]);
      return { operation: "read", entry: entry(source.entry) };
    case "write":
      exactKeys(source, ["operation", "revision"]);
      return { operation: "write", revision: saveRevision(source.revision) };
    case "remove":
      exactKeys(source, ["operation"]);
      return { operation: "remove" };
    default:
      return saveFailure("invalid_request");
  }
}
export function parseLocalSaveResponse(value: unknown): LocalSaveResponse {
  const source = record(value, INVALID);
  const protocolVersion = choice(source.protocolVersion, [1], INVALID);
  const requestId = matchingText(source.requestId, /^[a-zA-Z0-9_-]{1,128}$/, INVALID);
  const common = { kind: "local-save-result" as const, protocolVersion, requestId } as const;
  if (source.kind !== common.kind) saveFailure("invalid_request");
  return responseStatus(source, common);
}
function responseStatus(
  source: UnknownRecord,
  common: Pick<LocalSaveResponse, "kind" | "protocolVersion" | "requestId">,
): LocalSaveResponse {
  if (source.status === "error") {
    exactKeys(source, ["kind", "protocolVersion", "requestId", "status", "error"]);
    return {
      ...common,
      status: "error",
      error: choice(source.error, localSaveErrorCodes, INVALID),
    };
  }
  exactKeys(source, ["kind", "protocolVersion", "requestId", "status", "result"]);
  if (source.status !== "ok") saveFailure("invalid_request");
  return { ...common, status: "ok", result: outcome(source.result) };
}
