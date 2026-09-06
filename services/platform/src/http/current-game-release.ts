import type { GameCatalogRepository } from "../ports/game-catalog-repository.js";
import type { GameRelease } from "../domain/game-package.js";
import type { ExactGameRelease } from "../session-registry/game-session-registry.js";
import { exactGameRelease, gameUpdateRequired } from "../core/current-game-release.js";
import { HttpError } from "./http-error.js";

function found(game: GameRelease | undefined): GameRelease {
  if (game === undefined)
    throw new HttpError(404, "game_not_found", "The requested game package was not found.");
  return game;
}

export async function requireCurrentGameRelease(
  catalog: GameCatalogRepository,
  requested: ExactGameRelease,
): Promise<GameRelease> {
  const game = found(await catalog.findById(requested.packageId, requested.version));
  if (game.contentDigest !== requested.contentDigest) {
    throw new HttpError(
      409,
      "game_release_mismatch",
      "The requested content digest does not match the catalog Game Release.",
    );
  }
  const current = found(await catalog.findById(requested.packageId));
  if (gameUpdateRequired(requested, current)) {
    throw new HttpError(
      409,
      "game_update_required",
      "Update this game before starting a new Game Session.",
      { currentRelease: exactGameRelease(current) },
    );
  }
  return game;
}
