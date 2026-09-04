import { Client, type Room } from "@colyseus/sdk";
import type { ColyseusSessionTicket, GameHost } from "./types.js";

export interface AuthoritativeSessionClient<TRoom = Room> {
  readonly auth: { token: string | undefined };
  joinOrCreate(
    roomName: "game_session",
    options: ColyseusSessionTicket["joinOptions"],
  ): Promise<TRoom>;
}

export type AuthoritativeSessionClientFactory<TRoom = Room> = (
  endpoint: string,
) => AuthoritativeSessionClient<TRoom>;

type RoomReconnectionPolicy = Pick<Room["reconnection"], "minUptime">;

function enableImmediateReconnection(room: unknown): void {
  if (typeof room !== "object" || room === null || !("reconnection" in room)) return;
  const reconnection = room.reconnection;
  if (
    typeof reconnection === "object" &&
    reconnection !== null &&
    "minUptime" in reconnection &&
    typeof reconnection.minUptime === "number"
  ) {
    (reconnection as RoomReconnectionPolicy).minUptime = 0;
  }
}

/**
 * Claims this surface's one-use capability and joins its authoritative room.
 * Local/offline sessions have no ticket and resolve to `undefined`.
 */
export async function connectAuthoritativeSession<TRoom = Room>(
  host: Pick<GameHost, "takeColyseusTicket">,
  clientFactory: AuthoritativeSessionClientFactory<TRoom> = ((endpoint: string) =>
    new Client(endpoint)) as unknown as AuthoritativeSessionClientFactory<TRoom>,
): Promise<TRoom | undefined> {
  const access = host.takeColyseusTicket();
  if (!access) return undefined;

  const client = clientFactory(access.endpoint);
  client.auth.token = access.ticket;
  try {
    const room = await client.joinOrCreate(access.roomName, access.joinOptions);
    enableImmediateReconnection(room);
    return room;
  } finally {
    client.auth.token = undefined;
  }
}
