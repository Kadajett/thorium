import type { GameRelease } from "../domain/game-package.js";

export type GameReleasePublicationRepositoryResult =
  | {
      readonly status: "published" | "already-published";
      readonly release: GameRelease;
    }
  | { readonly status: "conflict" };

/** Durable metadata seam for an immutable Game Release. */
export interface GameReleasePublicationRepository {
  publish(release: GameRelease): Promise<GameReleasePublicationRepositoryResult>;
}
