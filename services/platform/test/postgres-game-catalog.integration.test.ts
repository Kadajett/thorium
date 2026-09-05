import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresGameCatalogRepository } from
  "../src/adapters/postgres/postgres-game-catalog-repository.js";
import { runPostgresMigrations } from "../src/adapters/postgres/postgres-migrations.js";
import { createTestGamePackageFixture } from "./test-game-package-fixture.js";

const databaseUrl = process.env.THORIUM_TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl === undefined || databaseUrl.length === 0
  ? describe.skip
  : describe;

function quoteSchema(name: string): string {
  if (!/^thorium_catalog_test_[a-f0-9]{32}$/.test(name)) throw new Error("unsafe test schema");
  return `"${name}"`;
}

describeWithPostgres("PostgreSQL game catalog publication", () => {
  const schemaName = `thorium_catalog_test_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = quoteSchema(schemaName);
  let controlPool: Pool | undefined;
  let catalogPool: Pool | undefined;
  let catalog: PostgresGameCatalogRepository;

  beforeAll(async () => {
    controlPool = new Pool({ connectionString: databaseUrl, max: 2 });
    await controlPool.query(`CREATE SCHEMA ${quotedSchema}`);
    catalogPool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      options: `-c search_path=${schemaName},public`,
    });
    await runPostgresMigrations(catalogPool);
    catalog = new PostgresGameCatalogRepository(catalogPool);
  }, 30_000);

  afterAll(async () => {
    await catalogPool?.end();
    try {
      await controlPool?.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
    } finally {
      await controlPool?.end();
    }
  }, 30_000);

  it("publishes exact releases idempotently and rejects version reuse", async () => {
    const fixture = createTestGamePackageFixture("https://games.yougotserved.dev");
    await expect(catalog.publish(fixture.release)).resolves.toMatchObject({ status: "published" });
    await expect(catalog.publish(fixture.release)).resolves.toMatchObject({
      status: "already-published",
      release: fixture.release,
    });
    await expect(catalog.publish({
      ...fixture.release,
      contentDigest: "f".repeat(64),
    })).resolves.toEqual({ status: "conflict" });

    await expect(catalog.findById(fixture.release.packageId, fixture.release.version))
      .resolves.toEqual(fixture.release);
    await expect(catalog.list({ limit: 20 })).resolves.toEqual({ items: [fixture.release] });
  });

  it("lists and searches the latest published release", async () => {
    const fixture = createTestGamePackageFixture("https://games.yougotserved.dev");
    await catalog.publish(fixture.release);

    await expect(catalog.list({ limit: 20 })).resolves.toMatchObject({
      items: [{ packageId: fixture.release.packageId }],
    });
    await expect(catalog.list({ query: fixture.release.displayName, limit: 20 }))
      .resolves.toMatchObject({
        items: [{ packageId: fixture.release.packageId }],
      });
  });
});
