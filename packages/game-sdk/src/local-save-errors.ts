import type { LocalSaveErrorCode } from "./local-save-types.js";
import { localSaveErrorCodes } from "./local-save-types.js";
export class LocalSaveError extends Error {
  constructor(readonly code: LocalSaveErrorCode) {
    super(`Local save: ${code}`);
    this.name = "LocalSaveError";
  }
}
export function localSaveError(error: unknown): LocalSaveError {
  if (error instanceof LocalSaveError) return error;
  const code =
    error instanceof Error ? localSaveErrorCodes.find((item) => item === error.message) : undefined;
  return new LocalSaveError(code ?? "invalid_request");
}
