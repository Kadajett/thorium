import { describe, expect, it } from "vitest";
import { InMemoryGameSessionRegistry } from "../src/adapters/in-memory-game-session-registry.js";
import type {
  ActivateGameSession,
  GameSessionActivation,
} from "../src/session-registry/game-session-registry.js";

const release = {
  packageId: "dev.yougotserved.tap-race",
  version: "0.1.0",
  contentDigest: "a".repeat(64),
} as const;

const surfaces = [
  { surfaceId: "upper", role: "main", playerSlots: [0] },
  { surfaceId: "lower", role: "companion", playerSlots: [1, 2] },
] as const;

function request(
  requestId: string,
  overrides: Partial<ActivateGameSession> = {},
): ActivateGameSession {
  return {
    requestId,
    accountId: "durable-account-1",
    release,
    surfaces,
    ...overrides,
  };
}

function deterministicRegistry(): InMemoryGameSessionRegistry {
  let id = 0;
  return new InMemoryGameSessionRegistry({
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  });
}

function expectActivation(
  result: Awaited<ReturnType<InMemoryGameSessionRegistry["activate"]>>,
): GameSessionActivation {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.conflict.code);
  return result.activation;
}

describe("GameSessionRegistry", () => {
  it("atomically supersedes the account's active exact release and fences its generation", async () => {
    const registry = deterministicRegistry();
    const first = expectActivation(await registry.activate(request("request-1")));
    const second = expectActivation(await registry.activate(request("request-2", {
      release: { ...release, version: "0.2.0", contentDigest: "b".repeat(64) },
    })));

    expect(first.generation).toBe(1);
    expect(first).not.toHaveProperty("accountId");
    expect(first.surfaces.flatMap((surface) => surface.playerSlots)).toEqual([0, 1, 2]);
    expect(second).toMatchObject({
      generation: 2,
      supersededGameSessionId: first.gameSessionId,
      release: { version: "0.2.0", contentDigest: "b".repeat(64) },
    });

    const staleAdmission = await registry.admit({
      ...first.surfaces[0]!,
      gameSessionId: first.gameSessionId,
      generation: first.generation,
      roomInstanceId: "room-old",
      release: first.release,
    });
    expect(staleAdmission).toMatchObject({
      ok: false,
      conflict: { code: "SESSION_NOT_ACTIVE" },
    });
    await expect(registry.finish({
      gameSessionId: first.gameSessionId,
      generation: first.generation,
      roomInstanceId: "room-old",
      reason: "room-failed",
    })).resolves.toMatchObject({
      ok: false,
      conflict: { code: "SESSION_SUPERSEDED" },
    });
  });

  it("replays an identical active request but rejects reuse with another payload or after finish", async () => {
    const registry = deterministicRegistry();
    const originalResult = await registry.activate(request("stable-request"));
    const original = expectActivation(originalResult);
    const replay = await registry.activate(request("stable-request", {
      surfaces: [...surfaces].reverse(),
    }));

    expect(replay).toEqual({ ok: true, replayed: true, activation: original });
    await expect(registry.activate(request("stable-request", {
      release: { ...release, contentDigest: "c".repeat(64) },
    }))).resolves.toMatchObject({
      ok: false,
      conflict: { code: "REQUEST_ID_REUSED" },
    });

    const originalGrant = original.surfaces[0]!;
    await registry.admit({
      ...originalGrant,
      gameSessionId: original.gameSessionId,
      generation: original.generation,
      roomInstanceId: "room-original",
      release: original.release,
    });
    await expect(registry.finish({
      gameSessionId: original.gameSessionId,
      generation: original.generation,
      roomInstanceId: "room-original",
      reason: "completed",
    })).resolves.toEqual({ ok: true, status: "finished" });
    await expect(registry.activate(request("stable-request"))).resolves.toMatchObject({
      ok: false,
      conflict: { code: "REQUEST_NO_LONGER_ACTIVE" },
    });
  });

  it("admits each exact surface grant once and rejects altered capability scope", async () => {
    const registry = deterministicRegistry();
    const activation = expectActivation(await registry.activate(request("admission-request")));
    const grant = activation.surfaces[1]!;
    const admission = {
      ...grant,
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId: "room-admission",
      release: activation.release,
    };

    await expect(registry.admit({ ...admission, generation: 99 })).resolves.toMatchObject({
      ok: false,
      conflict: { code: "GENERATION_MISMATCH" },
    });
    await expect(registry.admit({
      ...admission,
      release: { ...activation.release, contentDigest: "d".repeat(64) },
    })).resolves.toMatchObject({
      ok: false,
      conflict: { code: "RELEASE_SCOPE_MISMATCH" },
    });
    await expect(registry.admit({ ...admission, playerSlots: [1] })).resolves.toMatchObject({
      ok: false,
      conflict: { code: "SURFACE_SCOPE_MISMATCH" },
    });

    await expect(registry.admit(admission)).resolves.toEqual({
      ok: true,
      admission: {
        gameSessionId: activation.gameSessionId,
        generation: activation.generation,
        surfaceId: grant.surfaceId,
        role: grant.role,
        playerSlots: grant.playerSlots,
      },
    });
    await expect(registry.admit(admission)).resolves.toMatchObject({
      ok: false,
      conflict: { code: "CAPABILITY_REPLAYED" },
    });
  });

  it("finishes idempotently without allowing a stale generation to mutate the active session", async () => {
    const registry = deterministicRegistry();
    const activation = expectActivation(await registry.activate(request("finish-request")));
    await registry.admit({
      ...activation.surfaces[0]!,
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId: "room-finish",
      release: activation.release,
    });
    const finish = {
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId: "room-finish",
      reason: "abandoned" as const,
    };

    await expect(registry.finish({ ...finish, generation: 9 })).resolves.toMatchObject({
      ok: false,
      conflict: { code: "GENERATION_MISMATCH" },
    });
    await expect(registry.finish(finish)).resolves.toEqual({ ok: true, status: "finished" });
    await expect(registry.finish(finish)).resolves.toEqual({ ok: true, status: "already-finished" });
  });

  it("returns a typed conflict for overlapping or malformed PlayerSlot leases", async () => {
    const registry = deterministicRegistry();

    await expect(registry.activate(request("invalid-request", {
      surfaces: [
        { surfaceId: "upper", role: "main", playerSlots: [0] },
        { surfaceId: "lower", role: "companion", playerSlots: [0, 1] },
      ],
    }))).resolves.toMatchObject({
      ok: false,
      conflict: { code: "INVALID_ACTIVATION" },
    });
  });

  it("binds all surfaces and lifecycle operations to the first Colyseus room", async () => {
    const registry = deterministicRegistry();
    const activation = expectActivation(await registry.activate(request("room-fence-request")));
    const first = activation.surfaces[0]!;
    const second = activation.surfaces[1]!;
    const admission = (grant: typeof first, roomInstanceId: string) => ({
      ...grant,
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId,
      release: activation.release,
    });

    await expect(registry.admit(admission(first, "room-a"))).resolves.toMatchObject({ ok: true });
    await expect(registry.admit(admission(second, "room-b"))).resolves.toMatchObject({
      ok: false,
      conflict: { code: "ROOM_FENCE_MISMATCH" },
    });
    await expect(registry.admit(admission(second, "room-a"))).resolves.toMatchObject({ ok: true });
    await expect(registry.isActive({
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId: "room-a",
    })).resolves.toBe(true);
    await expect(registry.isActive({
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId: "room-b",
    })).resolves.toBe(false);
    await expect(registry.finish({
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId: "room-b",
      reason: "abandoned",
    })).resolves.toMatchObject({
      ok: false,
      conflict: { code: "ROOM_FENCE_MISMATCH" },
    });
  });
});
