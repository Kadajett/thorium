import assert from "node:assert/strict";
import test from "node:test";
import { connectAuthoritativeSession } from "./colyseus.js";
import { HostClient } from "./host.js";
import { createMemoryTransport } from "./memory-transport.js";
import { testDevice } from "./test-fixtures.js";
import { scopedBootstrap, scopedHost, recordingClient } from "./capability-fixtures.js";
await test("HostClient privately captures short-lived Colyseus tickets claimable once", () => {
  const bootstrap = scopedBootstrap("single-use");
  const unsafeBootstrap = { ...bootstrap, accountToken: "account-secret-must-not-survive" };
  const host = new HostClient(unsafeBootstrap, createMemoryTransport(bootstrap).transport);
  const visible = JSON.stringify(host.bootstrap);
  assert.equal("colyseus" in host.bootstrap, false);
  assert.equal(visible.includes("single-use"), false);
  assert.equal(visible.includes("account-secret-must-not-survive"), false);
  assert.equal(JSON.stringify(host).includes("single-use"), false);
  assert.equal(host.takeColyseusTicket()?.ticket, "single-use");
  assert.throws(() => host.takeColyseusTicket(), /already been claimed/);
});
await test("authoritative connection maps and erases the surface ticket", async () => {
  const fixture = scopedHost("surface-only"),
    client = recordingClient();
  const connected = await connectAuthoritativeSession(fixture.host, client.factory);
  assert.equal(connected, client.room);
  assert.equal(connected.reconnection.minUptime, 0);
  assert.deepEqual(client.seen, [
    {
      endpoint: "wss://games.yougotserved.dev",
      roomName: "game_session",
      options: fixture.bootstrap.colyseus?.joinOptions,
      token: "surface-only",
    },
  ]);
  assert.equal(client.auth.token, undefined);
  await assert.rejects(
    connectAuthoritativeSession(fixture.host, () => assert.fail("must not create twice")),
    /already been claimed/,
  );
});
await test("authoritative connection is offline-safe and consumes expired access without networking", async () => {
  const device = testDevice();
  const never = () => assert.fail("offline or expired access must not construct a client");
  assert.equal(await connectAuthoritativeSession(device.main, never), undefined);
  const expired = scopedHost("expired", Date.now() - 1);
  await assert.rejects(connectAuthoritativeSession(expired.host, never), /expired/);
  await assert.rejects(connectAuthoritativeSession(expired.host, never), /already been claimed/);
});
await test("failed joins erase the one-use token from the injected client", async () => {
  const fixture = scopedHost("surface-only"),
    auth: { token: string | undefined } = { token: undefined };
  await assert.rejects(
    connectAuthoritativeSession(fixture.host, () => ({
      auth,
      joinOrCreate: () => Promise.reject(new Error("join failed")),
    })),
    /join failed/,
  );
  assert.equal(auth.token, undefined);
  assert.throws(() => fixture.host.takeColyseusTicket(), /already been claimed/);
});
