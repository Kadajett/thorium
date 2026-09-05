import type { Pool } from "pg";
import type { GameRelease } from "../../domain/game-package.js";
import type { GameCatalogRepository } from "../../ports/game-catalog-repository.js";
import type {
  GameReleasePublicationRepository,
  GameReleasePublicationRepositoryResult,
} from "../../ports/game-release-publication-repository.js";
import { parseStoredGameRelease } from "../../publication/verify-game-release.js";

interface ReleaseRow {
  readonly release_json: unknown;
}

function encodeCursor(packageId: string): string {
  return Buffer.from(packageId, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (decoded.length === 0 || encodeCursor(decoded) !== cursor) {
    throw new Error("invalid_catalog_cursor");
  }
  return decoded;
}

function releaseFromRow(row: ReleaseRow): GameRelease {
  const value = typeof row.release_json === "string"
    ? JSON.parse(row.release_json) as unknown
    : row.release_json;
  return parseStoredGameRelease(value);
}

/** PostgreSQL adapter for durable catalog reads and immutable publication metadata. */
export class PostgresGameCatalogRepository
implements GameCatalogRepository, GameReleasePublicationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async publish(release: GameRelease): Promise<GameReleasePublicationRepositoryResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      // Operator imports reserve new package namespaces in the same transaction
      // as metadata publication. A prior public owner is preserved.
      await client.query(
        `INSERT INTO thorium_game_package_owners (package_id, publisher_id)
         VALUES ($1, NULL)
         ON CONFLICT (package_id) DO NOTHING`,
        [release.packageId],
      );
      const inserted = await client.query<ReleaseRow>(
        `INSERT INTO thorium_game_releases (
           package_id,
           package_version,
           content_digest,
           bundle_file_name,
           bundle_sha256,
           bundle_size_bytes,
           published_at,
           release_json
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (package_id, package_version) DO NOTHING
         RETURNING release_json`,
        [
          release.packageId,
          release.version,
          release.contentDigest,
          release.bundle.fileName,
          release.bundle.sha256,
          release.bundle.sizeBytes,
          release.publishedAt,
          JSON.stringify(release),
        ],
      );
      const created = inserted.rows[0];
      if (created !== undefined) {
        await client.query("COMMIT");
        return { status: "published", release: releaseFromRow(created) };
      }

      const existing = await client.query<ReleaseRow & { readonly content_digest: string }>(
        `SELECT content_digest, release_json
           FROM thorium_game_releases
          WHERE package_id = $1 AND package_version = $2`,
        [release.packageId, release.version],
      );
      const row = existing.rows[0];
      await client.query("COMMIT");
      if (row === undefined || row.content_digest !== release.contentDigest) {
        return { status: "conflict" };
      }
      return { status: "already-published", release: releaseFromRow(row) };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the publication failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(packageId: string, version?: string): Promise<GameRelease | undefined> {
    const result = version === undefined
      ? await this.#pool.query<ReleaseRow>(
        `SELECT release_json
           FROM thorium_game_releases
          WHERE package_id = $1
          ORDER BY published_at DESC, package_version DESC
          LIMIT 1`,
        [packageId],
      )
      : await this.#pool.query<ReleaseRow>(
        `SELECT release_json
           FROM thorium_game_releases
          WHERE package_id = $1 AND package_version = $2`,
        [packageId, version],
      );
    const row = result.rows[0];
    return row === undefined ? undefined : releaseFromRow(row);
  }

  async list(query: {
    readonly query?: string;
    readonly limit: number;
    readonly cursor?: string;
  }) {
    const afterPackageId = query.cursor === undefined ? "" : decodeCursor(query.cursor);
    const search = query.query?.trim().toLocaleLowerCase();
    const result = await this.#pool.query<ReleaseRow>(
      `SELECT release_json
         FROM (
           SELECT DISTINCT ON (package_id)
                  package_id, package_version, published_at, release_json
             FROM thorium_game_releases
            WHERE package_id > $1
              AND (
                $2::text IS NULL
                OR lower(
                  package_id || E'\n'
                  || (release_json ->> 'displayName') || E'\n'
                  || (release_json ->> 'summary') || E'\n'
                  || (release_json -> 'tags')::text
                ) LIKE '%' || $2 || '%'
              )
            ORDER BY package_id, published_at DESC, package_version DESC
         ) latest
        ORDER BY package_id
        LIMIT $3`,
      [afterPackageId, search === undefined || search.length === 0 ? null : search, query.limit + 1],
    );
    const releases = result.rows.map(releaseFromRow);
    const page = releases.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page,
      ...(releases.length > page.length && last !== undefined
        ? { nextCursor: encodeCursor(last.packageId) }
        : {}),
    };
  }
}
