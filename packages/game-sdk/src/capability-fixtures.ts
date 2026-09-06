import type { GameBootstrap, ColyseusSessionTicket } from "./types.js";
import { testDevice, testHost } from "./test-fixtures.js";
export function scopedBootstrap(
  ticket: string,
  expiresAtEpochMs = Date.now() + 60_000,
): GameBootstrap {
  const base = testDevice().main.bootstrap;
  return {
    ...base,
    colyseus: {
      endpoint: "wss://games.yougotserved.dev",
      roomName: "game_session",
      ticket,
      expiresAtEpochMs,
      joinOptions: {
        gameSessionId: base.game.instanceId,
        packageId: base.game.id,
        packageVersion: base.game.version,
        packageDigest: "a".repeat(64),
      },
    },
  };
}
export function scopedHost(ticket: string, expiresAtEpochMs?: number) {
  const bootstrap = scopedBootstrap(ticket, expiresAtEpochMs);
  return { bootstrap, ...testHost(bootstrap) };
}
export function recordingClient() {
  const room = { id: "room", reconnection: { minUptime: 5_000 } };
  const auth: { token: string | undefined } = { token: undefined };
  const seen: unknown[] = [];
  const factory = (endpoint: string) => ({
    auth,
    joinOrCreate: (roomName: string, options: ColyseusSessionTicket["joinOptions"]) => {
      seen.push({ endpoint, roomName, options, token: auth.token });
      return Promise.resolve(room);
    },
  });
  return { room, auth, seen, factory };
}
