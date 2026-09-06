import { createTestDevice, twoPlayersOneAccount } from "./testing.js";
import { HostClient } from "./host.js";
import { createMemoryTransport } from "./memory-transport.js";
import type { GameBootstrap } from "./types.js";
export const validManifest = {
  schema: 1,
  packageId: "dev.yougotserved.test-game",
  version: "1.0.0",
  displayName: "Test Game",
  summary: "A test game.",
  description: "A complete manifest used by the public-interface tests.",
  runtime: {
    kind: "web-v1",
    sdkCompatibility: "^0.1.0",
    entrypoints: {
      main: { path: "main/index.html", purpose: "primary-gameplay" },
      companion: { path: "companion/index.html", purpose: "companion-controls" },
    },
    files: ["game.js", "main/index.html", "companion/index.html"],
  },
  displays: {
    requiredSurfaces: ["main", "companion"],
    supportsSingleSurfaceFallback: false,
    main: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
    companion: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
  },
  players: { minSlots: 1, maxSlots: 4, maxLocalSlots: 2, sameAccountMultipleSlots: true },
  multiplayer: {
    online: true,
    roomName: "game_session",
    protocol: "thorium-game-channel-v1",
  },
  controls: [{ id: "tap", label: "Tap", kind: "button" }],
  capabilities: ["same-device-peer", "colyseus-session"],
  budgets: { maxPackageBytes: 1_048_576, maxFileCount: 8, maxLocalPeerMessageBytes: 4096 },
} as const;
export function testDevice() {
  return createTestDevice({
    gameId: validManifest.packageId,
    accountSessions: twoPlayersOneAccount,
    controls: validManifest.controls,
  });
}
export function testHost(bootstrap: GameBootstrap) {
  const memory = createMemoryTransport(bootstrap);
  return { host: new HostClient(bootstrap, memory.transport), deliver: memory.deliver };
}
