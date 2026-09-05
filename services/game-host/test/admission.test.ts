import { generateKeyPairSync, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { AdmissionService } from "../src/admission.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { MemoryNonceStore } from "../src/nonce-store.js";
import { physicalRoomName } from "../src/room-name.js";

describe("shared host admission", () => {
  it("accepts a scoped Platform ticket once and issues one-use shard transfers", async () => {
    const keys = generateKeyPairSync("ed25519");
    let now = new Date("2030-01-01T00:00:00.000Z");
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const release = {
      packageId: "dev.yougotserved.serpent-world",
      version: "0.1.0",
      contentDigest: "a".repeat(64),
    } as const;
    const joinOptions = {
      gameSessionId: "123e4567-e89b-12d3-a456-426614174000",
      packageId: release.packageId,
      packageVersion: release.version,
      packageDigest: release.contentDigest,
    };
    const roomName = physicalRoomName(release, "game_session");
    const token = await new SignJWT({
      ...joinOptions,
      generation: 1,
      surfaceId: "main",
      role: "main",
      playerSlots: [0],
      roomName,
      joinOptionsHash: sha256(canonicalJson(joinOptions)),
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "thorium-game-admission+jwt" })
      .setIssuer("thorium-platform")
      .setAudience("thorium-game-host")
      .setSubject("opaque-account-scope")
      .setJti(randomUUID())
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 60)
      .sign(keys.privateKey);
    const service = new AdmissionService({
      endpoint: "https://games.yougotserved.dev/play",
      nonceStore: new MemoryNonceStore(),
      platformPublicKeyPem: keys.publicKey.export({
        format: "pem",
        type: "spki",
      }).toString(),
      transferSecret: "test-transfer-secret-with-at-least-32-bytes",
      now: () => now,
    });
    await service.ready();
    const admission = service.scoped(
      release,
      (name) => name === "game_session" || name === "serpent_world",
      async () => true,
    );

    const pending = await admission.verifyPlatform(token, {
      localRoomName: "game_session",
      joinOptions,
    });
    const source = await admission.consumePlatform(pending);
    expect(source).toMatchObject({
      accountScope: "opaque-account-scope",
      gameSessionId: joinOptions.gameSessionId,
      generation: 1,
      release,
    });
    const replay = await admission.verifyPlatform(token, {
      localRoomName: "game_session",
      joinOptions,
    });
    await expect(admission.consumePlatform(replay)).rejects.toThrow(
      "capability_expired_replayed_or_at_capacity",
    );

    const fence = {
      gameSessionId: source.gameSessionId,
      generation: source.generation,
      roomInstanceId: "gateway-room",
      release,
    };
    const transfer = await admission.issueTransfer(source, fence, {
      targetLocalRoomName: "serpent_world",
      joinOptions: { shardId: "origin" },
      moduleClaims: { snakeId: "snake-1" },
      expiresInSeconds: 15,
    });
    expect(transfer).toMatchObject({
      endpoint: "https://games.yougotserved.dev/play",
      roomName: physicalRoomName(release, "serpent_world"),
      joinOptions: { shardId: "origin" },
    });
    const pendingTransfer = await admission.verifyTransfer(transfer.token, {
      localRoomName: "serpent_world",
      joinOptions: { shardId: "origin" },
    });
    const consumedTransfer = await admission.consumeTransfer(pendingTransfer);
    expect(consumedTransfer).toMatchObject({
      source: { gameSessionId: source.gameSessionId, generation: 1 },
      fence,
      moduleClaims: { snakeId: "snake-1" },
    });
    const transferReplay = await admission.verifyTransfer(transfer.token, {
      localRoomName: "serpent_world",
      joinOptions: { shardId: "origin" },
    });
    await expect(admission.consumeTransfer(transferReplay)).rejects.toThrow(
      "capability_expired_replayed_or_at_capacity",
    );

    now = new Date(now.getTime() + 100_000);
    const chained = await admission.issueTransfer(consumedTransfer.source, fence, {
      targetLocalRoomName: "serpent_world",
      joinOptions: { shardId: "east" },
      moduleClaims: { snakeId: "snake-1" },
      expiresInSeconds: 15,
    });
    expect(chained.expiresAtEpochMs).toBe(now.getTime() + 15_000);
    const chainedPending = await admission.verifyTransfer(chained.token, {
      localRoomName: "serpent_world",
      joinOptions: { shardId: "east" },
    });
    await expect(admission.consumeTransfer(chainedPending)).resolves.toMatchObject({
      source: { gameSessionId: source.gameSessionId, generation: 1 },
      fence,
    });
  });

  it("refuses transfer minting when the durable session fence is inactive", async () => {
    const keys = generateKeyPairSync("ed25519");
    const release = {
      packageId: "dev.yougotserved.serpent-world",
      version: "0.1.0",
      contentDigest: "b".repeat(64),
    } as const;
    const service = new AdmissionService({
      endpoint: "https://games.yougotserved.dev/play",
      nonceStore: new MemoryNonceStore(),
      platformPublicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
      transferSecret: "test-transfer-secret-with-at-least-32-bytes",
    });
    await service.ready();
    const admission = service.scoped(release, () => true, async () => false);
    const gameSessionId = randomUUID();
    const source = {
      accountScope: "opaque-account-scope",
      capabilityId: randomUUID(),
      expiresAtEpochMs: Date.now() - 60_000,
      gameSessionId,
      generation: 4,
      release,
      surfaceId: "main",
      role: "main" as const,
      playerSlots: [0],
    };
    const fence = { gameSessionId, generation: 4, roomInstanceId: "world", release };
    await expect(admission.issueTransfer(source, fence, {
      targetLocalRoomName: "serpent_world",
      joinOptions: { shardId: "east" },
      moduleClaims: { snakeId: "snake-1" },
    })).rejects.toThrow("inactive_or_superseded_registry_fence");
  });
});
