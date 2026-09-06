import { createPreviewRouter, type PreviewConnection } from "./preview.js";
import type { SurfaceRole } from "./types.js";
import { isRecord } from "./core/validation.js";
type Frames = Readonly<Record<SurfaceRole, HTMLIFrameElement>>;
type Incoming = Readonly<{ source: SurfaceRole; message: unknown }>;
type BrowserMessage = MessageEvent<unknown>;
type Channel = {
  router: PreviewConnection | undefined;
  pending: Incoming[];
  frames: Frames;
  status: HTMLElement;
};
function frame(id: SurfaceRole): HTMLIFrameElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLIFrameElement)) throw new Error("Preview surface is missing");
  return element;
}
function incoming(frames: Frames, event: BrowserMessage): Incoming | undefined {
  if (event.origin !== location.origin) return undefined;
  const envelope = clientEnvelope(event.data);
  if (envelope === undefined) return undefined;
  const source = sourceRole(frames, event.source);
  return source === undefined ? undefined : { source, message: envelope.message };
}
function clientEnvelope(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) return undefined;
  return value.source === "thorium-preview-client" ? value : undefined;
}
function sourceRole(frames: Frames, source: MessageEventSource | null): SurfaceRole | undefined {
  return (["main", "companion"] as const).find((role) => frames[role].contentWindow === source);
}
function dispatch(channel: Channel, event: Incoming): void {
  try {
    const deliveries = channel.router?.route(event.source, event.message) ?? [];
    for (const delivery of deliveries)
      channel.frames[delivery.target].contentWindow?.postMessage(
        { source: "thorium-preview-host", message: delivery.message },
        location.origin,
      );
    channel.status.textContent = "";
  } catch (error) {
    channel.status.textContent = error instanceof Error ? error.message : String(error);
  }
}
function receive(channel: Channel, event: MessageEvent<unknown>): void {
  const input = incoming(channel.frames, event);
  if (input === undefined) return;
  if (channel.router !== undefined) {
    dispatch(channel, input);
    return;
  }
  if (channel.pending.length < 100) channel.pending.push(input);
}
async function start(): Promise<void> {
  const status = document.getElementById("status");
  if (status === null) throw new Error("Preview status element missing");
  const channel: Channel = {
    frames: { main: frame("main"), companion: frame("companion") },
    status,
    router: undefined,
    pending: [],
  };
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    receive(channel, event);
  });
  const response = await fetch("/thorium.json");
  const manifest: unknown = await response.json();
  channel.router = createPreviewRouter(manifest);
  for (const event of channel.pending.splice(0)) dispatch(channel, event);
}
await start();
