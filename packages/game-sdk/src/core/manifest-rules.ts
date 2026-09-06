import type { SemanticControl } from "../types.js";
import { validateControllerBindings } from "./controller-profile.js";
import { isArray, isRecord, type UnknownRecord } from "./validation.js";
import {
  arrayValue,
  booleanIssues,
  boundedText,
  check,
  duplicates,
  matches,
} from "./manifest-checks.js";

export function identityIssues(value: UnknownRecord): readonly string[] {
  return [
    ...check(value.schema === 1, "schema must be 1"),
    ...check(
      value.$schema === undefined || typeof value.$schema === "string",
      "$schema must be a string",
    ),
    ...check(
      matches(value.packageId, /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
      "packageId must be a lowercase reverse-domain style identifier",
    ),
    ...check(
      matches(value.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
      "version must be a semantic version such as 1.2.3",
    ),
  ];
}

export function descriptionIssues(value: UnknownRecord): readonly string[] {
  const validName = boundedText(value.displayName, 80) && value.displayName.trim().length > 0;
  return [
    ...check(validName, "displayName must be a non-empty string no longer than 80 characters"),
    ...check(
      boundedText(value.summary, 140),
      "summary must be a non-empty string no longer than 140 characters",
    ),
    ...check(
      boundedText(value.description, 1000),
      "description must be a non-empty string no longer than 1000 characters",
    ),
  ];
}

export function multiplayerIssues(value: unknown): readonly string[] {
  if (!isRecord(value)) return ["multiplayer must be an object"];
  return [
    ...booleanIssues(value.online, "multiplayer.online"),
    ...check(
      value.requiresOnline === undefined || typeof value.requiresOnline === "boolean",
      "multiplayer.requiresOnline must be boolean",
    ),
    ...check(
      value.requiresOnline !== true || value.online === true,
      "multiplayer.requiresOnline requires online support",
    ),
    ...check(value.roomName === "game_session", "multiplayer.roomName must be game_session"),
    ...check(
      value.protocol === "thorium-game-channel-v1",
      "multiplayer.protocol must be thorium-game-channel-v1",
    ),
  ];
}

function controlIssues(value: unknown, index: number): readonly string[] {
  const path = "controls[" + String(index) + "]";
  if (!isRecord(value)) return [path + " must be an object"];
  return [
    ...check(matches(value.id, /^[a-z][a-z0-9-]{0,31}$/), path + ".id is invalid"),
    ...check(boundedText(value.label, Number.MAX_SAFE_INTEGER), path + ".label must be non-empty"),
    ...check(
      value.kind === "button" || value.kind === "axis",
      path + ".kind must be button or axis",
    ),
  ];
}

function isControl(value: unknown): value is SemanticControl {
  return controlIssues(value, 0).length === 0;
}

export function controlsIssues(value: unknown): readonly string[] {
  if (!isArray(value) || value.length === 0)
    return ["controls must contain at least one semantic control"];
  const ids: readonly string[] = value.filter(isControl).map((control) => control.id);
  return [...value.flatMap(controlIssues), ...duplicates(ids, "control ids must be unique")];
}

export function bindingIssues(value: unknown, controls: unknown): readonly string[] {
  if (value === undefined) return [];
  try {
    validateControllerBindings(value, arrayValue(controls).filter(isControl));
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "Invalid controllerBindings"];
  }
}

function isCapability(value: unknown): boolean {
  return value === "same-device-peer" || value === "colyseus-session" || value === "local-save-v1";
}

export function capabilityIssues(value: unknown, multiplayer: unknown): readonly string[] {
  if (!isArray(value)) return ["capabilities must be an array"];
  const online = isRecord(multiplayer) && multiplayer.online === true;
  return [
    ...value.flatMap((capability) =>
      check(isCapability(capability), "unsupported capability: " + String(capability)),
    ),
    ...duplicates(value, "capabilities must not contain duplicates"),
    ...check(
      !online || value.includes("colyseus-session"),
      "online games must request the colyseus-session capability",
    ),
  ];
}
