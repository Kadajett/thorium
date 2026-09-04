import { schema, t, type SchemaType } from "@colyseus/schema";

export const SurfaceClientState = schema({
  surfaceId: t.string(),
  role: t.string(),
  endpointSessionId: t.string(),
  connected: t.boolean(),
  playerSlots: t.array("number"),
}, "SurfaceClientState");
export type SurfaceClientState = SchemaType<typeof SurfaceClientState>;

export const PlayerSeatState = schema({
  playerSlot: t.number(),
  surfaceId: t.string(),
  endpointSessionId: t.string(),
}, "PlayerSeatState");
export type PlayerSeatState = SchemaType<typeof PlayerSeatState>;

export const GameSessionState = schema({
  gameSessionId: t.string().fullStateOnly(),
  packageId: t.string().fullStateOnly(),
  packageVersion: t.string().fullStateOnly(),
  packageDigest: t.string().fullStateOnly(),
  surfaces: t.map(SurfaceClientState),
  playerSeats: t.map(PlayerSeatState),
}, "GameSessionState");
export type GameSessionState = SchemaType<typeof GameSessionState>;
