import { validateManifest, type WebGameManifest } from "./manifest.js";
import {
  SurfaceRole,
  playerSlot,
  type ControlEvent,
  type GameBootstrap,
  type HostInboundMessage,
  type HostOutboundMessage,
  type JsonValue,
} from "./types.js";

export interface PreviewDelivery {
  readonly target: SurfaceRole;
  readonly message: HostInboundMessage;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assertJson(value: unknown, seen = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Local Peer Message payload contains a cycle");
    seen.add(value);
    for (const child of value) assertJson(child, seen);
    seen.delete(value);
    return;
  }
  const record = objectRecord(value);
  if (!record || seen.has(record)) throw new TypeError("Local Peer Message payload must be JSON");
  seen.add(record);
  for (const child of Object.values(record)) assertJson(child, seen);
  seen.delete(record);
}

function parseControl(value: unknown): ControlEvent {
  const event = objectRecord(value);
  if (
    !event ||
    typeof event.control !== "string" ||
    !Number.isInteger(event.player) ||
    (event.player as number) < 0 ||
    (event.player as number) > 15 ||
    (event.phase !== "pressed" && event.phase !== "released" && event.phase !== "changed") ||
    typeof event.value !== "number" ||
    !Number.isFinite(event.value) ||
    !Number.isInteger(event.sequence) ||
    (event.sequence as number) < 0
  ) throw new TypeError("Invalid preview semantic control event");
  return event as unknown as ControlEvent;
}

function parseOutbound(value: string | unknown): HostOutboundMessage {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  const message = objectRecord(parsed);
  if (!message || typeof message.kind !== "string") throw new TypeError("Invalid Host Bridge message");
  return parsed as HostOutboundMessage;
}

function other(role: SurfaceRole): SurfaceRole {
  return role === SurfaceRole.Main ? SurfaceRole.Companion : SurfaceRole.Main;
}

/** Local-only Host Bridge policy used by the browser preview shell. */
export class PreviewRouter {
  readonly manifest: WebGameManifest;
  readonly #bootstraps: Readonly<Record<SurfaceRole, GameBootstrap>>;

  constructor(input: unknown) {
    const manifest = validateManifest(input);
    this.manifest = manifest;
    const localPlayerCount = Math.min(4, manifest.players.maxLocalSlots);
    const players = Array.from({ length: localPlayerCount }, (_, index) => ({
      slot: playerSlot(index),
      displayName: `Player ${index + 1}`,
      local: true,
    }));
    const shared = {
      protocolVersion: 1 as const,
      game: {
        id: manifest.packageId,
        version: manifest.version,
        instanceId: "local-browser-preview",
      },
      players,
      controls: manifest.controls,
      limits: { maxLocalPeerMessageBytes: manifest.budgets.maxLocalPeerMessageBytes },
    };
    this.#bootstraps = {
      main: {
        ...shared,
        surface: SurfaceRole.Main,
        controlledPlayerSlots: players[0] ? [players[0].slot] : [],
        render: manifest.displays.main,
      },
      companion: {
        ...shared,
        surface: SurfaceRole.Companion,
        controlledPlayerSlots: players[1] ? [players[1].slot] : [],
        render: manifest.displays.companion,
      },
    };
  }

  bootstrap(role: SurfaceRole): GameBootstrap {
    return this.#bootstraps[role];
  }

  route(source: SurfaceRole, wireMessage: string | unknown): readonly PreviewDelivery[] {
    const message = parseOutbound(wireMessage);
    if (message.kind === "bootstrap-request") {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId)) {
        throw new TypeError("Invalid bootstrap requestId");
      }
      return [
        {
          target: source,
          message: { kind: "bootstrap", requestId: message.requestId, bootstrap: this.bootstrap(source) },
        },
      ];
    }
    if (message.kind === "ready") {
      if (message.surface !== source) throw new TypeError("Ready message claims the wrong Surface Role");
      return [{ target: source, message: { kind: "lifecycle", state: "active" } }];
    }
    if (message.kind === "control") {
      const event = parseControl(message.event);
      if (!this.manifest.controls.some((control) => control.id === event.control)) {
        throw new TypeError(`Unknown preview semantic control: ${event.control}`);
      }
      if (!this.bootstrap(source).controlledPlayerSlots.includes(event.player)) {
        throw new TypeError(`Preview Player Slot ${event.player} is not controlled by this surface`);
      }
      return [{ target: other(source), message: { kind: "control", event } }];
    }
    if (message.kind === "peer") {
      if (!this.manifest.capabilities.includes("same-device-peer")) {
        throw new TypeError("Game Package did not request the same-device-peer capability");
      }
      if (message.source !== source || !/^[a-z][a-z0-9-]{0,31}$/.test(message.channel)) {
        throw new TypeError("Invalid preview Local Peer Message envelope");
      }
      assertJson(message.payload);
      const size = new TextEncoder().encode(JSON.stringify(message.payload)).byteLength;
      if (size > this.manifest.budgets.maxLocalPeerMessageBytes) {
        throw new TypeError("Preview Local Peer Message exceeds the manifest budget");
      }
      return [
        {
          target: other(source),
          message: {
            kind: "peer",
            event: { channel: message.channel, payload: message.payload, source },
          },
        },
      ];
    }
    throw new TypeError("Unsupported preview Host Bridge message");
  }
}
