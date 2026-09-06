import { Client, type Room } from "@colyseus/sdk";
import type { ColyseusSessionTicket, GameHost } from "./types.js";
export interface AuthoritativeSessionClient<TRoom = Room> {
  readonly auth: { token: string | undefined };
  joinOrCreate(roomName: string, options: ColyseusSessionTicket["joinOptions"]): Promise<TRoom>;
}
export type AuthoritativeSessionClientFactory<TRoom = Room> = (
  endpoint: string,
) => AuthoritativeSessionClient<TRoom>;
function enableImmediateReconnection(room: unknown): void {
  if (typeof room !== "object" || room === null || !("reconnection" in room)) return;
  const value = room.reconnection;
  if (typeof value !== "object" || value === null || !("minUptime" in value)) return;
  if (typeof value.minUptime === "number") value.minUptime = 0;
}
async function join<TRoom>(
  access: ColyseusSessionTicket,
  client: AuthoritativeSessionClient<TRoom>,
): Promise<TRoom> {
  client.auth.token = access.ticket;
  try {
    const room = await client.joinOrCreate(access.roomName, access.joinOptions);
    enableImmediateReconnection(room);
    return room;
  } finally {
    client.auth.token = undefined;
  }
}
/** Claims the one-use capability; offline sessions resolve without creating a client. */
export function connectAuthoritativeSession(
  host: Pick<GameHost, "takeColyseusTicket">,
): Promise<Room | undefined>;
export function connectAuthoritativeSession<TRoom>(
  host: Pick<GameHost, "takeColyseusTicket">,
  clientFactory: AuthoritativeSessionClientFactory<TRoom>,
): Promise<TRoom | undefined>;
export async function connectAuthoritativeSession<TRoom>(
  host: Pick<GameHost, "takeColyseusTicket">,
  clientFactory?: AuthoritativeSessionClientFactory<TRoom>,
): Promise<TRoom | Room | undefined> {
  const access = host.takeColyseusTicket();
  if (access === undefined) return undefined;
  if (clientFactory === undefined) return join(access, new Client(access.endpoint));
  return join(access, clientFactory(access.endpoint));
}
