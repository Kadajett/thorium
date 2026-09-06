import type { WebGameManifest } from "../manifest.js";
import type { HostInboundMessage, HostOutboundMessage, SurfaceRole } from "../types.js";
import type { PreviewBootstraps } from "./preview-bootstrap.js";
export interface PreviewDelivery {
  readonly target: SurfaceRole;
  readonly message: HostInboundMessage;
}
type Preview = Readonly<{ manifest: WebGameManifest; bootstraps: PreviewBootstraps }>;
type Control = Extract<HostOutboundMessage, { kind: "control" }>;
type Peer = Extract<HostOutboundMessage, { kind: "peer" }>;
function other(role: SurfaceRole): SurfaceRole {
  return role === "main" ? "companion" : "main";
}
function control(
  preview: Preview,
  source: SurfaceRole,
  message: Control,
): readonly PreviewDelivery[] {
  const event = message.event;
  if (!preview.manifest.controls.some((control) => control.id === event.control))
    throw new TypeError(`Unknown preview semantic control: ${event.control}`);
  if (!preview.bootstraps[source].controlledPlayerSlots.includes(event.player))
    throw new TypeError(
      `Preview Player Slot ${String(event.player)} is not controlled by this surface`,
    );
  return [{ target: other(source), message }];
}
function peer(preview: Preview, source: SurfaceRole, message: Peer): readonly PreviewDelivery[] {
  if (!preview.manifest.capabilities.includes("same-device-peer"))
    throw new TypeError("Game Package did not request the same-device-peer capability");
  if (message.source !== source) throw new TypeError("Invalid preview Local Peer Message envelope");
  const size = new TextEncoder().encode(JSON.stringify(message.payload)).byteLength;
  if (size > preview.manifest.budgets.maxLocalPeerMessageBytes)
    throw new TypeError("Preview Local Peer Message exceeds the manifest budget");
  return [
    {
      target: other(source),
      message: {
        kind: "peer",
        event: {
          channel: message.channel,
          payload: message.payload,
          source,
        },
      },
    },
  ];
}
export function previewRoute(
  preview: Preview,
  source: SurfaceRole,
  message: HostOutboundMessage,
): readonly PreviewDelivery[] {
  switch (message.kind) {
    case "bootstrap-request":
      return [
        {
          target: source,
          message: {
            kind: "bootstrap",
            requestId: message.requestId,
            bootstrap: preview.bootstraps[source],
          },
        },
      ];
    case "ready":
      if (message.surface !== source)
        throw new TypeError("Ready message claims the wrong Surface Role");
      return [{ target: source, message: { kind: "lifecycle", state: "active" } }];
    case "control":
      return control(preview, source, message);
    case "peer":
      return peer(preview, source, message);
    case "local-save-request":
      return [
        {
          target: source,
          message: {
            kind: "local-save-result",
            protocolVersion: 1,
            requestId: message.requestId,
            status: "error",
            error: "unsupported",
          },
        },
      ];
  }
}
