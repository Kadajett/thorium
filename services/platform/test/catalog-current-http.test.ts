import request from "supertest";
import { expect, it } from "vitest";
import { z } from "zod";
import { InMemoryGameCatalogRepository } from "../src/adapters/in-memory-game-catalog.js";
import { exactGameRelease } from "../src/core/current-game-release.js";
import { createHttpApplication } from "../src/http/routes.js";
import { catalogReleases } from "./catalog-current-fixture.js";
import { createTestHarness, TWO_SURFACE_LEASES } from "./test-harness.js";

const identitySchema = z.object({
  packageId: z.string(),
  version: z.string(),
  contentDigest: z.string(),
});
const pageSchema = z.object({ items: z.array(identitySchema), nextCursor: z.string().optional() });

async function fixture() {
  const [older, current, other] = catalogReleases();
  const harness = createTestHarness();
  let catalog = new InMemoryGameCatalogRepository([older]);
  const app = createHttpApplication({
    ...harness.dependencies,
    catalog: {
      list: (query) => catalog.list(query),
      findById: (packageId, version) => catalog.findById(packageId, version),
    },
  });
  const token = await harness.accountIdentity.issueForTesting("catalog-account", "catalog-session");
  return {
    app,
    older,
    current,
    harness,
    token,
    publishCurrent() {
      catalog = new InMemoryGameCatalogRepository([older, current, other]);
    },
    body: {
      requestId: "00000000-0000-4000-8000-000000000075",
      release: exactGameRelease(older),
      surfaces: TWO_SURFACE_LEASES,
    },
  };
}

it("HTTP catalog pages contain one current release per game", async () => {
  const f = await fixture();
  f.publishCurrent();
  const first = await request(f.app).get("/v1/catalog/games").query({ limit: 1 }).expect(200);
  const page = pageSchema.parse(first.body);
  expect(page.items).toEqual([exactGameRelease(f.current)]);
  const next = await request(f.app)
    .get("/v1/catalog/games")
    .query({ limit: 1, cursor: page.nextCursor })
    .expect(200);
  expect(pageSchema.parse(next.body).items).toHaveLength(1);
});

it("HTTP detail returns the current release while exact historical detail stays available", async () => {
  const f = await fixture();
  f.publishCurrent();
  const detail = await request(f.app).get(`/v1/catalog/games/${f.current.packageId}`).expect(200);
  expect(z.object({ game: identitySchema }).parse(detail.body).game).toEqual(
    exactGameRelease(f.current),
  );
  expect(detail.headers["cache-control"]).toBe("no-store");
  const old = await request(f.app)
    .get(`/v1/catalog/games/${f.older.packageId}`)
    .query({ version: f.older.version })
    .expect(200);
  expect(z.object({ game: identitySchema }).parse(old.body).game).toEqual(
    exactGameRelease(f.older),
  );
});

it("HTTP search cannot resurrect obsolete metadata and rejects invalid cursors", async () => {
  const f = await fixture();
  f.publishCurrent();
  const stale = await request(f.app)
    .get("/v1/catalog/games/search")
    .query({ q: "retired orchard" })
    .expect(200);
  expect(pageSchema.parse(stale.body).items).toEqual([]);
  const found = await request(f.app)
    .get("/v1/catalog/games/search")
    .query({ q: "current meadow" })
    .expect(200);
  expect(pageSchema.parse(found.body).items).toEqual([exactGameRelease(f.current)]);
  await request(f.app).get("/v1/catalog/games").query({ cursor: "bad!" }).expect(400);
});

it("rejects superseded starts with a current identity and leaves an existing session active", async () => {
  const f = await fixture();
  const activationInput = { ...f.body, accountId: "catalog-account" };
  expect((await f.harness.gameSessions.activate(activationInput)).ok).toBe(true);
  f.publishCurrent();
  const response = await request(f.app)
    .post("/v1/game-sessions")
    .set("authorization", `Bearer ${f.token}`)
    .send(f.body)
    .expect(409);
  const schema = z.object({
    error: z.object({ code: z.string(), details: z.object({ currentRelease: identitySchema }) }),
  });
  expect(schema.parse(response.body).error).toEqual({
    code: "game_update_required",
    details: { currentRelease: exactGameRelease(f.current) },
  });
  expect(await f.harness.gameSessions.activate(activationInput)).toMatchObject({
    ok: true,
    replayed: true,
  });
});

it("checks exact integrity before update policy and accepts the current release", async () => {
  const f = await fixture();
  f.publishCurrent();
  const bad = await request(f.app)
    .post("/v1/game-sessions")
    .set("authorization", `Bearer ${f.token}`)
    .send({ ...f.body, release: { ...f.body.release, contentDigest: "0".repeat(64) } })
    .expect(409);
  expect(z.object({ error: z.object({ code: z.string() }) }).parse(bad.body).error.code).toBe(
    "game_release_mismatch",
  );
  await request(f.app)
    .post("/v1/game-sessions")
    .set("authorization", `Bearer ${f.token}`)
    .send({ ...f.body, release: exactGameRelease(f.current) })
    .expect(201);
});

it("replays a current launch but requires an update for its old POST after publication", async () => {
  const f = await fixture();
  const start = () =>
    request(f.app).post("/v1/game-sessions").set("authorization", `Bearer ${f.token}`).send(f.body);
  await start().expect(201);
  await start().expect(200);
  f.publishCurrent();
  await start().expect(409);
});
