import assert from "node:assert/strict";
import test from "node:test";
import { playerSlot } from "./types.js";
import { testDevice } from "./test-fixtures.js";
import type { ControlEvent } from "./types.js";
await test("routes controls and peer messages between surfaces while keeping account identity host-only", () => {
  const device = testDevice(),
    controls: string[] = [],
    peers: string[] = [];
  device.main.onControl((event) => {
    controls.push(`${String(event.player)}:${event.control}`);
  });
  device.main.onPeer("score", (event) => {
    peers.push(JSON.stringify(event.payload));
  });
  const control = { control: "tap", player: playerSlot(1), phase: "pressed", value: 1 } as const;
  device.companion.emitControl(control);
  device.companion.sendToPeer("score", { player: 1, score: 2 });
  device.companion.flushPeerMessages();
  assertWrongSeat(device, control);
  assert.deepEqual(controls, ["1:tap"]);
  assert.deepEqual(peers, ['{"player":1,"score":2}']);
  assertIdentityBoundary(device);
});
function assertWrongSeat(
  device: ReturnType<typeof testDevice>,
  control: Omit<ControlEvent, "sequence">,
): void {
  assert.throws(() => {
    device.main.emitControl(control);
  }, /not controlled by this surface/);
  assert.throws(() => {
    device.companion.emitControl({ ...control, player: playerSlot(0) });
  }, /not controlled by this surface/);
}
function assertIdentityBoundary(device: ReturnType<typeof testDevice>): void {
  assert.equal(JSON.stringify(device.main.bootstrap).includes("account-session:test-only"), false);
  assert.deepEqual(device.accountSessions[0]?.playerSlots, [playerSlot(0), playerSlot(1)]);
}
