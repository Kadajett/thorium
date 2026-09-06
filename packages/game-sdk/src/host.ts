import { createBrowserHostTransport } from "./browser-transport.js";
import { createLocalSaveClient } from "./local-save.js";
import { parseBootstrap, publicBootstrap } from "./core/bootstrap.js";
import { claimTicket, controlMessage, initialHostState, peerMessage } from "./core/host-state.js";
import { createChannels, createListeners } from "./listeners.js";
import type {
  ColyseusSessionTicket,
  ControlEvent,
  GameBootstrap,
  GameHost,
  HostInboundMessage,
  HostOutboundMessage,
  HostTransport,
  JsonValue,
  PeerEvent,
  PublicGameBootstrap,
} from "./types.js";

export { BrowserHostTransport, createBrowserHostTransport } from "./browser-transport.js";

type Lifecycle = "active" | "suspended" | "stopped";

export interface HostConnection extends GameHost {
  readonly flushPeerMessages: () => void;
  readonly onLifecycle: (listener: (state: Lifecycle) => void) => () => void;
  readonly ready: () => void;
}

function checkPeerSize(payload: JsonValue, maximum: number, inbound = false): void {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength <= maximum) return;
  throw new Error(
    inbound
      ? "Inbound Local Peer Message exceeds the negotiated limit"
      : "Local Peer Message exceeds " + String(maximum) + " bytes",
  );
}

function createControlEmitter(bootstrap: PublicGameBootstrap, transport: HostTransport) {
  let sequence = 0;
  return (event: Omit<ControlEvent, "sequence">): void => {
    const message = controlMessage(bootstrap, event, sequence);
    sequence += 1;
    transport.send(message);
  };
}

function createPeerQueue(bootstrap: PublicGameBootstrap, transport: HostTransport) {
  let pending: readonly HostOutboundMessage[] = [];
  return {
    sendToPeer(channel: string, payload: JsonValue): void {
      const message = peerMessage(bootstrap, channel, payload);
      checkPeerSize(payload, bootstrap.limits.maxLocalPeerMessageBytes);
      pending = [...pending, message];
    },
    flushPeerMessages(): void {
      const messages = pending;
      pending = [];
      messages.forEach((message) => {
        transport.send(message);
      });
    },
  };
}

function createTicketReader(bootstrap: GameBootstrap) {
  let state = initialHostState(bootstrap);
  return (): ColyseusSessionTicket | undefined => {
    const result = claimTicket(state);
    state = result.state;
    if (result.ticket !== undefined && result.ticket.expiresAtEpochMs <= Date.now()) {
      throw new Error("The Colyseus session ticket has expired");
    }
    return result.ticket;
  };
}

function hostEvents() {
  return {
    control: createListeners<ControlEvent>(),
    peer: createChannels<PeerEvent>(),
    lifecycle: createListeners<Lifecycle>(),
  };
}

function deliverMessage(
  events: ReturnType<typeof hostEvents>,
  bootstrap: PublicGameBootstrap,
  message: HostInboundMessage,
): void {
  switch (message.kind) {
    case "control":
      events.control.emit(message.event);
      return;
    case "peer":
      checkPeerSize(message.event.payload, bootstrap.limits.maxLocalPeerMessageBytes, true);
      events.peer.emit(message.event.channel, message.event);
      return;
    case "lifecycle":
      events.lifecycle.emit(message.state);
      return;
    case "bootstrap":
    case "local-save-result":
      return;
  }
}

/** Factory interface; private capabilities and mutable effects remain in closures. */
export function createHostClientFromBootstrap(
  input: GameBootstrap,
  transport: HostTransport,
): HostConnection {
  const parsed = parseBootstrap(input);
  const bootstrap = publicBootstrap(parsed);
  const events = hostEvents();
  transport.subscribe((message) => {
    deliverMessage(events, bootstrap, message);
  });
  return {
    bootstrap,
    ...(parsed.localSave === undefined
      ? {}
      : { localSave: createLocalSaveClient(transport, parsed.localSave) }),
    emitControl: createControlEmitter(bootstrap, transport),
    ...createPeerQueue(bootstrap, transport),
    takeColyseusTicket: createTicketReader(parsed),
    onControl: events.control.listen,
    onPeer: events.peer.listen,
    onLifecycle: events.lifecycle.listen,
    ready: () => {
      transport.send({ kind: "ready", surface: bootstrap.surface });
    },
  };
}

/** Constructible compatibility adapter only: all behavior lives in the factory. */
export class HostClient implements HostConnection {
  readonly localSave?: NonNullable<HostConnection["localSave"]>;
  readonly bootstrap: PublicGameBootstrap;
  readonly emitControl: HostConnection["emitControl"];
  readonly sendToPeer: HostConnection["sendToPeer"];
  readonly flushPeerMessages: HostConnection["flushPeerMessages"];
  readonly onControl: HostConnection["onControl"];
  readonly onPeer: HostConnection["onPeer"];
  readonly onLifecycle: HostConnection["onLifecycle"];
  readonly takeColyseusTicket: HostConnection["takeColyseusTicket"];
  readonly ready: HostConnection["ready"];

  constructor(bootstrap: GameBootstrap, transport: HostTransport) {
    const client = createHostClientFromBootstrap(bootstrap, transport);
    if (client.localSave !== undefined) this.localSave = client.localSave;
    this.bootstrap = client.bootstrap;
    this.emitControl = client.emitControl;
    this.sendToPeer = client.sendToPeer;
    this.flushPeerMessages = client.flushPeerMessages;
    this.onControl = client.onControl;
    this.onPeer = client.onPeer;
    this.onLifecycle = client.onLifecycle;
    this.takeColyseusTicket = client.takeColyseusTicket;
    this.ready = client.ready;
  }
}

export async function createHostClient(
  transport: HostTransport = createBrowserHostTransport(),
): Promise<HostClient> {
  return createHostClientFromBootstrap(await transport.readBootstrap(), transport);
}

export function assertBootstrap(value: unknown): asserts value is GameBootstrap {
  parseBootstrap(value);
}
