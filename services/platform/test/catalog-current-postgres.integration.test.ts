import { expect, it } from "vitest";
import { InMemoryGameCatalogRepository } from "../src/adapters/in-memory-game-catalog.js";
import type { GameCatalogRepository } from "../src/ports/game-catalog-repository.js";
import type { GameReleasePublicationRepository } from "../src/ports/game-release-publication-repository.js";
import { catalogReleases } from "./catalog-current-fixture.js";
import { createCatalogDatabase } from "./catalog-postgres-fixture.js";

const databaseUrl = process.env.THORIUM_TEST_DATABASE_URL?.trim();
const test = it.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
type Catalog = GameCatalogRepository & GameReleasePublicationRepository;

async function seed(catalog: Catalog): Promise<void> {
  for (const release of catalogReleases()) await catalog.publish(release);
}

async function withCatalog(check: (catalog: Catalog) => Promise<void>): Promise<void> {
  if (databaseUrl === undefined) throw new Error("test database missing");
  const fixture = await createCatalogDatabase(databaseUrl);
  try {
    await seed(fixture.catalog);
    await check(fixture.catalog);
  } finally {
    await fixture.dispose();
  }
}

test("PostgreSQL returns the current release and preserves exact history", () =>
  withCatalog(async (catalog) => {
    const [older, current] = catalogReleases();
    expect(await catalog.findById(current.packageId)).toEqual(current);
    expect(await catalog.findById(older.packageId, older.version)).toEqual(older);
  }));

test("PostgreSQL and memory agree on current list and pagination", () =>
  withCatalog(async (catalog) => {
    const memory = new InMemoryGameCatalogRepository(catalogReleases());
    const first = await catalog.list({ limit: 1 });
    expect(first).toEqual(await memory.list({ limit: 1 }));
    const query = { limit: 1, cursor: first.nextCursor ?? "" };
    expect(await catalog.list(query)).toEqual(await memory.list(query));
  }));

test("PostgreSQL search uses only current metadata with literal wildcard parity", () =>
  withCatalog(async (catalog) => {
    const memory = new InMemoryGameCatalogRepository(catalogReleases());
    for (const query of ["retired orchard", "current meadow", "%", "_", "test-fixture", ""]) {
      const input = { query, limit: 20 };
      expect(await catalog.list(input)).toEqual(await memory.list(input));
    }
    await expect(catalog.list({ limit: 1, cursor: "bad!" })).rejects.toThrow(
      "invalid_catalog_cursor",
    );
  }));

test("PostgreSQL preserves timestamp-first ordering and a text version tie-breaker", () =>
  withCatalog(async (catalog) => {
    const [, current] = catalogReleases();
    const left = {
      ...current,
      version: "1.10.0",
      contentDigest: "d".repeat(64),
      publishedAt: "2026-03-01T00:00:00.000Z",
      tags: [],
    };
    const right = {
      ...left,
      version: "1.9.0",
      contentDigest: "e".repeat(64),
      publishedAt: "2026-03-01T00:00:00Z",
    };
    await catalog.publish(left);
    await catalog.publish(right);
    expect(await catalog.findById(current.packageId)).toEqual(right);
    expect((await catalog.list({ limit: 20 })).items[0]).toEqual(right);
    const memory = new InMemoryGameCatalogRepository([left, right]);
    expect(await memory.findById(current.packageId)).toEqual(right);
  }));

test("PostgreSQL and memory compare publication instants across timezone offsets", () =>
  withCatalog(async (catalog) => {
    const [, base] = catalogReleases();
    const older = {
      ...base,
      version: "3.0.0",
      contentDigest: "d".repeat(64),
      publishedAt: "2026-03-01T02:00:00+03:00",
    };
    const current = {
      ...base,
      version: "3.0.1",
      contentDigest: "e".repeat(64),
      publishedAt: "2026-02-28T23:30:00Z",
    };
    await catalog.publish(older);
    await catalog.publish(current);
    const memory = new InMemoryGameCatalogRepository([older, current]);
    expect(await catalog.findById(base.packageId)).toEqual(current);
    expect(await memory.findById(base.packageId)).toEqual(current);
  }));
