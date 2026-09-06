import {
  type ControlEvent,
  type HostInboundMessage,
  type JsonValue,
  type PeerEvent,
  playerSlot,
} from "../types.js";
import { parseBootstrap } from "./bootstrap.js";
import { parseLocalSaveResponse } from "./local-save-wire.js";
import { choice, finite, integer, isArray, isRecord, matchingText, record } from "./validation.js";

function isJson(value: unknown, ancestors: readonly object[]): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return isJsonObject(value, ancestors);
}

function isJsonObject(value: unknown, ancestors: readonly object[]): value is JsonValue {
  if (!isArray(value) && !isRecord(value)) return false;
  if (ancestors.includes(value)) return false;
  return Object.values(value).every((child) => isJson(child, [...ancestors, value]));
}

export function jsonValue(value: unknown): JsonValue {
  if (!isJson(value, []))
    throw new TypeError("Peer payload must be JSON-compatible and must not contain cycles");
  return value;
}

export function controlEvent(value: unknown): ControlEvent {
  const message = "Invalid semantic control event";
  const event = record(value, message);
  return {
    control: matchingText(event.control, /^[a-z][a-z0-9-]{0,31}$/, message),
    player: playerSlot(integer(event.player, [0, 15], message)),
    phase: choice(event.phase, ["pressed", "released", "changed"], message),
    value: finite(event.value, message),
    sequence: integer(event.sequence, [0, Number.MAX_VALUE], message),
  };
}

function peerEvent(value: unknown): PeerEvent {
  const message = "Invalid Local Peer Message envelope";
  const event = record(value, message);
  return {
    channel: matchingText(event.channel, /^[a-z][a-z0-9-]{0,31}$/, message),
    source: choice(event.source, ["main", "companion"], message),
    payload: jsonValue(event.payload),
  };
}

function bootstrapMessage(source: Readonly<Record<string, unknown>>): HostInboundMessage {
  return {
    kind: "bootstrap",
    requestId: matchingText(source.requestId, /.+/, "Invalid bootstrap response request ID"),
    bootstrap: parseBootstrap(source.bootstrap),
  };
}

/** The bridge accepts unknown data; successful results are constructed, never cast. */
export function parseMessage(value: unknown): HostInboundMessage {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return decodeMessage(record(parsed, "The Host Bridge delivered an invalid message"));
}

function decodeMessage(source: Readonly<Record<string, unknown>>): HostInboundMessage {
  switch (source.kind) {
    case "local-save-result":
      return parseLocalSaveResponse(source);
    case "bootstrap":
      return bootstrapMessage(source);
    case "control":
      return { kind: "control", event: controlEvent(source.event) };
    case "peer":
      return { kind: "peer", event: peerEvent(source.event) };
    case "lifecycle":
      return {
        kind: "lifecycle",
        state: choice(
          source.state,
          ["active", "suspended", "stopped"],
          "The Host Bridge delivered an unsupported message",
        ),
      };
    default:
      throw new TypeError("The Host Bridge delivered an unsupported message");
  }
}
