import type { SemanticControl } from "./types.js";

export const CONTROLLER_BUTTONS = [
  "south", "east", "west", "north", "dpad-up", "dpad-down", "dpad-left", "dpad-right",
  "left-shoulder", "right-shoulder", "left-stick", "right-stick", "start", "select",
] as const;
export const CONTROLLER_AXES = [
  "left-x", "left-y", "right-x", "right-y", "left-trigger", "right-trigger",
] as const;

export type ControllerBinding =
  | { readonly kind: "button"; readonly input: typeof CONTROLLER_BUTTONS[number]; readonly control: string }
  | { readonly kind: "axis"; readonly input: typeof CONTROLLER_AXES[number]; readonly control: string }
  | { readonly kind: "axis-button"; readonly input: typeof CONTROLLER_AXES[number]; readonly direction: -1 | 1; readonly control: string };

export interface ControllerBindings {
  readonly schema: 1;
  readonly bindings: readonly ControllerBinding[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Validate authored physical mappings without inventing a controller or PlayerSlot assignment. */
export function validateControllerBindings(value: unknown, controls: readonly SemanticControl[]): ControllerBindings {
  const profile = record(value);
  if (!profile || profile.schema !== 1 || Object.keys(profile).some(key => key !== "schema" && key !== "bindings") ||
    !Array.isArray(profile.bindings) || profile.bindings.length < 1 || profile.bindings.length > 64) {
    throw new TypeError("controllerBindings must have schema 1 and 1–64 bindings");
  }
  const sources = new Set<string>();
  const analogInputs = new Set<string>();
  const directionInputs = new Set<string>();
  for (const raw of profile.bindings) {
    const binding = record(raw);
    if (!binding || !["button", "axis", "axis-button"].includes(String(binding.kind))) {
      throw new TypeError("controllerBindings contains an unsupported binding kind");
    }
    const allowed = binding.kind === "axis-button" ? ["kind", "input", "control", "direction"] : ["kind", "input", "control"];
    if (Object.keys(binding).some(key => !allowed.includes(key))) throw new TypeError("controllerBindings contains unknown fields");
    const inputs: readonly string[] = binding.kind === "button" ? CONTROLLER_BUTTONS : CONTROLLER_AXES;
    if (typeof binding.input !== "string" || !inputs.includes(binding.input)) throw new TypeError("controllerBindings contains an unsupported physical input");
    if (binding.kind === "axis-button" && binding.direction !== -1 && binding.direction !== 1) {
      throw new TypeError("controllerBindings axis-button direction must be -1 or 1");
    }
    const control = controls.find(control => control.id === binding.control);
    if (!control || control.kind !== (binding.kind === "axis" ? "axis" : "button")) {
      throw new TypeError("controllerBindings must reference a declared control of the matching kind");
    }
    const key = `${binding.kind}:${binding.input}:${binding.kind === "axis-button" ? binding.direction : ""}`;
    if (sources.has(key)) throw new TypeError("controllerBindings cannot map a physical source twice");
    sources.add(key);
    if (binding.kind === "axis") analogInputs.add(binding.input);
    if (binding.kind === "axis-button") directionInputs.add(binding.input);
  }
  if ([...analogInputs].some(input => directionInputs.has(input))) {
    throw new TypeError("controllerBindings cannot map an axis as both analog and directional buttons");
  }
  return value as ControllerBindings;
}
