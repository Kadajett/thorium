import { afterEach, expect, it } from "vitest";
import {
  cleanupRegistryFixtures,
  oversizedRegistryStream,
  registryAdmission,
  registryFence,
  registryFixture,
  registryJsonBytes,
  registryRelease,
} from "./registry-client-fixture.js";

afterEach(cleanupRegistryFixtures);

it("admits an exact release without exposing account scope or ticket expiry", async () => {
  const { client, requests } = await registryFixture(() => Response.json({ ok: true, extra: 1 }));
  const fence = await client.scoped(registryRelease).admit(registryAdmission, "room-1");
  expect(fence).toEqual(registryFence);
  const request = requests[0];
  expect(request?.url).toBe("https://platform.invalid/v1/game-host/admit");
  expect(await request?.json()).toEqual({
    ...registryFence,
    capabilityId: "capability-1",
    surfaceId: "main",
    role: "main",
    playerSlots: [0],
  });
});

it("rejects every cross-release operation before HTTP", async () => {
  const { client, requests } = await registryFixture(() => Response.json({ ok: true }));
  const port = client.scoped(registryRelease);
  const release = { ...registryRelease, contentDigest: "b".repeat(64) };
  await expect(port.admit({ ...registryAdmission, release }, "room-1")).rejects.toThrow(
    "registry_release_mismatch",
  );
  await expect(port.isActive({ ...registryFence, release })).rejects.toThrow(
    "registry_release_mismatch",
  );
  await expect(port.finish({ ...registryFence, release }, "completed")).rejects.toThrow(
    "registry_release_mismatch",
  );
  expect(requests).toHaveLength(0);
});

it("captures release scope independently of a caller's later mutations", async () => {
  const { client } = await registryFixture(() => Response.json({ active: true }));
  const release = { ...registryRelease };
  const port = client.scoped(release);
  release.version = "9.0.0";
  await expect(port.isActive(registryFence)).resolves.toBe(true);
});

it("cancels an oversized response as soon as its streaming byte budget is exceeded", async () => {
  const stream = oversizedRegistryStream();
  const { client } = await registryFixture(() => stream.response);
  await expect(client.scoped(registryRelease).isActive(registryFence)).rejects.toThrow(
    "platform_registry_response_too_large",
  );
  expect(stream.cancelled()).toBe(true);
  expect(stream.pulls()).toBe(3);
});

it.each([false, null, { active: "true" }, { active: true, extra: 1 }])(
  "rejects malformed fence response %j",
  async (body) => {
    const { client } = await registryFixture(() => Response.json(body));
    await expect(client.scoped(registryRelease).isActive(registryFence)).rejects.toThrow();
  },
);

it("rejects HTTP failure without accepting a success-looking payload", async () => {
  const { client } = await registryFixture(() => Response.json({ ok: true }, { status: 403 }));
  await expect(client.scoped(registryRelease).finish(registryFence, "completed")).rejects.toThrow(
    "platform_registry_finish_rejected:403",
  );
});

it("accepts the exact byte budget and rejects the first excess byte", async () => {
  const exact = await registryFixture(() => registryJsonBytes(16384));
  const excess = await registryFixture(() => registryJsonBytes(16385));
  await expect(
    exact.client.scoped(registryRelease).finish(registryFence, "completed"),
  ).resolves.toBeUndefined();
  await expect(
    excess.client.scoped(registryRelease).finish(registryFence, "completed"),
  ).rejects.toThrow("platform_registry_response_too_large");
});

it("uses authenticated POST without following redirects and respects inactive fences", async () => {
  const { client, requests } = await registryFixture(() => Response.json({ active: false }));
  await expect(client.scoped(registryRelease).isActive(registryFence)).resolves.toBe(false);
  const request = requests[0];
  expect(request?.method).toBe("POST");
  expect(request?.redirect).toBe("error");
  expect(request?.headers.get("authorization")).toBe(`Bearer ${"test-registry-token-".repeat(3)}`);
  expect(request?.headers.get("content-type")).toBe("application/json");
  expect(request?.signal.aborted).toBe(false);
});

it.each(["short", "x".repeat(4097), "x".repeat(32) + " internal-space"])(
  "rejects invalid service-token shape without HTTP",
  async (token) => {
    await expect(registryFixture(() => Response.json({ ok: true }), token)).rejects.toThrow(
      "invalid_game_host_service_token",
    );
  },
);
