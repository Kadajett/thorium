import { expect, it } from "vitest";
import { InMemoryGameCatalogRepository } from "../src/adapters/in-memory-game-catalog.js";
import { catalogReleases } from "./catalog-current-fixture.js";

it("lists one current release per package, independent of input and semantic version order", async () => {
  const [older, current, other] = catalogReleases();
  const catalog = new InMemoryGameCatalogRepository([older, other, current]);
  expect((await catalog.list({ limit: 20 })).items).toEqual([current, other]);
  expect(await catalog.findById(current.packageId)).toEqual(current);
  expect(await catalog.findById(older.packageId, older.version)).toEqual(older);
});

it("paginates current packages without repeating or dropping releases", async () => {
  const [older, current, other] = catalogReleases();
  const catalog = new InMemoryGameCatalogRepository([older, current, other]);
  const first = await catalog.list({ limit: 1 });
  expect(first.items).toEqual([current]);
  expect(first.nextCursor).toBeTypeOf("string");
  const second = await catalog.list({ limit: 1, cursor: first.nextCursor ?? "" });
  expect(second).toEqual({ items: [other] });
});

it("searches only current metadata and treats wildcard characters literally", async () => {
  const [older, current, other] = catalogReleases();
  const catalog = new InMemoryGameCatalogRepository([older, current, other]);
  expect(await catalog.list({ query: "retired orchard", limit: 20 })).toEqual({ items: [] });
  expect(await catalog.list({ query: "CURRENT MEADOW", limit: 20 })).toEqual({ items: [current] });
  expect(await catalog.list({ query: "%", limit: 20 })).toEqual({ items: [] });
});

it("preserves the text version tie-breaker for equal publication timestamps", async () => {
  const [older, current] = catalogReleases();
  const catalog = new InMemoryGameCatalogRepository([
    { ...current, version: "1.10.0" },
    { ...older, version: "1.9.0", publishedAt: current.publishedAt },
  ]);
  expect((await catalog.findById(current.packageId))?.version).toBe("1.9.0");
  expect((await catalog.list({ limit: 1 })).items[0]?.version).toBe("1.9.0");
});

it("rejects noncanonical cursors and isolates catalog results from caller mutations", async () => {
  const [older, current] = catalogReleases();
  const catalog = new InMemoryGameCatalogRepository([older, current]);
  Reflect.set(current, "summary", "caller mutation");
  const first = await catalog.findById(current.packageId);
  expect(first?.summary).toBe("Current meadow");
  if (first === undefined) throw new Error("fixture release missing");
  Reflect.set(first, "summary", "result mutation");
  expect((await catalog.findById(current.packageId))?.summary).toBe("Current meadow");
  await expect(catalog.list({ limit: 1, cursor: "not-base64!" })).rejects.toThrow(
    "invalid_catalog_cursor",
  );
});
