import type { WebGameManifest } from "../manifest.js";
import {
  playerSlot,
  type GameBootstrap,
  type Player,
  type PlayerSlot,
  type SurfaceRole,
} from "../types.js";
export type PreviewBootstraps = Readonly<Record<SurfaceRole, GameBootstrap>>;
function playersOf(manifest: WebGameManifest): readonly Player[] {
  const plan = manifest.players.defaultLocalSeatPlan;
  const slots: readonly number[] =
    plan === undefined
      ? Array.from({ length: Math.min(4, manifest.players.maxLocalSlots) }, (_, index) => index)
      : [...plan.main, ...plan.companion];
  return slots.map((slot): Player => ({
    slot: playerSlot(slot),
    displayName: `Player ${String(slot + 1)}`,
    local: true,
  }));
}
function seats(
  manifest: WebGameManifest,
  role: SurfaceRole,
  players: readonly Player[],
): readonly PlayerSlot[] {
  const plan = manifest.players.defaultLocalSeatPlan;
  if (plan !== undefined) return plan[role].map(playerSlot);
  const player = players[role === "main" ? 0 : 1];
  return player === undefined ? [] : [player.slot];
}
function bootstrap(
  manifest: WebGameManifest,
  players: readonly Player[],
  role: SurfaceRole,
): GameBootstrap {
  return {
    protocolVersion: 1,
    surface: role,
    game: {
      id: manifest.packageId,
      version: manifest.version,
      instanceId: "local-browser-preview",
    },
    players,
    controls: manifest.controls,
    limits: { maxLocalPeerMessageBytes: manifest.budgets.maxLocalPeerMessageBytes },
    controlledPlayerSlots: seats(manifest, role, players),
    render: manifest.displays[role],
  };
}
export function previewBootstraps(manifest: WebGameManifest): PreviewBootstraps {
  const players = playersOf(manifest);
  return {
    main: bootstrap(manifest, players, "main"),
    companion: bootstrap(manifest, players, "companion"),
  };
}
