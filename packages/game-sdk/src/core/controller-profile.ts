import type { SemanticControl } from "../types.js";
import {
  array,
  choice,
  integer,
  record,
  required,
  unique,
  type UnknownRecord,
} from "./validation.js";
import { hasExactKeys } from "./manifest-checks.js";

export const CONTROLLER_BUTTONS = [
  "south",
  "east",
  "west",
  "north",
  "dpad-up",
  "dpad-down",
  "dpad-left",
  "dpad-right",
  "left-shoulder",
  "right-shoulder",
  "left-stick",
  "right-stick",
  "start",
  "select",
] as const;
export const CONTROLLER_AXES = [
  "left-x",
  "left-y",
  "right-x",
  "right-y",
  "left-trigger",
  "right-trigger",
] as const;

export type ControllerBinding =
  | {
      readonly kind: "button";
      readonly input: (typeof CONTROLLER_BUTTONS)[number];
      readonly control: string;
    }
  | {
      readonly kind: "axis";
      readonly input: (typeof CONTROLLER_AXES)[number];
      readonly control: string;
    }
  | {
      readonly kind: "axis-button";
      readonly input: (typeof CONTROLLER_AXES)[number];
      readonly direction: -1 | 1;
      readonly control: string;
    };

export interface ControllerBindings {
  readonly schema: 1;
  readonly bindings: readonly ControllerBinding[];
}

function profileBindings(value: unknown): readonly unknown[] {
  const message = "controllerBindings must have schema 1 and 1–64 bindings";
  const profile = record(value, message);
  choice(profile.schema, [1], message);
  if (!hasExactKeys(profile, ["schema", "bindings"])) throw new TypeError(message);
  const bindings = array(profile.bindings, message);
  integer(bindings.length, [1, 64], message);
  return bindings;
}

function semanticTarget(binding: UnknownRecord, controls: readonly SemanticControl[]): string {
  const message = "controllerBindings must reference a declared control of the matching kind";
  const control = required(
    controls.find((candidate) => candidate.id === binding.control),
    message,
  );
  choice(control.kind, [semanticKind(binding)], message);
  return control.id;
}

function semanticKind(binding: UnknownRecord): "axis" | "button" {
  return binding.kind === "axis" ? "axis" : "button";
}

function bindingFields(binding: UnknownRecord): void {
  const allowed: readonly string[] =
    binding.kind === "axis-button"
      ? ["kind", "input", "control", "direction"]
      : ["kind", "input", "control"];
  if (Object.keys(binding).some((key) => !allowed.includes(key)))
    throw new TypeError("controllerBindings contains unknown fields");
}

function axisBinding(binding: UnknownRecord, control: string): ControllerBinding {
  const input = choice(
    binding.input,
    CONTROLLER_AXES,
    "controllerBindings contains an unsupported physical input",
  );
  if (binding.kind === "axis") return { kind: "axis", input, control };
  return {
    kind: "axis-button",
    input,
    control,
    direction: choice(
      binding.direction,
      [-1, 1],
      "controllerBindings axis-button direction must be -1 or 1",
    ),
  };
}

function parseBinding(value: unknown, controls: readonly SemanticControl[]): ControllerBinding {
  const binding = record(value, "controllerBindings contains an unsupported binding kind");
  const kind = choice(
    binding.kind,
    ["button", "axis", "axis-button"],
    "controllerBindings contains an unsupported binding kind",
  );
  bindingFields(binding);
  const control = semanticTarget(binding, controls);
  if (kind !== "button") return axisBinding(binding, control);
  return {
    kind,
    control,
    input: choice(
      binding.input,
      CONTROLLER_BUTTONS,
      "controllerBindings contains an unsupported physical input",
    ),
  };
}

function sourceKey(binding: ControllerBinding): string {
  const direction = binding.kind === "axis-button" ? String(binding.direction) : "";
  return binding.kind + ":" + binding.input + ":" + direction;
}

function assertCompatibleSources(bindings: readonly ControllerBinding[]): void {
  unique(bindings.map(sourceKey), "controllerBindings cannot map a physical source twice");
  const axes: readonly string[] = bindings
    .filter((binding) => binding.kind === "axis")
    .map((binding) => binding.input);
  if (bindings.some((binding) => binding.kind === "axis-button" && axes.includes(binding.input))) {
    throw new TypeError(
      "controllerBindings cannot map an axis as both analog and directional buttons",
    );
  }
}

/** Validate physical mappings without inventing a controller or PlayerSlot assignment. */
export function validateControllerBindings(
  value: unknown,
  controls: readonly SemanticControl[],
): ControllerBindings {
  const bindings: readonly ControllerBinding[] = profileBindings(value).map((binding) =>
    parseBinding(binding, controls),
  );
  assertCompatibleSources(bindings);
  return { schema: 1, bindings };
}
