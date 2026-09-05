import type { Room } from "@colyseus/core";

export const GAME_HOST_API_VERSION = "thorium-game-host-v1" as const;

export type SurfaceRole = "main" | "companion";
export type GameRoomKind = "account-session" | "public-world";
export type GameSessionFinishReason = "completed" | "abandoned" | "room-failed";

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export interface ExactGameRelease {
  readonly packageId: string;
  readonly version: string;
  /** SHA-256 of canonical publication descriptor JSON. */
  readonly contentDigest: string;
}

export interface AdmissionExpectedScope {
  readonly localRoomName: string;
  readonly joinOptions: JsonObject;
}

export interface SurfaceAdmission {
  /** Stable opaque account/game scope. This is never an Account ID or Player ID. */
  readonly accountScope: string;
  readonly capabilityId: string;
  readonly expiresAtEpochMs: number;
  readonly gameSessionId: string;
  readonly generation: number;
  readonly release: ExactGameRelease;
  readonly surfaceId: string;
  readonly role: SurfaceRole;
  readonly playerSlots: readonly number[];
}

export interface RegistryFence {
  readonly gameSessionId: string;
  readonly generation: number;
  readonly roomInstanceId: string;
  readonly release: ExactGameRelease;
}

declare const pendingPlatformAdmissionBrand: unique symbol;
declare const pendingTransferAdmissionBrand: unique symbol;

/** Opaque verified-but-unconsumed Platform ticket. Only the host can create it. */
export type PendingPlatformAdmission = Readonly<{
  [pendingPlatformAdmissionBrand]: never;
}>;

/** Opaque verified-but-unconsumed one-use room-transfer ticket. */
export type PendingTransferAdmission = Readonly<{
  [pendingTransferAdmissionBrand]: never;
}>;

export interface TransferAdmission {
  readonly source: SurfaceAdmission;
  readonly fence: RegistryFence;
  readonly moduleClaims: JsonObject;
}

export interface TransferCapability {
  readonly endpoint: string;
  readonly roomName: string;
  readonly token: string;
  readonly expiresAtEpochMs: number;
  readonly joinOptions: JsonObject;
}

export interface TransferRequest {
  readonly targetLocalRoomName: string;
  readonly joinOptions: JsonObject;
  /** Bounded game-owned claims validated again by the target room. */
  readonly moduleClaims: JsonObject;
  /** The host caps this at 30 seconds and never exceeds the parent expiry. */
  readonly expiresInSeconds?: number;
}

/**
 * Host-owned cryptographic boundary. Modules receive operations, never keys.
 * Verification is side-effect free; consume performs durable one-use replay
 * protection only after room options have also matched.
 */
export interface GameHostAdmissionPort {
  verifyPlatform(
    token: string,
    expected: AdmissionExpectedScope,
  ): Promise<PendingPlatformAdmission>;
  consumePlatform(pending: PendingPlatformAdmission): Promise<SurfaceAdmission>;
  issueTransfer(
    source: SurfaceAdmission,
    fence: RegistryFence,
    request: TransferRequest,
  ): Promise<TransferCapability>;
  verifyTransfer(
    token: string,
    expected: AdmissionExpectedScope,
  ): Promise<PendingTransferAdmission>;
  consumeTransfer(pending: PendingTransferAdmission): Promise<TransferAdmission>;
}

/** Host-owned adapter to Thorium's durable one-active-GameSession registry. */
export interface GameHostRegistryPort {
  admit(admission: SurfaceAdmission, roomInstanceId: string): Promise<RegistryFence>;
  isActive(fence: RegistryFence): Promise<boolean>;
  finish(fence: RegistryFence, reason: GameSessionFinishReason): Promise<void>;
}

export interface ThoriumGameHostContext {
  readonly apiVersion: typeof GAME_HOST_API_VERSION;
  readonly release: ExactGameRelease;
  readonly endpoint: string;
  readonly stateDirectory: string;
  /** Resolves a release-scoped physical name with no cross-game collisions. */
  roomName(localRoomName: string): string;
  readonly admission: GameHostAdmissionPort;
  readonly registry: GameHostRegistryPort;
}

export interface ThoriumGameRoomDefinition {
  readonly localName: string;
  readonly kind: GameRoomKind;
  // Colyseus constructs rooms internally and defines its public constructor
  // constraint with `any[]`; modules do not invoke this constructor themselves.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly roomClass: new (...args: any[]) => Room;
  readonly filterBy?: readonly string[];
}

export interface ThoriumGameModule {
  readonly apiVersion: typeof GAME_HOST_API_VERSION;
  readonly rooms: readonly ThoriumGameRoomDefinition[];
  dispose?(): void | Promise<void>;
}

export type CreateThoriumGameModule = (
  context: ThoriumGameHostContext,
) => ThoriumGameModule | Promise<ThoriumGameModule>;
