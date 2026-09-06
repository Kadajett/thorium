import type { GameRelease } from "../../domain/game-package.js";
import { parseStoredGameRelease } from "../../publication/verify-game-release.js";

export interface ReleaseRow {
  readonly release_json: unknown;
}

export function releaseFromRow(row: ReleaseRow): GameRelease {
  const value: unknown =
    typeof row.release_json === "string" ? JSON.parse(row.release_json) : row.release_json;
  return parseStoredGameRelease(value);
}
