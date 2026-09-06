import type { Pool, PoolClient } from "pg";
import type { GameRelease } from "../../domain/game-package.js";
import type { GameReleasePublicationRepositoryResult } from "../../ports/game-release-publication-repository.js";
import { releaseFromRow, type ReleaseRow } from "./catalog-release-row.js";

async function insertRelease(
  client: PoolClient,
  release: GameRelease,
): Promise<ReleaseRow | undefined> {
  const result = await client.query<ReleaseRow>(
    `INSERT INTO thorium_game_releases (
       package_id, package_version, content_digest, bundle_file_name,
       bundle_sha256, bundle_size_bytes, published_at, release_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (package_id, package_version) DO NOTHING RETURNING release_json`,
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
  return result.rows[0];
}

async function existingRelease(
  client: PoolClient,
  release: GameRelease,
): Promise<GameReleasePublicationRepositoryResult> {
  const result = await client.query<ReleaseRow & { readonly content_digest: string }>(
    `SELECT content_digest, release_json FROM thorium_game_releases
      WHERE package_id = $1 AND package_version = $2`,
    [release.packageId, release.version],
  );
  const row = result.rows[0];
  if (row === undefined || row.content_digest !== release.contentDigest)
    return { status: "conflict" };
  return { status: "already-published", release: releaseFromRow(row) };
}

async function publishTransaction(
  client: PoolClient,
  release: GameRelease,
): Promise<GameReleasePublicationRepositoryResult> {
  // Operator imports reserve an unowned namespace without replacing existing ownership.
  await client.query(
    `INSERT INTO thorium_game_package_owners (package_id, publisher_id)
     VALUES ($1, NULL) ON CONFLICT (package_id) DO NOTHING`,
    [release.packageId],
  );
  const created = await insertRelease(client, release);
  return created === undefined
    ? existingRelease(client, release)
    : { status: "published", release: releaseFromRow(created) };
}

export async function publishCatalogRelease(
  pool: Pool,
  release: GameRelease,
): Promise<GameReleasePublicationRepositoryResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await publishTransaction(client, release);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original publication failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
