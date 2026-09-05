import type { SemanticControl, SurfaceRole } from "./types.js";
import { validateControllerBindings, type ControllerBindings } from "./controller-bindings.js";

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
  readonly capabilities: readonly ("same-device-peer" | "colyseus-session")[];
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

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function integerInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
  issues: string[],
): value is number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    issues.push(`${path} must be an integer from ${min} through ${max}`);
    return false;
  }
  return true;
}

function safePackagePath(value: unknown, path: string, issues: string[]): value is string {
  const segments = typeof value === "string" ? value.split("/") : [];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\0-\x1f]/.test(value) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    issues.push(`${path} must be a relative package path without '..' or backslashes`);
    return false;
  }
  return true;
}

function validateScreen(value: unknown, path: string, issues: string[]): value is ScreenManifest {
  const screen = record(value);
  if (!screen) {
    issues.push(`${path} must be an object`);
    return false;
  }
  const widthOk = integerInRange(screen.logicalWidth, `${path}.logicalWidth`, 160, 4096, issues);
  const heightOk = integerInRange(screen.logicalHeight, `${path}.logicalHeight`, 160, 4096, issues);
  const ratio = screen.maximumDevicePixelRatio;
  const ratioOk = typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 1 && ratio <= 3;
  if (!ratioOk) issues.push(`${path}.maximumDevicePixelRatio must be from 1 through 3`);
  return widthOk && heightOk && ratioOk;
}

function validateEntrypoint(
  value: unknown,
  role: SurfaceRole,
  files: readonly string[],
  issues: string[],
): void {
  const entrypoint = record(value);
  if (!entrypoint) {
    issues.push(`runtime.entrypoints.${role} must be an object`);
    return;
  }
  if (safePackagePath(entrypoint.path, `runtime.entrypoints.${role}.path`, issues)) {
    if (!files.includes(entrypoint.path)) issues.push(`runtime.files must include the ${role} entrypoint`);
  }
  const expectedPurpose = role === "main" ? "primary-gameplay" : "companion-controls";
  if (entrypoint.purpose !== expectedPurpose) {
    issues.push(`runtime.entrypoints.${role}.purpose must be ${expectedPurpose}`);
  }
}

export function validateManifest(input: unknown): WebGameManifest {
  const issues: string[] = [];
  const manifest = record(input);
  if (!manifest) throw new ManifestValidationError(["manifest must be an object"]);

  if (manifest.schema !== 1) issues.push("schema must be 1");
  if (manifest.$schema !== undefined && typeof manifest.$schema !== "string") issues.push("$schema must be a string");
  if (
    typeof manifest.packageId !== "string" ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(manifest.packageId)
  ) issues.push("packageId must be a lowercase reverse-domain style identifier");
  if (
    typeof manifest.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
  ) issues.push("version must be a semantic version such as 1.2.3");
  if (
    typeof manifest.displayName !== "string" ||
    manifest.displayName.trim().length === 0 ||
    manifest.displayName.length > 80
  ) issues.push("displayName must be a non-empty string no longer than 80 characters");
  if (typeof manifest.summary !== "string" || manifest.summary.length === 0 || manifest.summary.length > 140) {
    issues.push("summary must be a non-empty string no longer than 140 characters");
  }
  if (
    typeof manifest.description !== "string" ||
    manifest.description.length === 0 ||
    manifest.description.length > 1000
  ) issues.push("description must be a non-empty string no longer than 1000 characters");

  const runtime = record(manifest.runtime);
  let files: string[] = [];
  if (!runtime || runtime.kind !== "web-v1") {
    issues.push("runtime.kind must be web-v1");
  } else {
    if (typeof runtime.sdkCompatibility !== "string" || !/^\^?\d+\.\d+\.\d+$/.test(runtime.sdkCompatibility)) {
      issues.push("runtime.sdkCompatibility must be a version such as ^0.1.0");
    }
    if (!Array.isArray(runtime.files) || runtime.files.length === 0) {
      issues.push("runtime.files must contain every file required by the web game");
    } else {
      files = runtime.files.filter((file) => safePackagePath(file, "runtime.files[]", issues));
      if (new Set(files).size !== files.length) issues.push("runtime.files must not contain duplicates");
      if (files.includes("thorium.json")) issues.push("runtime.files must not include reserved thorium.json");
    }
    const entrypoints = record(runtime.entrypoints);
    if (!entrypoints) {
      issues.push("runtime.entrypoints must be an object");
    } else {
      validateEntrypoint(entrypoints.main, "main", files, issues);
      validateEntrypoint(entrypoints.companion, "companion", files, issues);
    }
  }

  const displays = record(manifest.displays);
  if (!displays) {
    issues.push("displays must be an object");
  } else {
    validateScreen(displays.main, "displays.main", issues);
    validateScreen(displays.companion, "displays.companion", issues);
    if (
      !Array.isArray(displays.requiredSurfaces) ||
      displays.requiredSurfaces.length === 0 ||
      displays.requiredSurfaces.some((role) => role !== "main" && role !== "companion")
    ) {
      issues.push("displays.requiredSurfaces must contain main and/or companion");
    } else if (new Set(displays.requiredSurfaces).size !== displays.requiredSurfaces.length) {
      issues.push("displays.requiredSurfaces must not contain duplicates");
    }
    if (typeof displays.supportsSingleSurfaceFallback !== "boolean") {
      issues.push("displays.supportsSingleSurfaceFallback must be boolean");
    }
  }

  const players = record(manifest.players);
  if (!players) {
    issues.push("players must be an object");
  } else {
    const minOk = integerInRange(players.minSlots, "players.minSlots", 1, 16, issues);
    const maxOk = integerInRange(players.maxSlots, "players.maxSlots", 1, 16, issues);
    const localOk = integerInRange(players.maxLocalSlots, "players.maxLocalSlots", 1, 16, issues);
    if (minOk && maxOk && (players.minSlots as number) > (players.maxSlots as number)) {
      issues.push("players.minSlots must not exceed players.maxSlots");
    }
    if (localOk && maxOk && (players.maxLocalSlots as number) > (players.maxSlots as number)) {
      issues.push("players.maxLocalSlots must not exceed players.maxSlots");
    }
    if (typeof players.sameAccountMultipleSlots !== "boolean") {
      issues.push("players.sameAccountMultipleSlots must be boolean");
    }
    if ((players.maxLocalSlots as number) > 1 && players.sameAccountMultipleSlots !== true) {
      issues.push("multiple local slots require players.sameAccountMultipleSlots");
    }
    if (players.defaultLocalSeatPlan !== undefined) {
      const plan = record(players.defaultLocalSeatPlan);
      const seats: number[] = [];
      if (!plan || Object.keys(plan).sort().join(",") !== "companion,main") issues.push("players.defaultLocalSeatPlan must define exactly main and companion");
      for (const role of ["main", "companion"] as const) {
        const slots = plan?.[role];
        if (!Array.isArray(slots) || slots.length > 16) issues.push(`players.defaultLocalSeatPlan.${role} must be an array of PlayerSlots`);
        else for (const slot of slots) if (integerInRange(slot, `players.defaultLocalSeatPlan.${role}[]`, 0, 15, issues)) seats.push(slot);
      }
      if (new Set(seats).size !== seats.length) issues.push("players.defaultLocalSeatPlan slots must be unique across surfaces");
      if (seats.length < (players.minSlots as number) || seats.length > (players.maxLocalSlots as number)) issues.push("players.defaultLocalSeatPlan must satisfy local player limits");
    }
  }

  const multiplayer = record(manifest.multiplayer);
  if (!multiplayer) {
    issues.push("multiplayer must be an object");
  } else {
    if (typeof multiplayer.online !== "boolean") issues.push("multiplayer.online must be boolean");
    if (multiplayer.requiresOnline !== undefined && typeof multiplayer.requiresOnline !== "boolean") issues.push("multiplayer.requiresOnline must be boolean");
    if (multiplayer.requiresOnline === true && multiplayer.online !== true) issues.push("multiplayer.requiresOnline requires online support");
    if (multiplayer.roomName !== "game_session") issues.push("multiplayer.roomName must be game_session");
    if (multiplayer.protocol !== "thorium-game-channel-v1") {
      issues.push("multiplayer.protocol must be thorium-game-channel-v1");
    }
  }

  if (!Array.isArray(manifest.controls) || manifest.controls.length === 0) {
    issues.push("controls must contain at least one semantic control");
  } else {
    const ids: string[] = [];
    for (const [index, value] of manifest.controls.entries()) {
      const control = record(value);
      if (!control) {
        issues.push(`controls[${index}] must be an object`);
        continue;
      }
      if (typeof control.id !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(control.id)) {
        issues.push(`controls[${index}].id is invalid`);
      } else ids.push(control.id);
      if (typeof control.label !== "string" || control.label.length === 0) {
        issues.push(`controls[${index}].label must be non-empty`);
      }
      if (control.kind !== "button" && control.kind !== "axis") {
        issues.push(`controls[${index}].kind must be button or axis`);
      }
    }
    if (new Set(ids).size !== ids.length) issues.push("control ids must be unique");
  }

  if (manifest.controllerBindings !== undefined) {
    try {
      validateControllerBindings(manifest.controllerBindings, Array.isArray(manifest.controls)
        ? manifest.controls.filter(value => record(value) !== undefined) as SemanticControl[] : []);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "Invalid controllerBindings");
    }
  }

  const allowedCapabilities = new Set(["same-device-peer", "colyseus-session"]);
  if (!Array.isArray(manifest.capabilities)) {
    issues.push("capabilities must be an array");
  } else {
    for (const capability of manifest.capabilities) {
      if (typeof capability !== "string" || !allowedCapabilities.has(capability)) {
        issues.push(`unsupported capability: ${String(capability)}`);
      }
    }
    if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
      issues.push("capabilities must not contain duplicates");
    }
    if (multiplayer?.online === true && !manifest.capabilities.includes("colyseus-session")) {
      issues.push("online games must request the colyseus-session capability");
    }
  }

  const budgets = record(manifest.budgets);
  if (!budgets) {
    issues.push("budgets must be an object");
  } else {
    integerInRange(budgets.maxPackageBytes, "budgets.maxPackageBytes", 1, 134_217_728, issues);
    integerInRange(budgets.maxFileCount, "budgets.maxFileCount", 1, 2048, issues);
    integerInRange(budgets.maxLocalPeerMessageBytes, "budgets.maxLocalPeerMessageBytes", 1, 262_144, issues);
    if (Number.isInteger(budgets.maxFileCount) && files.length > (budgets.maxFileCount as number)) {
      issues.push("runtime.files exceeds budgets.maxFileCount");
    }
  }

  if (issues.length > 0) throw new ManifestValidationError(issues);
  return input as WebGameManifest;
}
