import { randomUUID } from "node:crypto";
import { decodeJwt, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { InMemoryGameCatalogRepository } from "../src/adapters/in-memory-game-catalog.js";
import { createHttpApplication } from "../src/http/routes.js";
import {
  SharedGameHostAuthority,
  sharedHostPhysicalRoomName,
} from "../src/security/shared-game-host-authority.js";
import type { SessionTicketBundle } from "../src/security/session-ticket-service.js";
import { createTestHarness, TEST_GAMES, TEST_SESSION_SECRET } from "./test-harness.js";

async function fixture() {
  const keys = await generateKeyPair("EdDSA", { extractable: true });
  const privateKey = await exportPKCS8(keys.privateKey);
  const harness = createTestHarness();
  const game = {
    ...TEST_GAMES[0]!,
    players: {
      minSlots: 1,
      maxSlots: 1,
      maxLocalSlots: 1,
      sameAccountMultipleSlots: false,
      defaultLocalSeatPlan: { main: [], companion: [0] },
    },
    multiplayer: {
      ...TEST_GAMES[0]!.multiplayer,
      requiresOnline: true,
    },
  };
  const release = {
    packageId: game.packageId,
    version: game.version,
    contentDigest: game.contentDigest,
  };
  const serviceToken = "test-shared-host-token-with-at-least-32-characters";
  const gameHost = new SharedGameHostAuthority({
    endpoint: "https://games.yougotserved.dev/play",
    admissionPrivateKeyFile: "private-key",
    serviceTokenFile: "service-token",
    scopeSecret: TEST_SESSION_SECRET,
    readSecret: (file) => file === "private-key" ? privateKey : serviceToken,
  });
  await gameHost.ready();
  const dependencies = {
    ...harness.dependencies,
    gameHost,
    catalog: new InMemoryGameCatalogRepository([game]),
  };
  const app = createHttpApplication(dependencies);
  async function start(accountId = "private-account", sessionId = "account-session") {
    const token = await harness.accountIdentity.issueForTesting(accountId, sessionId);
    const response = await request(app)
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${token}`)
      .send({
        requestId: randomUUID(),
        release,
        surfaces: [
          { surfaceId: "main", role: "main", playerSlots: [] },
          { surfaceId: "companion", role: "companion", playerSlots: [0] },
        ],
      })
      .expect(201);
    return response.body as SessionTicketBundle;
  }
  return {
    ...harness,
    keys,
    gameHost,
    serviceToken,
    dependencies,
    app,
    start,
    game,
    release,
  };
}

describe("shared game host authority", () => {
  it("derives one collision-resistant physical room name for an exact release", async () => {
    const f = await fixture();
    expect(sharedHostPhysicalRoomName(f.release)).toMatch(/^g_[a-f0-9]{32}$/);
    expect(sharedHostPhysicalRoomName(f.release)).not.toBe(sharedHostPhysicalRoomName({
      ...f.release,
      contentDigest: "0".repeat(64),
    }));
  });

  it("issues scoped EdDSA capabilities for both surfaces through one host", async () => {
    const f = await fixture();
    const first = await f.start();
    expect(first.endpoint).toBe("https://games.yougotserved.dev/play");
    expect(first.roomName).toBe(sharedHostPhysicalRoomName(f.release));

    const publicClaims = (await jwtVerify(first.surfaces[0]!.ticket, f.keys.publicKey, {
      issuer: "thorium-platform",
      audience: "thorium-game-host",
      algorithms: ["EdDSA"],
    })).payload;
    const privateClaims = decodeJwt(first.surfaces[1]!.ticket);
    expect(publicClaims).toMatchObject({
      role: "main",
      playerSlots: [],
      gameSessionId: first.gameSessionId,
      packageDigest: f.release.contentDigest,
      generation: 1,
      roomName: first.roomName,
    });
    expect(publicClaims.joinOptionsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(privateClaims).toMatchObject({
      role: "companion",
      playerSlots: [0],
      sub: publicClaims.sub,
      roomName: first.roomName,
      joinOptionsHash: publicClaims.joinOptionsHash,
    });
    expect(publicClaims.jti).not.toBe(privateClaims.jti);
    expect(JSON.stringify(publicClaims)).not.toContain("private-account");

    const refreshed = await f.start("private-account", "refreshed-account-session");
    expect(decodeJwt(refreshed.surfaces[0]!.ticket).sub).toBe(publicClaims.sub);
    expect(decodeJwt(refreshed.surfaces[0]!.ticket).generation).toBe(2);
    const other = await f.start("different-account");
    expect(decodeJwt(other.surfaces[0]!.ticket).sub).not.toBe(publicClaims.sub);
  });

  it("authenticates the host and fences an exact active release", async () => {
    const f = await fixture();
    const bundle = await f.start();
    const claims = decodeJwt(bundle.surfaces[0]!.ticket);
    const fence = {
      gameSessionId: bundle.gameSessionId,
      generation: claims.generation,
      roomInstanceId: "shared-host-room",
      release: f.release,
    };
    const body = {
      ...fence,
      capabilityId: claims.jti,
      surfaceId: "main",
      role: "main",
      playerSlots: [],
    };

    await request(f.app).post("/v1/game-host/admit").send(body).expect(401);
    await request(f.app).post("/v1/game-host/admit")
      .set("authorization", `Bearer ${f.serviceToken}`)
      .send({ ...body, release: { ...f.release, contentDigest: "0".repeat(64) } })
      .expect(403);
    await request(f.app).post("/v1/game-host/admit")
      .set("authorization", `Bearer ${f.serviceToken}`).send(body).expect(200);
    await request(f.app).post("/v1/game-host/admit")
      .set("authorization", `Bearer ${f.serviceToken}`).send(body).expect(403);

    const active = await request(f.app).post("/v1/game-host/fence")
      .set("authorization", `Bearer ${f.serviceToken}`).send(fence).expect(200);
    expect(active.body).toEqual({ active: true });
    await f.start();
    const superseded = await request(f.app).post("/v1/game-host/fence")
      .set("authorization", `Bearer ${f.serviceToken}`).send(fence).expect(200);
    expect(superseded.body).toEqual({ active: false });
    await request(f.app).post("/v1/game-host/finish")
      .set("authorization", `Bearer ${f.serviceToken}`)
      .send({ ...fence, reason: "abandoned" })
      .expect(409);
  });

  it("rejects wrong seat routing and required-online play without the shared host", async () => {
    const f = await fixture();
    const token = await f.accountIdentity.issueForTesting("a", "s");
    const body = {
      requestId: randomUUID(),
      release: f.release,
      surfaces: [
        { surfaceId: "main", role: "main", playerSlots: [0] },
        { surfaceId: "companion", role: "companion", playerSlots: [] },
      ],
    };
    const wrong = await request(f.app).post("/v1/game-sessions")
      .set("authorization", `Bearer ${token}`).send(body).expect(400);
    expect(wrong.body.error.code).toBe("surface_seat_plan_mismatch");

    const { gameHost: _removed, ...withoutHost } = f.dependencies;
    const unavailable = await request(createHttpApplication(withoutHost))
      .post("/v1/game-sessions")
      .set("authorization", `Bearer ${token}`)
      .send({
        ...body,
        surfaces: [
          { surfaceId: "main", role: "main", playerSlots: [] },
          { surfaceId: "companion", role: "companion", playerSlots: [0] },
        ],
      })
      .expect(503);
    expect(unavailable.body.error.code).toBe("game_authority_unavailable");
  });
});
