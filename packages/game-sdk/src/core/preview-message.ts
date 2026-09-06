import type { HostOutboundMessage } from "../types.js";
import { controlEvent, jsonValue } from "./bridge-message.js";
import { choice, matchingText, record, type UnknownRecord } from "./validation.js";
function decode(message: UnknownRecord): HostOutboundMessage {
  switch (message.kind) {
    case "bootstrap-request":
      return {
        kind: "bootstrap-request",
        requestId: matchingText(
          message.requestId,
          /^[a-zA-Z0-9_-]{1,80}$/,
          "Invalid bootstrap requestId",
        ),
      };
    case "ready":
      return {
        kind: "ready",
        surface: choice(
          message.surface,
          ["main", "companion"],
          "Ready message claims the wrong Surface Role",
        ),
      };
    case "control":
      return { kind: "control", event: controlEvent(message.event) };
    case "peer":
      return peerMessage(message);
    default:
      throw new TypeError("Unsupported preview Host Bridge message");
  }
}
function peerMessage(message: UnknownRecord): HostOutboundMessage {
  const error = "Invalid preview Local Peer Message envelope";
  return {
    kind: "peer",
    source: choice(message.source, ["main", "companion"], error),
    channel: matchingText(message.channel, /^[a-z][a-z0-9-]{0,31}$/, error),
    payload: jsonValue(message.payload),
  };
}
export function parseOutbound(value: unknown): HostOutboundMessage {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return decode(record(parsed, "Invalid Host Bridge message"));
}
