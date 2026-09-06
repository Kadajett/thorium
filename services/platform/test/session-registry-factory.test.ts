import { expect, it } from "vitest";
import { createInMemoryGameSessionRegistry } from "../src/adapters/in-memory-game-session-registry.js";
import type {
  ActivateGameSession,
  GameSessionActivation,
  GameSessionRegistry,
} from "../src/session-registry/game-session-registry.js";

const request: ActivateGameSession = {
  requestId: "first",
  accountId: "account",
  release: { packageId: "dev.thorium.test", version: "0.1.0", contentDigest: "a".repeat(64) },
  surfaces: [{ surfaceId: "main", role: "main", playerSlots: [0] }],
};

function source() {
  let sequence = 0;
  return () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
}

async function activate(registry: GameSessionRegistry): Promise<GameSessionActivation> {
  const result = await registry.activate(request);
  if (!result.ok) throw new Error(result.conflict.code);
  return result.activation;
}

function admission(activation: GameSessionActivation) {
  const grant = activation.surfaces[0];
  if (grant === undefined) throw new Error("Fixture has no grant");
  return {
    ...grant,
    gameSessionId: activation.gameSessionId,
    generation: activation.generation,
    roomInstanceId: "room",
    release: activation.release,
  };
}

it("factory activation supersedes before returning its promise", async () => {
  const registry = createInMemoryGameSessionRegistry({ newId: source() });
  const first = await activate(registry);
  const replacement = registry.activate({ ...request, requestId: "second" });
  const stale = registry.admit(admission(first));
  await expect(stale).resolves.toMatchObject({
    ok: false,
    conflict: { code: "SESSION_NOT_ACTIVE" },
  });
  await expect(replacement).resolves.toMatchObject({ ok: true, activation: { generation: 2 } });
});

it("ID-source failure cannot partially supersede an active session", async () => {
  const generate = source();
  let broken = false;
  const newId = () => {
    if (broken) throw new Error("ID source unavailable");
    return generate();
  };
  const registry = createInMemoryGameSessionRegistry({ newId });
  const first = await activate(registry);
  broken = true;
  await expect(registry.activate({ ...request, requestId: "second" })).rejects.toThrow(
    "ID source unavailable",
  );
  await expect(registry.admit(admission(first))).resolves.toMatchObject({ ok: true });
});

it("public results cannot mutate the internally retained activation", async () => {
  const registry = createInMemoryGameSessionRegistry({ newId: source() });
  const first = await activate(registry);
  const original = structuredClone(first);
  Object.assign(first.release, { version: "99.0.0" });
  const grant = first.surfaces[0];
  if (grant === undefined) throw new Error("Fixture has no grant");
  Object.assign(grant.playerSlots, { 0: 15 });
  expect(await activate(registry)).toEqual(original);
});

it("idempotent replay does not request new identifiers", async () => {
  const generate = source();
  let calls = 0;
  const registry = createInMemoryGameSessionRegistry({
    newId: () => {
      calls += 1;
      return generate();
    },
  });
  const first = await activate(registry);
  const beforeReplay = calls;
  expect(await activate(registry)).toEqual(first);
  expect(calls).toBe(beforeReplay);
});
