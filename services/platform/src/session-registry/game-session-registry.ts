import type { SurfaceRole } from "../domain/game-package.js";

export interface ExactGameRelease {
  readonly packageId: string;
  readonly version: string;
  readonly contentDigest: string;
}

export interface RequestedGameSessionSurface {
  readonly surfaceId: string;
  readonly role: SurfaceRole;
  readonly playerSlots: readonly number[];
}

export interface ActivateGameSession {
  /** Idempotency key scoped to the durable accountId. */
  readonly requestId: string;
  readonly accountId: string;
  readonly release: ExactGameRelease;
  readonly surfaces: readonly RequestedGameSessionSurface[];
}

export interface GameSessionSurfaceGrant extends RequestedGameSessionSurface {
  /** Opaque, single-admission identifier to bind into a signed surface ticket. */
  readonly capabilityId: string;
}

export interface GameSessionActivation {
  readonly gameSessionId: string;
  /** Monotonically increases for each activation by this durable account. */
  readonly generation: number;
  readonly release: ExactGameRelease;
  readonly surfaces: readonly GameSessionSurfaceGrant[];
  readonly supersededGameSessionId?: string;
}

export type GameSessionRegistryConflict<Code extends string> = Readonly<{
  code: Code;
  message: string;
}>;

export type ActivateGameSessionConflictCode =
  | "INVALID_ACTIVATION"
  | "REQUEST_ID_REUSED"
  | "REQUEST_NO_LONGER_ACTIVE";

export type ActivateGameSessionResult =
  | Readonly<{
    ok: true;
    replayed: boolean;
    activation: GameSessionActivation;
  }>
  | Readonly<{
    ok: false;
    conflict: GameSessionRegistryConflict<ActivateGameSessionConflictCode>;
  }>;

export interface GameSessionRoomFence {
  readonly gameSessionId: string;
  readonly generation: number;
  /** Opaque Colyseus room identity bound by the first admitted surface. */
  readonly roomInstanceId: string;
}

export interface AdmitGameSessionSurface extends GameSessionSurfaceGrant, GameSessionRoomFence {
  readonly release: ExactGameRelease;
}

export interface GameSessionSurfaceAdmission {
  readonly gameSessionId: string;
  readonly generation: number;
  readonly surfaceId: string;
  readonly role: SurfaceRole;
  readonly playerSlots: readonly number[];
}

export type AdmitGameSessionSurfaceConflictCode =
  | "SESSION_NOT_ACTIVE"
  | "GENERATION_MISMATCH"
  | "RELEASE_SCOPE_MISMATCH"
  | "SURFACE_SCOPE_MISMATCH"
  | "ROOM_FENCE_MISMATCH"
  | "CAPABILITY_REPLAYED";

export type AdmitGameSessionSurfaceResult =
  | Readonly<{ ok: true; admission: GameSessionSurfaceAdmission }>
  | Readonly<{
    ok: false;
    conflict: GameSessionRegistryConflict<AdmitGameSessionSurfaceConflictCode>;
  }>;

export type GameSessionFinishReason = "completed" | "abandoned" | "room-failed";

export interface FinishGameSession extends GameSessionRoomFence {
  readonly reason: GameSessionFinishReason;
}

export type FinishGameSessionConflictCode =
  | "SESSION_NOT_FOUND"
  | "GENERATION_MISMATCH"
  | "ROOM_FENCE_MISMATCH"
  | "SESSION_SUPERSEDED";

export type FinishGameSessionResult =
  | Readonly<{ ok: true; status: "finished" | "already-finished" }>
  | Readonly<{
    ok: false;
    conflict: GameSessionRegistryConflict<FinishGameSessionConflictCode>;
  }>;

/**
 * Transactional lifecycle seam shared by launch and authoritative room adapters.
 *
 * activate() atomically supersedes this durable account's previous active
 * Game Session. admit() is called once at room join, after stateless ticket
 * verification. isActive() lets a hot room cheaply poll its generation fence
 * without reading the database for every input. finish() is generation-fenced
 * and idempotent.
 */
export interface GameSessionRegistry {
  activate(input: ActivateGameSession): Promise<ActivateGameSessionResult>;
  admit(input: AdmitGameSessionSurface): Promise<AdmitGameSessionSurfaceResult>;
  isActive(input: GameSessionRoomFence): Promise<boolean>;
  finish(input: FinishGameSession): Promise<FinishGameSessionResult>;
}
