import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserHostTransport, type BrowserBridgeWindow } from "./browser-transport.js";
import { assertBootstrap, createHostClient, createHostClientFromBootstrap } from "./host.js";
import { createTestDevice, twoPlayersOneAccount } from "./testing.js";
import {
  playerSlot,
  type GameBootstrap,
  type HostOutboundMessage,
  type HostTransport,
} from "./types.js";

function bootstrap(): GameBootstrap {
  return createTestDevice({
    gameId: "dev.test.functional-host",
    accountSessions: twoPlayersOneAccount,
    controls: [{ id: "confirm", label: "Confirm", kind: "button" }],
  }).main.bootstrap;
}

function memoryBridge() {
  const sent: string[] = [];
  const bridge: BrowserBridgeWindow = {
    thoriumHost: {
      postMessage: (message) => {
        sent.push(message);
      },
    },
    addEventListener: () => undefined,
  };
  return { bridge, sent, transport: createBrowserHostTransport(bridge, 100) };
}

await test("factory bridge parses native bootstrap and preserves controlled semantic input", async () => {
  const memory = memoryBridge();
  const client = createHostClient(memory.transport);
  assert.equal(memory.sent[0], '{"kind":"bootstrap-request","requestId":"bootstrap-1"}');
  memory.bridge.__thoriumReceive?.(
    JSON.stringify({ kind: "bootstrap", requestId: "bootstrap-1", bootstrap: bootstrap() }),
  );
  const host = await client;
  host.emitControl({ control: "confirm", player: playerSlot(0), phase: "pressed", value: 1 });
  assert.match(memory.sent[1] ?? "", /"sequence":0/);
  assert.throws(() => {
    host.emitControl({ control: "confirm", player: playerSlot(1), phase: "pressed", value: 1 });
  }, /not controlled/);
  assert.throws(
    () =>
      memory.bridge.__thoriumReceive?.(
        '{"kind":"control","event":{"control":"confirm","player":0,"phase":"pressed","value":1,"sequence":-1}}',
      ),
    /Invalid semantic/,
  );
});

await test("host factory snapshots public metadata and consumes expired tickets once", () => {
  const source = bootstrap();
  const scoped: GameBootstrap = {
    ...source,
    colyseus: {
      endpoint: "wss://games.example.test",
      roomName: "g_candidate",
      ticket: "private-once",
      expiresAtEpochMs: 1,
      joinOptions: {
        gameSessionId: source.game.instanceId,
        packageId: source.game.id,
        packageVersion: source.game.version,
        packageDigest: "a".repeat(64),
      },
    },
  };
  const transport: HostTransport = {
    readBootstrap: () => Promise.resolve(scoped),
    send: () => undefined,
    subscribe: () => () => undefined,
  };
  const host = createHostClientFromBootstrap(scoped, transport);
  assert.equal(JSON.stringify(host).includes("private-once"), false);
  assert.equal(Object.isFrozen(host.bootstrap.players), true);
  assert.throws(() => host.takeColyseusTicket(), /expired/);
  assert.throws(() => host.takeColyseusTicket(), /already been claimed/);
});

await test("peer queue drains before transport callbacks can enqueue the next frame", () => {
  const source = bootstrap();
  const sent: HostOutboundMessage[] = [];
  const transport: HostTransport = {
    readBootstrap: () => Promise.resolve(source),
    subscribe: () => () => undefined,
    send(message) {
      sent.push(message);
      if (sent.length === 1) host.sendToPeer("state", 2);
    },
  };
  const host = createHostClientFromBootstrap(source, transport);
  host.sendToPeer("state", 1);
  host.flushPeerMessages();
  assert.equal(sent.length, 1);
  host.flushPeerMessages();
  assert.equal(sent.length, 2);
  host.flushPeerMessages();
  assert.equal(sent.length, 2);
});

await test("public bootstrap validation rejects malformed nested input without shape assertions", () => {
  assert.throws(() => {
    assertBootstrap({ ...bootstrap(), players: [null] });
  }, /Player Slot/);
  assert.throws(() => {
    assertBootstrap({ ...bootstrap(), controls: [{ id: 7, kind: "button", label: "Confirm" }] });
  }, /semantic control/);
  assert.throws(() => {
    assertBootstrap({ ...bootstrap(), render: { logicalWidth: "960" } });
  }, /render size/);
});

function mutableMetadataFixture() {
  const source = bootstrap();
  const game = { ...source.game };
  const players = [{ slot: playerSlot(0), displayName: "Original", local: true }];
  const controls = [{ id: "confirm", label: "Original", kind: "button" as const }];
  const input: GameBootstrap = { ...source, game, players, controls };
  const transport: HostTransport = {
    readBootstrap: () => Promise.resolve(input),
    send: () => undefined,
    subscribe: () => () => undefined,
  };
  const host = createHostClientFromBootstrap(input, transport);
  return { source, game, players, controls, host };
}

await test("factory snapshots do not share author-owned mutable metadata", () => {
  const { source, game, players, controls, host } = mutableMetadataFixture();
  game.id = "changed.external.game";
  players.splice(0, 1, { slot: playerSlot(0), displayName: "Changed", local: true });
  controls.splice(0, 1, { id: "confirm", label: "Changed", kind: "button" });
  assert.equal(host.bootstrap.game.id, source.game.id);
  assert.equal(host.bootstrap.players[0]?.displayName, "Original");
  assert.equal(host.bootstrap.controls[0]?.label, "Original");
  assert.equal(Object.isFrozen(host.bootstrap.players[0]), true);
  assert.equal(Object.isFrozen(host.bootstrap.controls[0]), true);
});
