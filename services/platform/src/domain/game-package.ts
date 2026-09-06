export type SurfaceRole = "main" | "companion";

export interface WebEntrypoint {
  readonly path: string;
  readonly purpose: "primary-gameplay" | "companion-controls";
}

export interface ScreenManifest {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly maximumDevicePixelRatio: number;
}

export interface SemanticControl {
  readonly id: string;
  readonly label: string;
  readonly kind: "button" | "axis";
}

export type ControllerButtonInput =
  | "south"
  | "east"
  | "west"
  | "north"
  | "dpad-up"
  | "dpad-down"
  | "dpad-left"
  | "dpad-right"
  | "left-shoulder"
  | "right-shoulder"
  | "left-stick"
  | "right-stick"
  | "start"
  | "select";

export type ControllerAxisInput =
  | "left-x"
  | "left-y"
  | "right-x"
  | "right-y"
  | "left-trigger"
  | "right-trigger";

export type ControllerBinding =
  | {
    readonly kind: "button";
    readonly input: ControllerButtonInput;
    readonly control: string;
  }
  | {
    readonly kind: "axis";
    readonly input: ControllerAxisInput;
    readonly control: string;
  }
  | {
    readonly kind: "axis-button";
    readonly input: ControllerAxisInput;
    readonly direction: -1 | 1;
    readonly control: string;
  };

export interface ControllerBindings {
  readonly schema: 1;
  readonly bindings: readonly ControllerBinding[];
}

export interface GamePackageFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface GameRelease {
  readonly schema: 1;
  readonly packageId: string;
  readonly version: string;
  readonly displayName: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly publishedAt: string;
  /** Digest of the canonical deploy descriptor, binding the manifest and all file hashes. */
  readonly contentDigest: string;
  readonly runtime: {
    readonly kind: "web-v1";
    readonly sdkCompatibility: string;
    readonly entrypoints: Readonly<Record<SurfaceRole, WebEntrypoint>>;
    readonly files: readonly string[];
  };
  readonly bundle: {
    readonly fileName: string;
    readonly url: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly manifestSha256: string;
    readonly files: readonly GamePackageFile[];
  };
  readonly displays: {
    readonly requiredSurfaces: readonly SurfaceRole[];
    readonly supportsSingleSurfaceFallback: boolean;
    readonly main: ScreenManifest;
    readonly companion: ScreenManifest;
  };
  readonly players: {
    readonly minSlots: number;
    readonly maxSlots: number;
    readonly maxLocalSlots: number;
    readonly sameAccountMultipleSlots: boolean;
    readonly defaultLocalSeatPlan?: Readonly<Record<SurfaceRole, readonly number[]>>;
  };
  readonly multiplayer: {
    readonly online: boolean;
    readonly requiresOnline?: boolean;
    readonly roomName: "game_session";
    readonly protocol: "thorium-game-channel-v1";
  };
  readonly controls: readonly SemanticControl[];
  readonly controllerBindings?: ControllerBindings;
  readonly capabilities: readonly ("same-device-peer" | "colyseus-session" | "local-save-v1")[];
  readonly budgets: {
    readonly maxPackageBytes: number;
    readonly maxFileCount: number;
    readonly maxLocalPeerMessageBytes: number;
  };
}

export interface CatalogQuery {
  readonly query?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface CatalogPage {
  readonly items: readonly GameRelease[];
  readonly nextCursor?: string;
}
