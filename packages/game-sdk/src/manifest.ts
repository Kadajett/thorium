import type { SemanticControl, SurfaceRole } from "./types.js";
import type { ControllerBindings } from "./controller-bindings.js";
import { manifestIssues } from "./core/manifest-issues.js";

export interface WebEntrypoint {
  readonly path: string;
  readonly purpose: "primary-gameplay" | "companion-controls";
}

export interface ScreenManifest {
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly maximumDevicePixelRatio: number;
}

/** Author-owned source manifest for one immutable `web-v1` Game Release. */
export interface WebGameManifest {
  readonly $schema?: string;
  readonly schema: 1;
  readonly packageId: string;
  readonly version: string;
  readonly displayName: string;
  readonly summary: string;
  readonly description: string;
  readonly runtime: {
    readonly kind: "web-v1";
    readonly sdkCompatibility: string;
    readonly entrypoints: Readonly<Record<SurfaceRole, WebEntrypoint>>;
    readonly files: readonly string[];
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

export class ManifestValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid Thorium game manifest:\n- ${issues.join("\n- ")}`);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

function assertValidManifest(input: unknown): asserts input is WebGameManifest {
  const issues = manifestIssues(input);
  if (issues.length > 0) throw new ManifestValidationError(issues);
}

export function validateManifest(input: unknown): WebGameManifest {
  assertValidManifest(input);
  return input;
}
