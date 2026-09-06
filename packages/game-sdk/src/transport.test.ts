import assert from "node:assert/strict";
import test from "node:test";
import { BrowserHostTransport, HostClient } from "./host.js";
import { testDevice } from "./test-fixtures.js";
import { scopedBootstrap } from "./capability-fixtures.js";
import { bootstrapWindow } from "./transport-fixtures.js";
import type { GameBootstrap, ColyseusSessionTicket } from "./types.js";
await test("browser transport requests bootstrap through postMessage and matches the response", async () => {
  const fixture = bootstrapWindow(testDevice().main.bootstrap, true);
  const transport = new BrowserHostTransport(fixture.bridge, 100);
  const bootstrap = await transport.readBootstrap();
  assert.equal(bootstrap.game.id, "dev.yougotserved.test-game");
  assert.equal(fixture.sent.length, 1);
  assert.match(fixture.sent[0] ?? "", /"kind":"bootstrap-request"/);
  assert.equal(JSON.stringify(fixture.sent).includes("single-use"), false);
});
await test("both native surface bootstraps accept generated shared-host room names", async () => {
  const device = testDevice(),
    roomName = `g_${"a".repeat(32)}`;
  const capability = scopedBootstrap("synthetic-one-use-ticket").colyseus;
  assert.ok(capability !== undefined);
  for (const surface of [device.main, device.companion]) {
    await assertRoomBootstrap(surface.bootstrap, { ...capability, roomName });
  }
});
async function assertRoomBootstrap(
  original: GameBootstrap,
  capability: ColyseusSessionTicket,
): Promise<void> {
  const bootstrap = { ...original, colyseus: capability };
  const transport = bootstrapTransport(bootstrap);
  const host = new HostClient(await transport.readBootstrap(), transport);
  assert.equal(host.bootstrap.surface, original.surface);
  assert.equal(host.takeColyseusTicket()?.roomName, capability.roomName);
  rejectInvalidRoomNames(bootstrap, transport);
}
function rejectInvalidRoomNames(bootstrap: GameBootstrap, transport: BrowserHostTransport): void {
  const capability = bootstrap.colyseus;
  assert.ok(capability !== undefined);
  for (const roomName of ["", "Room", "../room", "g_" + "a".repeat(63)])
    assert.throws(
      () => new HostClient({ ...bootstrap, colyseus: { ...capability, roomName } }, transport),
      /invalid Colyseus session capability/,
    );
}
function bootstrapTransport(bootstrap: GameBootstrap): BrowserHostTransport {
  return new BrowserHostTransport(bootstrapWindow(bootstrap).bridge, 100);
}
