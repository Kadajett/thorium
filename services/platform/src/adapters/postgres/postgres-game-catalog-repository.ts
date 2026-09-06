import type { Pool } from "pg";
import type { CatalogPage, CatalogQuery, GameRelease } from "../../domain/game-package.js";
import type { GameCatalogRepository } from "../../ports/game-catalog-repository.js";
import type { GameReleasePublicationRepository } from "../../ports/game-release-publication-repository.js";
import { decodeCatalogCursor, encodeCatalogCursor } from "../catalog-cursor.js";
import { releaseFromRow, type ReleaseRow } from "./catalog-release-row.js";
import { publishCatalogRelease } from "./catalog-publication.js";

type PostgresCatalog = GameCatalogRepository & GameReleasePublicationRepository;

async function findById(
  pool: Pool,
  packageId: string,
  version?: string,
): Promise<GameRelease | undefined> {
  const result =
    version === undefined
      ? await pool.query<ReleaseRow>(
          `SELECT release_json FROM thorium_game_releases WHERE package_id = $1
       ORDER BY published_at DESC, package_version COLLATE "C" DESC LIMIT 1`,
          [packageId],
        )
      : await pool.query<ReleaseRow>(
          `SELECT release_json FROM thorium_game_releases
       WHERE package_id = $1 AND package_version = $2`,
          [packageId, version],
        );
  const row = result.rows[0];
  return row === undefined ? undefined : releaseFromRow(row);
}

function queryValues(query: CatalogQuery): (string | number)[] {
  const after = query.cursor === undefined ? "" : decodeCatalogCursor(query.cursor);
  return [after, query.query?.trim().toLowerCase() ?? "", query.limit + 1];
}

async function listRows(pool: Pool, query: CatalogQuery): Promise<readonly ReleaseRow[]> {
  const result = await pool.query<ReleaseRow>(
    `SELECT release_json FROM (
       SELECT DISTINCT ON (package_id COLLATE "C")
              package_id, package_version, published_at, release_json
         FROM thorium_game_releases WHERE package_id COLLATE "C" > $1
        ORDER BY package_id COLLATE "C", published_at DESC, package_version COLLATE "C" DESC
     ) latest
     WHERE strpos(lower(concat_ws(chr(10), package_id,
       release_json ->> 'displayName', release_json ->> 'summary',
       coalesce((SELECT string_agg(tag, chr(10))
         FROM jsonb_array_elements_text(release_json -> 'tags') tag), ''))), $2) > 0
     ORDER BY package_id COLLATE "C" LIMIT $3`,
    queryValues(query),
  );
  return result.rows;
}

async function list(pool: Pool, query: CatalogQuery): Promise<CatalogPage> {
  const rows = await listRows(pool, query);
  const items = rows.slice(0, query.limit).map(releaseFromRow);
  const last = items.at(-1);
  return {
    items,
    ...(rows.length > items.length && last !== undefined
      ? { nextCursor: encodeCatalogCursor(last.packageId) }
      : {}),
  };
}

export function createPostgresGameCatalogRepository(pool: Pool): PostgresCatalog {
  return {
    publish: (release) => publishCatalogRelease(pool, release),
    findById: (packageId, version) => findById(pool, packageId, version),
    list: (query) => list(pool, query),
  };
}

/** Constructor compatibility; the factory owns effects and shares the catalog policy. */
export class PostgresGameCatalogRepository implements PostgresCatalog {
  readonly publish: PostgresCatalog["publish"];
  readonly findById: PostgresCatalog["findById"];
  readonly list: PostgresCatalog["list"];

  constructor(pool: Pool) {
    const catalog = createPostgresGameCatalogRepository(pool);
    this.publish = (release) => catalog.publish(release);
    this.findById = (packageId, version) => catalog.findById(packageId, version);
    this.list = (query) => catalog.list(query);
  }
}
