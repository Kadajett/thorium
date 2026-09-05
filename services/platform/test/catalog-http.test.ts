import { decodeJwt } from "jose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { InMemoryGameCatalogRepository } from "../src/adapters/in-memory-game-catalog.js";
import { createHttpApplication } from "../src/http/routes.js";
import type { GameSessionRegistry } from "../src/session-registry/game-session-registry.js";
import {
  createTestHarness,
  TEST_GAMES,
  TEST_PUBLIC_BASE_URL,
  TWO_SURFACE_LEASES,
} from "./test-harness.js";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";

describe("platform HTTP routes", () => {
  it("reports health and lists a web-v1 game with two entrypoints", async () => {
    const { dependencies } = createTestHarness();
    const app = createHttpApplication(dependencies);

    const health = await request(app).get("/health").expect(200);
    expect(health.body).toEqual({
      status: "ok",
      service: "thorium-platform",
      version: "0.1.0",
    });
    const ready = await request(app).get("/ready").expect(200);
    expect(ready.body).toEqual({
      status: "ready",
      service: "thorium-platform",
    });

    const response = await request(app).get("/v1/catalog/games").expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      packageId: "dev.yougotserved.platform-fixture",
      displayName: "Platform Fixture",
      runtime: {
        kind: "web-v1",
        entrypoints: {
          main: { path: "main/index.html" },
          companion: { path: "companion/index.html" },
        },
      },
      bundle: {
        url: `${TEST_PUBLIC_BASE_URL}${new URL(TEST_GAMES[0]?.bundle.url ?? "").pathname}`,
      },
    });
  });

  it("fails readiness closed when the durable dependency is unavailable", async () => {
    const { dependencies } = createTestHarness();
    const app = createHttpApplication({
      ...dependencies,
      isReady: async () => {
        throw new Error("database unavailable");
      },
    });

    const response = await request(app).get("/ready").expect(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      status: "unavailable",
      service: "thorium-platform",
    });
  });

  it("supports search and package detail routes", async () => {
    const { dependencies } = createTestHarness();
    const app = createHttpApplication(dependencies);

    const search = await request(app)
      .get("/v1/catalog/games/search")
      .query({ q: "platform fixture" })
      .expect(200);
    expect(search.body.items.map((item: { packageId: string }) => item.packageId))
      .toEqual(["dev.yougotserved.platform-fixture"]);

    const detail = await request(app)
      .get("/v1/catalog/games/dev.yougotserved.platform-fixture")
      .expect(200);
    expect(detail.body.game.version).toBe("1.2.3");

    await request(app)
      .get("/v1/catalog/games/dev.yougotserved.missing")
      .expect(404)
      .expect(({ body }) => {
        expect(body.error.code).toBe("game_not_found");
      });
  });

  it("starts an exact Game Release with separate scoped surface tickets", async () => {
    const { dependencies, accountIdentity } = createTestHarness();
    const app = createHttpApplication(dependencies);
    const accountToken = await accountIdentity.issueForTesting(
      "account-private-123",
      "account-session-private-456",
    );

    const response = await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: TEST_GAMES[0]?.packageId,
          version: TEST_GAMES[0]?.version,
          contentDigest: TEST_GAMES[0]?.contentDigest,
        },
        surfaces: TWO_SURFACE_LEASES,
      })
      .expect(201);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.endpoint).toBe(TEST_PUBLIC_BASE_URL);
    expect(response.body.roomName).toBe("game_session");
    expect(response.body.joinOptions).toEqual({
      gameSessionId: response.body.gameSessionId,
      packageId: TEST_GAMES[0]?.packageId,
      packageVersion: TEST_GAMES[0]?.version,
      packageDigest: TEST_GAMES[0]?.contentDigest,
    });
    expect(response.body.surfaces).toHaveLength(2);
    expect(response.body.surfaces.map((surface: { surfaceId: string }) => surface.surfaceId))
      .toEqual(["upper", "lower"]);

    const claims = response.body.surfaces.map((surface: { ticket: string }) => decodeJwt(surface.ticket));
    expect(claims[0]?.sub).toBe(claims[1]?.sub);
    expect(claims[0]?.sub).not.toContain("account-private-123");
    expect(JSON.stringify(response.body)).not.toContain(accountToken);
    expect(JSON.stringify(response.body)).not.toContain("account-private-123");
    expect(claims[0]).toMatchObject({
      packageId: "dev.yougotserved.platform-fixture",
      surfaceId: "upper",
      role: "main",
      playerSlots: [0],
    });
    expect(response.body.surfaces[0]).toMatchObject({
      surfaceId: "upper",
      role: "main",
      playerSlots: [0],
      ticket: expect.any(String),
    });
  });

  it("replays one activation request without minting another Game Session", async () => {
    const { dependencies, accountIdentity } = createTestHarness();
    const app = createHttpApplication(dependencies);
    const accountToken = await accountIdentity.issueForTesting(
      "account-idempotent",
      "account-session-idempotent",
    );
    const body = {
      requestId: "00000000-0000-4000-8000-000000000099",
      release: {
        packageId: TEST_GAMES[0]?.packageId,
        version: TEST_GAMES[0]?.version,
        contentDigest: TEST_GAMES[0]?.contentDigest,
      },
      surfaces: TWO_SURFACE_LEASES,
    };
    const start = () => request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send(body);

    const created = await start().expect(201);
    const replayed = await start().expect(200);
    expect(replayed.body.gameSessionId).toBe(created.body.gameSessionId);
    expect(replayed.body.surfaces.map((surface: { ticket: string }) => decodeJwt(surface.ticket).jti))
      .toEqual(created.body.surfaces.map((surface: { ticket: string }) => decodeJwt(surface.ticket).jti));

    await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        ...body,
        surfaces: [
          { ...TWO_SURFACE_LEASES[0], playerSlots: [1] },
          { ...TWO_SURFACE_LEASES[1], playerSlots: [0] },
        ],
      })
      .expect(409)
      .expect(({ body: responseBody }) => {
        expect(responseBody.error.code).toBe("request_id_reused");
      });
  });

  it("rejects unauthenticated starts and duplicate PlayerSlots", async () => {
    const { dependencies, accountIdentity } = createTestHarness();
    const app = createHttpApplication(dependencies);

    await request(app)
      .post("/v1/game-sessions")
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: TEST_GAMES[0]?.packageId,
          version: TEST_GAMES[0]?.version,
          contentDigest: TEST_GAMES[0]?.contentDigest,
        },
        surfaces: TWO_SURFACE_LEASES,
      })
      .expect(401);

    const accountToken = await accountIdentity.issueForTesting("account-1", "session-1");
    const duplicateSlots = [
      TWO_SURFACE_LEASES[0],
      { ...TWO_SURFACE_LEASES[1], playerSlots: [0] },
    ];
    const duplicate = await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: TEST_GAMES[0]?.packageId,
          version: TEST_GAMES[0]?.version,
          contentDigest: TEST_GAMES[0]?.contentDigest,
        },
        surfaces: duplicateSlots,
      })
      .expect(400);
    expect(duplicate.body.error.code).toBe("duplicate_player_slot");
  });

  it("requires enough Account Session lifetime to finish matchmaking", async () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    const { dependencies, accountIdentity } = createTestHarness(() => now);
    const app = createHttpApplication(dependencies);
    const accountToken = await accountIdentity.issueForTesting(
      "account-expiring",
      "account-session-expiring",
      9,
    );

    const response = await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: TEST_GAMES[0]?.packageId,
          version: TEST_GAMES[0]?.version,
          contentDigest: TEST_GAMES[0]?.contentDigest,
        },
        surfaces: TWO_SURFACE_LEASES,
      })
      .expect(401);

    expect(response.body.error).toMatchObject({ code: "account_session_expiring" });
  });

  it("prepares ticket timing once before the durable activation", async () => {
    let now = new Date("2026-09-04T12:00:00.000Z");
    const harness = createTestHarness(() => now);
    const delegate = harness.gameSessions;
    const gameSessions: GameSessionRegistry = {
      activate: async (input) => {
        now = new Date(now.getTime() + 1);
        return delegate.activate(input);
      },
      admit: (input) => delegate.admit(input),
      isActive: (input) => delegate.isActive(input),
      finish: (input) => delegate.finish(input),
    };
    const app = createHttpApplication({ ...harness.dependencies, gameSessions });
    const accountToken = await harness.accountIdentity.issueForTesting(
      "account-prepared-ticket",
      "account-session-prepared-ticket",
      10,
    );

    const response = await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: "00000000-0000-4000-8000-000000000088",
        release: {
          packageId: TEST_GAMES[0]?.packageId,
          version: TEST_GAMES[0]?.version,
          contentDigest: TEST_GAMES[0]?.contentDigest,
        },
        surfaces: TWO_SURFACE_LEASES,
      })
      .expect(201);

    expect(response.body.expiresAt).toBe("2026-09-04T12:00:10.000Z");
  });

  it("requires a strict exact Game Release identity", async () => {
    const { dependencies, accountIdentity } = createTestHarness();
    const app = createHttpApplication(dependencies);
    const accountToken = await accountIdentity.issueForTesting("account-1", "session-1");
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");

    const mismatch = await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: game.packageId,
          version: game.version,
          contentDigest: "0".repeat(64),
        },
        surfaces: TWO_SURFACE_LEASES,
      })
      .expect(409);
    expect(mismatch.body.error.code).toBe("game_release_mismatch");

    await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: game.packageId,
          version: game.version,
          contentDigest: game.contentDigest,
          unexpected: true,
        },
        surfaces: TWO_SURFACE_LEASES,
      })
      .expect(400);

    await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: game.packageId,
          version: game.version,
        },
        surfaces: TWO_SURFACE_LEASES,
      })
      .expect(400);

    await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: game.packageId,
          version: game.version,
          contentDigest: game.contentDigest,
        },
        surfaces: [{ ...TWO_SURFACE_LEASES[0], unexpected: true }, TWO_SURFACE_LEASES[1]],
      })
      .expect(400);

    await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: game.packageId,
          version: game.version,
          contentDigest: game.contentDigest,
        },
        surfaces: TWO_SURFACE_LEASES,
        unexpected: true,
      })
      .expect(400);

    await request(app)
      .post("/v1/session-tickets")
      .set("authorization", `Bearer ${accountToken}`)
      .send({})
      .expect(404);
  });

  it("enforces PlayerSlot counts and unique Surface Roles and IDs", async () => {
    const harness = createTestHarness();
    const game = TEST_GAMES[0];
    if (game === undefined) throw new Error("sample game missing");
    const accountToken = await harness.accountIdentity.issueForTesting("account-1", "session-1");
    const start = (surfaces: unknown, catalogGame = game) => request(createHttpApplication({
      ...harness.dependencies,
      catalog: new InMemoryGameCatalogRepository([catalogGame]),
    }))
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${accountToken}`)
      .send({
        requestId: REQUEST_ID,
        release: {
          packageId: catalogGame.packageId,
          version: catalogGame.version,
          contentDigest: catalogGame.contentDigest,
        },
        surfaces,
      });

    await start([
      { ...TWO_SURFACE_LEASES[0], playerSlots: [0] },
      { ...TWO_SURFACE_LEASES[1], playerSlots: [] },
    ])
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("player_slot_count_out_of_range"));

    await start([{ ...TWO_SURFACE_LEASES[0], playerSlots: [0, 1] }])
      .expect(400)
      .expect(({ body }) => {
        expect(body.error.code).toBe("required_surface_missing");
        expect(body.error.details).toEqual({ roles: ["companion"] });
      });

    await start([
      { ...TWO_SURFACE_LEASES[0], playerSlots: [0, 1, 2] },
      { ...TWO_SURFACE_LEASES[1], playerSlots: [3, 4] },
    ])
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("player_slot_count_out_of_range"));

    await start([
      { ...TWO_SURFACE_LEASES[0], playerSlots: [0, 1] },
      { ...TWO_SURFACE_LEASES[1], playerSlots: [2] },
    ])
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("local_player_slot_count_out_of_range"));

    await start(TWO_SURFACE_LEASES, {
      ...game,
      players: { ...game.players, sameAccountMultipleSlots: false },
    })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("same_account_multiple_slots_denied"));

    await start([
      TWO_SURFACE_LEASES[0],
      { ...TWO_SURFACE_LEASES[1], surfaceId: "upper" },
    ])
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("duplicate_surface"));

    await start([
      TWO_SURFACE_LEASES[0],
      { ...TWO_SURFACE_LEASES[1], role: "main" },
    ])
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe("duplicate_surface_role"));

    await start([
      { ...TWO_SURFACE_LEASES[0], playerSlots: ["0"] },
      TWO_SURFACE_LEASES[1],
    ]).expect(400);
  });
});
