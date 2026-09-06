import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPostgresGameCatalogRepository } from "../src/adapters/postgres/postgres-game-catalog-repository.js";
import { runPostgresMigrations } from "../src/adapters/postgres/postgres-migrations.js";

export async function createCatalogDatabase(connectionString: string) {
  const schema = `thorium_catalog_current_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, max: 2, options: `-c search_path=${schema},public` });
  const dispose = async () => {
    await pool.end();
    try {
      await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await control.end();
    }
  };
  await control.query(`CREATE SCHEMA "${schema}"`);
  try {
    await runPostgresMigrations(pool);
    return { catalog: createPostgresGameCatalogRepository(pool), dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
