import type { CatalogPage, CatalogQuery, GameRelease } from "../domain/game-package.js";
import type { GameCatalogRepository } from "../ports/game-catalog-repository.js";
import {
  currentGameReleases,
  matchesCatalogQuery,
  matchesReleaseIdentity,
  type PublishedCatalogEntry,
} from "../core/current-game-release.js";
import { decodeCatalogCursor, encodeCatalogCursor } from "./catalog-cursor.js";

function copy(record: GameRelease): GameRelease {
  return structuredClone(record);
}

function publicationEntry(release: GameRelease): PublishedCatalogEntry {
  const publishedAtEpochMs = Date.parse(release.publishedAt);
  if (!Number.isFinite(publishedAtEpochMs)) throw new Error("invalid_catalog_publication_time");
  return { release, publishedAtEpochMs };
}

function page(matches: readonly GameRelease[], limit: number): CatalogPage {
  const items = matches.slice(0, limit).map(copy);
  const last = items.at(-1);
  return {
    items,
    ...(matches.length > items.length && last !== undefined
      ? { nextCursor: encodeCatalogCursor(last.packageId) }
      : {}),
  };
}

function list(records: readonly GameRelease[], query: CatalogQuery): CatalogPage {
  const after = query.cursor === undefined ? "" : decodeCatalogCursor(query.cursor);
  const matches = records.filter(
    (release) => release.packageId > after && matchesCatalogQuery(release, query.query ?? ""),
  );
  return page(matches, query.limit);
}

function find(
  records: readonly GameRelease[],
  packageId: string,
  version?: string,
): GameRelease | undefined {
  const release = records.find((candidate) =>
    matchesReleaseIdentity(candidate, packageId, version),
  );
  return release === undefined ? undefined : copy(release);
}

export function createInMemoryGameCatalogRepository(
  input: readonly GameRelease[],
): GameCatalogRepository {
  const releases = input.map(copy);
  const current = currentGameReleases(releases.map(publicationEntry));
  return {
    list: (query) => Promise.resolve().then(() => list(current, query)),
    findById: (packageId, version) =>
      Promise.resolve(find(version === undefined ? current : releases, packageId, version)),
  };
}

/** Constructor compatibility; factories own adapters and core functions own policy. */
export class InMemoryGameCatalogRepository implements GameCatalogRepository {
  readonly list: GameCatalogRepository["list"];
  readonly findById: GameCatalogRepository["findById"];

  constructor(records: readonly GameRelease[]) {
    const catalog = createInMemoryGameCatalogRepository(records);
    this.list = (query) => catalog.list(query);
    this.findById = (packageId, version) => catalog.findById(packageId, version);
  }
}
