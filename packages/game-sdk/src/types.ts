export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

declare const playerSlotBrand: unique symbol;
export type PlayerSlot = number & { readonly [playerSlotBrand]: true };

export function playerSlot(value: number): PlayerSlot {
  if (!Number.isInteger(value) || value < 0 || value > 15) {
    throw new RangeError(`PlayerSlot must be an integer from 0 through 15; received ${value}`);
  }
  return value as PlayerSlot;
}

/** Semantic destination for a surface client; never an Android display ID. */
export const SurfaceRole = {
  Main: "main",
  Companion: "companion",
} as const;

export type SurfaceRole = (typeof SurfaceRole)[keyof typeof SurfaceRole];

export interface Player {
  readonly slot: PlayerSlot;
  readonly displayName: string;
  readonly local: boolean;
}

export interface SemanticControl {
  readonly id: string;
  readonly label: string;
  readonly kind: "button" | "axis";
}

export interface ControlEvent {
  readonly control: string;
  readonly player: PlayerSlot;
  readonly phase: "pressed" | "released" | "changed";
  readonly value: number;
  readonly sequence: number;
}

export interface PeerEvent {
  readonly channel: string;
  readonly payload: JsonValue;
  readonly source: SurfaceRole;
}

export interface ColyseusSessionTicket {
  /** HTTPS/WSS origin owned by the Thorium platform. */
  readonly endpoint: string;
  readonly roomName: string;
  readonly roomId?: string;
  /** Short-lived, single-use credential passed as a Colyseus join option. */
  readonly ticket: string;
  readonly expiresAtEpochMs: number;
  /** Exact immutable Game Release and Game Session scope required by the room. */
  readonly joinOptions: {
    readonly gameSessionId: string;
    readonly packageId: string;
    readonly packageVersion: string;
    readonly packageDigest: string;
  };
}

export interface GameBootstrap {
  readonly protocolVersion: 1;
  readonly surface: SurfaceRole;
  readonly game: {
    readonly id: string;
    readonly version: string;
    readonly instanceId: string;
  };
  readonly players: readonly Player[];
  /** Player Slots for which this surface may originate semantic controls. */
  readonly controlledPlayerSlots: readonly PlayerSlot[];
  readonly controls: readonly SemanticControl[];
  readonly render: {
    readonly logicalWidth: number;
    readonly logicalHeight: number;
    readonly maximumDevicePixelRatio: number;
  };
  readonly limits: {
    readonly maxLocalPeerMessageBytes: number;
  };
  readonly colyseus?: ColyseusSessionTicket;
}

/** Game-visible bootstrap projection. One-use capability material is host-private. */
export type PublicGameBootstrap = Omit<GameBootstrap, "colyseus">;

export interface FrameContext {
  readonly number: number;
  readonly nowMs: number;
  /** Clamped by the SDK so resuming a WebView cannot produce a huge simulation step. */
  readonly deltaMs: number;
}

export interface Viewport {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly devicePixelRatio: number;
}

export interface GameContext {
  readonly surface: SurfaceRole;
  readonly canvas: HTMLCanvasElement;
  readonly host: GameHost;
  readonly players: readonly Player[];
  viewport(): Viewport;
}

/**
 * The complete author interface for one WebView surface.
 *
 * `start` is called exactly once. `tick` follows requestAnimationFrame and may
 * pause while the surface is hidden or the Android host is suspended.
 */
export interface SurfaceGame {
  start(context: GameContext): void | Promise<void>;
  tick(frame: FrameContext): void;
}

export interface DualSurfaceGame {
  readonly main: () => SurfaceGame;
  readonly companion: () => SurfaceGame;
}

export interface GameHost {
  readonly bootstrap: PublicGameBootstrap;
  emitControl(event: Omit<ControlEvent, "sequence">): void;
  onControl(listener: (event: ControlEvent) => void): () => void;
  sendToPeer(channel: string, payload: JsonValue): void;
  onPeer(channel: string, listener: (event: PeerEvent) => void): () => void;
  /** The same surface may claim its short-lived ticket only once. */
  takeColyseusTicket(): ColyseusSessionTicket | undefined;
}

export interface HostTransport {
  readBootstrap(): Promise<GameBootstrap>;
  send(message: HostOutboundMessage): void;
  subscribe(listener: (message: HostInboundMessage) => void): () => void;
}

export type HostOutboundMessage =
  | { readonly kind: "bootstrap-request"; readonly requestId: string }
  | { readonly kind: "ready"; readonly surface: SurfaceRole }
  | { readonly kind: "control"; readonly event: ControlEvent }
  | {
      readonly kind: "peer";
      readonly channel: string;
      readonly payload: JsonValue;
      readonly source: SurfaceRole;
    };

export type HostInboundMessage =
  | { readonly kind: "bootstrap"; readonly requestId: string; readonly bootstrap: GameBootstrap }
  | { readonly kind: "control"; readonly event: ControlEvent }
  | { readonly kind: "peer"; readonly event: PeerEvent }
  | { readonly kind: "lifecycle"; readonly state: "active" | "suspended" | "stopped" };

export interface FrameDriver {
  request(callback: (nowMs: number) => void): number;
  cancel(handle: number): void;
}
