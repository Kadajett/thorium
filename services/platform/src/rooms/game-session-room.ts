import {
  Client,
  Room,
  ServerError,
  validate,
  type AuthContext,
} from "@colyseus/core";
import { z } from "zod";
import { SessionTicketScopeMismatchError } from "../security/session-ticket-service.js";
import type {
  PendingSessionTicket,
  SessionTicketClaims,
  SessionTicketService,
} from "../security/session-ticket-service.js";
import type { GameSessionRegistry } from "../session-registry/game-session-registry.js";
import {
  GameSessionState,
  PlayerSeatState,
  SurfaceClientState,
} from "./game-session-state.js";

export const GameSessionOptionsSchema = z.strictObject({
  gameSessionId: z.string().uuid(),
  packageId: z.string().min(1).max(128),
  packageVersion: z.string().min(1).max(64),
  packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type GameSessionOptions = z.infer<typeof GameSessionOptionsSchema>;

interface GameSessionClientData {
  readonly accountScope: string;
  readonly surfaceId: string;
  readonly role: "main" | "companion";
  readonly playerSlots: readonly number[];
  readonly lastSequenceBySlot: Map<number, number>;
}

type GameSessionClient = Client<{
  auth: PendingSessionTicket;
  userData: GameSessionClientData;
}>;

const GameInputSchema = z.strictObject({
  playerSlot: z.number().int().min(0).max(15),
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  channel: z.number().int().nonnegative().max(255),
  payload: z.string().max(43_692).refine((value) => {
    if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      return false;
    }
    const decoded = Buffer.from(value, "base64");
    return decoded.byteLength <= 32_768 && decoded.toString("base64") === value;
  }, "payload must be canonical base64"),
});
const SUPERSEDED_SESSION_CLOSE_CODE = 4_410;
const REGISTRY_UNAVAILABLE_CLOSE_CODE = 4_500;

export function createGameSessionRoom(
  ticketService: SessionTicketService,
  gameSessions: GameSessionRegistry,
) {
  class GameSessionRoom extends Room<{
    state: GameSessionState;
    client: GameSessionClient;
    metadata: GameSessionOptions;
  }> {
    state = new GameSessionState();
    #generation: number | undefined;
    #fencePollInFlight = false;
    #disconnectingForFence = false;

    static async onAuth(
      token: string | undefined,
      options: unknown,
      _context: AuthContext,
    ): Promise<PendingSessionTicket> {
      if (typeof token !== "string" || token.length === 0 || token.length > 4_096) {
        throw new ServerError(401, "session_ticket_required");
      }

      try {
        const roomOptions = GameSessionOptionsSchema.parse(options);
        return await ticketService.verifyScope(token, roomOptions);
      } catch (error) {
        if (error instanceof SessionTicketScopeMismatchError) {
          throw new ServerError(403, error.message);
        }
        if (error instanceof ServerError) {
          throw error;
        }
        throw new ServerError(401, "invalid_session_ticket");
      }
    }

    onCreate(rawOptions: unknown): void {
      const options = GameSessionOptionsSchema.parse(rawOptions);
      this.maxClients = 8;
      this.maxMessagesPerSecond = 120;
      this.autoDispose = true;
      this.state.gameSessionId = options.gameSessionId;
      this.state.packageId = options.packageId;
      this.state.packageVersion = options.packageVersion;
      this.state.packageDigest = options.packageDigest;
      this.metadata = options;
      this.clock.setInterval(() => {
        void this.#enforceActiveGeneration();
      }, 1_000);
    }

    async onJoin(client: GameSessionClient): Promise<void> {
      const pending = client.auth;
      if (pending === undefined) {
        throw new ServerError(401, "session_ticket_required");
      }
      let claims: SessionTicketClaims;
      try {
        claims = ticketService.accept(pending);
      } catch {
        throw new ServerError(401, "invalid_session_ticket");
      }
      if (
        claims.gameSessionId !== this.state.gameSessionId
        || claims.packageId !== this.state.packageId
        || claims.packageVersion !== this.state.packageVersion
        || claims.packageDigest !== this.state.packageDigest
      ) {
        throw new ServerError(403, "session_room_scope_mismatch");
      }
      if (this.#generation !== undefined && this.#generation !== claims.generation) {
        throw new ServerError(403, "session_generation_mismatch");
      }
      if (this.state.surfaces.has(claims.surfaceId)) {
        throw new ServerError(4409, "surface_already_leased");
      }
      for (const playerSlot of claims.playerSlots) {
        if (this.state.playerSeats.has(String(playerSlot))) {
          throw new ServerError(4409, "player_slot_already_leased");
        }
      }

      const admission = await gameSessions.admit({
        gameSessionId: claims.gameSessionId,
        generation: claims.generation,
        roomInstanceId: this.roomId,
        release: {
          packageId: claims.packageId,
          version: claims.packageVersion,
          contentDigest: claims.packageDigest,
        },
        capabilityId: claims.capabilityId,
        surfaceId: claims.surfaceId,
        role: claims.role,
        playerSlots: claims.playerSlots,
      });
      if (!admission.ok) {
        throw new ServerError(
          admission.conflict.code === "CAPABILITY_REPLAYED" ? 401 : 403,
          "session_capability_rejected",
        );
      }
      this.#generation = claims.generation;

      client.userData = {
        accountScope: claims.accountScope,
        surfaceId: claims.surfaceId,
        role: claims.role,
        playerSlots: claims.playerSlots,
        lastSequenceBySlot: new Map(),
      };

      const surface = new SurfaceClientState();
      surface.surfaceId = claims.surfaceId;
      surface.role = claims.role;
      surface.endpointSessionId = client.sessionId;
      surface.connected = true;
      surface.playerSlots.push(...claims.playerSlots);
      this.state.surfaces.set(claims.surfaceId, surface);

      for (const playerSlot of claims.playerSlots) {
        const seat = new PlayerSeatState();
        seat.playerSlot = playerSlot;
        seat.surfaceId = claims.surfaceId;
        seat.endpointSessionId = client.sessionId;
        this.state.playerSeats.set(String(playerSlot), seat);
      }

      client.send("session_ready", {
        gameSessionId: this.state.gameSessionId,
        packageId: this.state.packageId,
        surfaceId: claims.surfaceId,
        role: claims.role,
        playerSlots: claims.playerSlots,
      });
    }

    messages = {
      game_input: validate(GameInputSchema, (client: GameSessionClient, input) => {
        const data = client.userData;
        if (data === undefined || !data.playerSlots.includes(input.playerSlot)) {
          throw new ServerError(4403, "player_slot_not_leased");
        }

        const previousSequence = data.lastSequenceBySlot.get(input.playerSlot) ?? -1;
        if (input.sequence <= previousSequence) {
          throw new ServerError(4400, "input_sequence_not_increasing");
        }
        data.lastSequenceBySlot.set(input.playerSlot, input.sequence);

        this.broadcast("game_event", {
          playerSlot: input.playerSlot,
          surfaceId: data.surfaceId,
          sequence: input.sequence,
          channel: input.channel,
          payload: input.payload,
        });
      }),
    };

    onDrop(client: GameSessionClient, code?: number): void {
      const data = client.userData;
      if (data === undefined) return;
      const surface = this.state.surfaces.get(data.surfaceId);
      if (surface !== undefined) {
        surface.connected = false;
      }
      if (
        code === SUPERSEDED_SESSION_CLOSE_CODE
        || code === REGISTRY_UNAVAILABLE_CLOSE_CODE
      ) return;
      void this.allowReconnection(client, 20).catch(() => undefined);
    }

    onReconnect(client: GameSessionClient): void {
      const data = client.userData;
      if (data !== undefined) {
        const surface = this.state.surfaces.get(data.surfaceId);
        if (surface !== undefined) {
          surface.connected = true;
          surface.endpointSessionId = client.sessionId;
        }
      }
    }

    onLeave(client: GameSessionClient): void {
      const data = client.userData;
      if (data === undefined) {
        return;
      }
      this.state.surfaces.delete(data.surfaceId);
      for (const playerSlot of data.playerSlots) {
        const playerSlotKey = String(playerSlot);
        const seat = this.state.playerSeats.get(playerSlotKey);
        if (seat?.endpointSessionId === client.sessionId) {
          this.state.playerSeats.delete(playerSlotKey);
        }
      }
    }

    async onDispose(): Promise<void> {
      if (this.#generation === undefined) return;
      await gameSessions.finish({
        gameSessionId: this.state.gameSessionId,
        generation: this.#generation,
        roomInstanceId: this.roomId,
        reason: "abandoned",
      });
    }

    async #enforceActiveGeneration(): Promise<void> {
      const generation = this.#generation;
      if (
        generation === undefined
        || this.#fencePollInFlight
        || this.#disconnectingForFence
      ) return;

      this.#fencePollInFlight = true;
      try {
        if (await gameSessions.isActive({
          gameSessionId: this.state.gameSessionId,
          generation,
          roomInstanceId: this.roomId,
        })) return;

        this.#disconnectingForFence = true;
        this.broadcast("session_ended", { reason: "superseded" });
        await this.disconnect(SUPERSEDED_SESSION_CLOSE_CODE);
      } catch {
        this.#disconnectingForFence = true;
        await this.disconnect(REGISTRY_UNAVAILABLE_CLOSE_CODE);
      } finally {
        this.#fencePollInFlight = false;
      }
    }
  }

  return GameSessionRoom;
}
