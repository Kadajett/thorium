import {
  playerSlot,
  type GameBootstrap,
  type Player,
  type PlayerSlot,
  type SurfaceRole,
} from "../types.js";
import type { AccountSessionFixture } from "../testing.js";
export type TestDeviceOptions = Readonly<{
  gameId: string;
  accountSessions: readonly AccountSessionFixture[];
  controls: GameBootstrap["controls"];
}>;
function playersOf(options: TestDeviceOptions): readonly Player[] {
  const slots: readonly PlayerSlot[] = options.accountSessions.flatMap(
    (account) => account.playerSlots,
  );
  if (new Set(slots).size !== slots.length) throw new Error("Each PlayerSlot must have one owner");
  return slots.map((slot): Player => ({
    slot,
    displayName: `Player ${String(slot + 1)}`,
    local: true,
  }));
}
export function testBootstrap(options: TestDeviceOptions, surface: SurfaceRole): GameBootstrap {
  const players = playersOf(options),
    slot = playerSlot(surface === "main" ? 0 : 1);
  return {
    protocolVersion: 1,
    surface,
    game: { id: options.gameId, version: "0.0.0-test", instanceId: "test-instance" },
    players,
    controls: options.controls,
    render: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 1 },
    limits: { maxLocalPeerMessageBytes: 4096 },
    controlledPlayerSlots: players.some((player) => player.slot === slot) ? [slot] : [],
  };
}
