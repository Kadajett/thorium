import type {
  CatalogPage,
  CatalogQuery,
  GameRelease,
} from "../domain/game-package.js";

export interface GameCatalogRepository {
  list(query: CatalogQuery): Promise<CatalogPage>;
  findById(packageId: string, version?: string): Promise<GameRelease | undefined>;
}
