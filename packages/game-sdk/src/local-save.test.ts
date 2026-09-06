import assert from "node:assert/strict";
import test from "node:test";
import { createLocalSaveClient, type LocalSaveEnvironment } from "./local-save.js";
import { createHostClientFromBootstrap } from "./host.js";
import { testBootstrap } from "./core/test-bootstrap.js";
import { parseMessage } from "./core/bridge-message.js";
import { parseBootstrap } from "./core/bootstrap.js";
import { localSaveLimits } from "./core/local-save-value.js";
import type { HostInboundMessage, HostOutboundMessage, HostTransport } from "./types.js";
function bridge() {
  const sent: HostOutboundMessage[] = [];
  const listeners = new Set<(message: HostInboundMessage) => void>();
  const bootstrap = testBootstrap(
    { gameId: "dev.test.save", accountSessions: [], controls: [] },
    "main",
  );
  const transport: HostTransport = {
    readBootstrap: () => Promise.resolve(bootstrap),
    send(message) {
      sent.push(message);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    bootstrap,
    transport,
    sent,
    ...saveClock(),
    deliver(message: HostInboundMessage) {
      for (const listener of listeners) listener(message);
    },
  };
}
function saveClock() {
  const timers = new Map<string, () => void>();
  let sequence = 0;
  const environment: LocalSaveEnvironment = {
    id: () => `save-${String(++sequence)}`,
    schedule(callback) {
      const key = String(sequence);
      timers.set(key, callback);
      return () => {
        timers.delete(key);
      };
    },
  };
  return { timers, environment };
}
await test("new SDK on old host has no granted port and unsupported calls send no messages", async () => {
  const fixture = bridge(),
    host = createHostClientFromBootstrap(fixture.bootstrap, fixture.transport);
  assert.equal(host.localSave, undefined);
  const save = createLocalSaveClient(fixture.transport);
  await assert.rejects(save.read("run"), { code: "unsupported" });
  assert.deepEqual(fixture.sent, []);
});
await test("opted-in bootstrap grants a frozen save capability without changing protocol one", () => {
  const fixture = bridge();
  const host = createHostClientFromBootstrap(
    { ...fixture.bootstrap, localSave: localSaveLimits },
    fixture.transport,
  );
  assert.ok(host.localSave !== undefined);
  assert.equal(host.bootstrap.protocolVersion, 1);
  assert.equal(Object.isFrozen(host.bootstrap.localSave), true);
  assert.throws(() =>
    parseBootstrap({ ...fixture.bootstrap, localSave: { ...localSaveLimits, protocolVersion: 2 } }),
  );
});
await test("request interface never contains a package identity and validates response correlation", async () => {
  const fixture = bridge(),
    save = createLocalSaveClient(fixture.transport, localSaveLimits, fixture.environment);
  const pending = save.write("run", { level: 1 }, null);
  assert.deepEqual(fixture.sent, [
    {
      kind: "local-save-request",
      protocolVersion: 1,
      requestId: "save-1",
      operation: "write",
      key: "run",
      valueJson: '{"level":1}',
      expectedRevision: null,
    },
  ]);
  fixture.deliver({
    kind: "local-save-result",
    protocolVersion: 1,
    requestId: "save-1",
    status: "ok",
    result: { operation: "write", revision: 7 },
  });
  assert.equal(await pending, 7);
  assert.equal(fixture.timers.size, 0);
});
await test("response operations cannot be confused and extra namespace fields are rejected", async () => {
  const fixture = bridge(),
    save = createLocalSaveClient(fixture.transport, localSaveLimits, fixture.environment);
  const pending = save.read("run");
  fixture.deliver({
    kind: "local-save-result",
    protocolVersion: 1,
    requestId: "save-1",
    status: "ok",
    result: { operation: "remove" },
  });
  await assert.rejects(pending, { code: "invalid_request" });
  assert.throws(() =>
    parseMessage({
      kind: "local-save-result",
      protocolVersion: 1,
      requestId: "save-1",
      status: "ok",
      result: { operation: "read", entry: null },
      packageId: "dev.other",
    }),
  );
});
await test("outstanding requests are bounded, time out, and teardown rejects pending work", async () => {
  const fixture = bridge(),
    save = createLocalSaveClient(fixture.transport, localSaveLimits, fixture.environment);
  const pending = Array.from({ length: 4 }, () => save.read("run"));
  const outcomes = Promise.allSettled(pending);
  await assert.rejects(save.read("run"), { code: "busy" });
  fixture.timers.get("1")?.();
  fixture.deliver({ kind: "lifecycle", state: "stopped" });
  const settled = await outcomes;
  assert.equal(settled.filter((result) => result.status === "rejected").length, 4);
  assert.equal(fixture.timers.size, 0);
  await assert.rejects(save.read("run"), { code: "closed" });
});
await test("oversize and malformed persisted JSON responses fail closed", () => {
  const base = { kind: "local-save-result", protocolVersion: 1, requestId: "save-1", status: "ok" };
  for (const valueJson of [
    "undefined",
    "[".repeat(40) + "0" + "]".repeat(40),
    '"' + "x".repeat(131072) + '"',
  ]) {
    assert.throws(() =>
      parseMessage({ ...base, result: { operation: "read", entry: { revision: 1, valueJson } } }),
    );
  }
});
