import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATION_LOCK_NAME = "thorium-platform-schema-migrations";
const migrationsDirectory = fileURLToPath(new URL("../../../migrations/", import.meta.url));

/** Applies immutable SQL migrations transactionally under one database lock. */
export async function runPostgresMigrations(pool: Pool): Promise<void> {
  const fileNames = (await readdir(migrationsDirectory))
    .filter((fileName) => /^\d+_[a-z0-9_]+\.sql$/.test(fileName))
    .sort();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [MIGRATION_LOCK_NAME]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS thorium_schema_migrations (
         file_name text PRIMARY KEY,
         sha256 character(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
         applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
       )`,
    );

    for (const fileName of fileNames) {
      const sql = await readFile(new URL(`../../../migrations/${fileName}`, import.meta.url), "utf8");
      const sha256 = createHash("sha256").update(sql).digest("hex");
      const applied = await client.query<{ sha256: string }>(
        "SELECT sha256 FROM thorium_schema_migrations WHERE file_name = $1",
        [fileName],
      );
      const previous = applied.rows[0];
      if (previous !== undefined) {
        if (previous.sha256 !== sha256) {
          throw new Error(`Applied PostgreSQL migration changed: ${fileName}`);
        }
        continue;
      }

      await client.query(sql);
      await client.query(
        "INSERT INTO thorium_schema_migrations (file_name, sha256) VALUES ($1, $2)",
        [fileName, sha256],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the migration error.
    }
    throw error;
  } finally {
    client.release();
  }
}
