import {
  SurfaceRole,
  type ColyseusSessionTicket,
  type ControlEvent,
  type GameBootstrap,
  type GameHost,
  type HostInboundMessage,
  type HostOutboundMessage,
  type HostTransport,
  type JsonValue,
  type PeerEvent,
  type PublicGameBootstrap,
} from "./types.js";

declare global {
  interface Window {
    thoriumHost?: {
      postMessage(message: string): void;
    };
    __thoriumReceive?: (message: string | HostInboundMessage) => void;
  }
}

function parseMessage(value: string | HostInboundMessage): HostInboundMessage {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  const message = objectRecord(parsed);
  if (!message || typeof message.kind !== "string") {
    throw new TypeError("The Host Bridge delivered an invalid message");
  }
  if (message.kind === "bootstrap") {
    if (typeof message.requestId !== "string" || message.requestId.length === 0) {
      throw new TypeError("Invalid bootstrap response request ID");
    }
    assertBootstrap(message.bootstrap);
  } else if (message.kind === "control") assertControlEvent(message.event);
  else if (message.kind === "peer") assertPeerEvent(message.event);
  else if (
    message.kind !== "lifecycle" ||
    (message.state !== "active" && message.state !== "suspended" && message.state !== "stopped")
  ) throw new TypeError("The Host Bridge delivered an unsupported message");
  return parsed as HostInboundMessage;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assertControlEvent(value: unknown): asserts value is ControlEvent {
  const event = objectRecord(value);
  if (
    !event ||
    typeof event.control !== "string" ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(event.control) ||
    !Number.isInteger(event.player) ||
    (event.player as number) < 0 ||
    (event.player as number) > 15 ||
    (event.phase !== "pressed" && event.phase !== "released" && event.phase !== "changed") ||
    typeof event.value !== "number" ||
    !Number.isFinite(event.value) ||
    !Number.isInteger(event.sequence) ||
    (event.sequence as number) < 0
  ) throw new TypeError("Invalid semantic control event");
}

function assertJsonValue(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Peer payload must not contain cycles");
    seen.add(value);
    for (const child of value) assertJsonValue(child, seen);
    seen.delete(value);
    return;
  }
  const object = objectRecord(value);
  if (!object || seen.has(object)) throw new TypeError("Peer payload must be JSON-compatible");
  seen.add(object);
  for (const child of Object.values(object)) assertJsonValue(child, seen);
  seen.delete(object);
}

function assertPeerEvent(value: unknown): asserts value is PeerEvent {
  const event = objectRecord(value);
  if (
    !event ||
    typeof event.channel !== "string" ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(event.channel) ||
    (event.source !== SurfaceRole.Main && event.source !== SurfaceRole.Companion)
  ) throw new TypeError("Invalid Local Peer Message envelope");
  assertJsonValue(event.payload);
}

/** Transport used inside the Android WebViews. The native host owns origin checks. */
export class BrowserHostTransport implements HostTransport {
  readonly #listeners = new Set<(message: HostInboundMessage) => void>();
  readonly #window: Window;
  readonly #bootstrapTimeoutMs: number;
  #bootstrapPromise: Promise<GameBootstrap> | undefined;
  #requestSequence = 0;

  constructor(bridgeWindow: Window = window, bootstrapTimeoutMs = 5_000) {
    this.#window = bridgeWindow;
    this.#bootstrapTimeoutMs = bootstrapTimeoutMs;
    const previous = bridgeWindow.__thoriumReceive;
    bridgeWindow.__thoriumReceive = (message) => {
      previous?.(message);
      this.#deliver(message);
    };
    bridgeWindow.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "source" in data &&
        data.source === "thorium-host" &&
        "message" in data
      ) {
        this.#deliver(data.message as string | HostInboundMessage);
      }
    });
  }

  readBootstrap(): Promise<GameBootstrap> {
    if (!this.#window.thoriumHost) {
      throw new Error(
        "Thorium host bridge is missing. Supply a development HostTransport when running in a normal browser.",
      );
    }
    if (!this.#bootstrapPromise) this.#bootstrapPromise = this.#requestBootstrap();
    return this.#bootstrapPromise;
  }

  send(message: HostOutboundMessage): void {
    if (!this.#window.thoriumHost) {
      throw new Error("Thorium host bridge is missing");
    }
    this.#window.thoriumHost.postMessage(JSON.stringify(message));
  }

  subscribe(listener: (message: HostInboundMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #deliver(value: string | HostInboundMessage): void {
    const message = parseMessage(value);
    for (const listener of this.#listeners) listener(message);
  }

  #requestBootstrap(): Promise<GameBootstrap> {
    const requestId = `bootstrap-${++this.#requestSequence}`;
    return new Promise<GameBootstrap>((resolve, reject) => {
      const unsubscribe = this.subscribe((message) => {
        if (message.kind !== "bootstrap" || message.requestId !== requestId) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(message.bootstrap);
      });
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Host Bridge bootstrap response timed out after ${this.#bootstrapTimeoutMs}ms`));
      }, this.#bootstrapTimeoutMs);
      this.send({ kind: "bootstrap-request", requestId });
    });
  }
}

export class HostClient implements GameHost {
  readonly bootstrap: PublicGameBootstrap;
  readonly #transport: HostTransport;
  readonly #controlListeners = new Set<(event: ControlEvent) => void>();
  readonly #peerListeners = new Map<string, Set<(event: PeerEvent) => void>>();
  readonly #lifecycleListeners = new Set<(state: "active" | "suspended" | "stopped") => void>();
  readonly #pendingPeerMessages: HostOutboundMessage[] = [];
  #colyseusTicket: ColyseusSessionTicket | undefined;
  #sequence = 0;
  #ticketTaken = false;

  constructor(bootstrap: GameBootstrap, transport: HostTransport) {
    assertBootstrap(bootstrap);
    this.bootstrap = publicBootstrap(bootstrap);
    this.#colyseusTicket = bootstrap.colyseus === undefined
      ? undefined
      : {
          endpoint: bootstrap.colyseus.endpoint,
          roomName: bootstrap.colyseus.roomName,
          ...(bootstrap.colyseus.roomId === undefined ? {} : { roomId: bootstrap.colyseus.roomId }),
          ticket: bootstrap.colyseus.ticket,
          expiresAtEpochMs: bootstrap.colyseus.expiresAtEpochMs,
          joinOptions: { ...bootstrap.colyseus.joinOptions },
        };
    this.#transport = transport;
    transport.subscribe((message) => {
      if (message.kind === "control") {
        for (const listener of this.#controlListeners) listener(message.event);
      } else if (message.kind === "peer") {
        if (
          new TextEncoder().encode(JSON.stringify(message.event.payload)).byteLength >
          this.bootstrap.limits.maxLocalPeerMessageBytes
        ) throw new Error("Inbound Local Peer Message exceeds the negotiated limit");
        for (const listener of this.#peerListeners.get(message.event.channel) ?? []) {
          listener(message.event);
        }
      } else if (message.kind === "lifecycle") {
        for (const listener of this.#lifecycleListeners) listener(message.state);
      }
    });
  }

  emitControl(event: Omit<ControlEvent, "sequence">): void {
    if (!this.bootstrap.controlledPlayerSlots.includes(event.player)) {
      throw new Error(`PlayerSlot ${event.player} is not controlled by this surface`);
    }
    if (!this.bootstrap.controls.some((control) => control.id === event.control)) {
      throw new Error(`Unknown semantic control: ${event.control}`);
    }
    if (
      (event.phase !== "pressed" && event.phase !== "released" && event.phase !== "changed") ||
      !Number.isFinite(event.value)
    ) throw new TypeError("Invalid semantic control value");
    this.#transport.send({
      kind: "control",
      event: { ...event, sequence: this.#sequence++ },
    });
  }

  onControl(listener: (event: ControlEvent) => void): () => void {
    this.#controlListeners.add(listener);
    return () => this.#controlListeners.delete(listener);
  }

  sendToPeer(channel: string, payload: JsonValue): void {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(channel)) {
      throw new Error(`Invalid peer channel: ${channel}`);
    }
    assertJsonValue(payload);
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    if (encoded.byteLength > this.bootstrap.limits.maxLocalPeerMessageBytes) {
      throw new Error(
        `Local Peer Message exceeds ${this.bootstrap.limits.maxLocalPeerMessageBytes} bytes`,
      );
    }
    this.#pendingPeerMessages.push({
      kind: "peer",
      channel,
      payload,
      source: this.bootstrap.surface,
    });
  }

  /** Runtime hook: coalesces local peer bridge crossings to the surface frame rate. */
  flushPeerMessages(): void {
    for (const message of this.#pendingPeerMessages.splice(0)) this.#transport.send(message);
  }

  onPeer(channel: string, listener: (event: PeerEvent) => void): () => void {
    const listeners = this.#peerListeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.#peerListeners.set(channel, listeners);
    return () => listeners.delete(listener);
  }

  onLifecycle(listener: (state: "active" | "suspended" | "stopped") => void): () => void {
    this.#lifecycleListeners.add(listener);
    return () => this.#lifecycleListeners.delete(listener);
  }

  takeColyseusTicket(): ColyseusSessionTicket | undefined {
    if (this.#ticketTaken) {
      throw new Error("The Colyseus session ticket has already been claimed by this surface");
    }
    this.#ticketTaken = true;
    const ticket = this.#colyseusTicket;
    this.#colyseusTicket = undefined;
    if (ticket && ticket.expiresAtEpochMs <= Date.now()) {
      throw new Error("The Colyseus session ticket has expired");
    }
    return ticket;
  }

  ready(): void {
    this.#transport.send({ kind: "ready", surface: this.bootstrap.surface });
  }
}

function publicBootstrap(bootstrap: GameBootstrap): PublicGameBootstrap {
  return Object.freeze({
    protocolVersion: bootstrap.protocolVersion,
    surface: bootstrap.surface,
    game: Object.freeze({
      id: bootstrap.game.id,
      version: bootstrap.game.version,
      instanceId: bootstrap.game.instanceId,
    }),
    players: Object.freeze(bootstrap.players.map((player) => Object.freeze({
      slot: player.slot,
      displayName: player.displayName,
      local: player.local,
    }))),
    controlledPlayerSlots: Object.freeze([...bootstrap.controlledPlayerSlots]),
    controls: Object.freeze(bootstrap.controls.map((control) => Object.freeze({
      id: control.id,
      label: control.label,
      kind: control.kind,
    }))),
    render: Object.freeze({
      logicalWidth: bootstrap.render.logicalWidth,
      logicalHeight: bootstrap.render.logicalHeight,
      maximumDevicePixelRatio: bootstrap.render.maximumDevicePixelRatio,
    }),
    limits: Object.freeze({
      maxLocalPeerMessageBytes: bootstrap.limits.maxLocalPeerMessageBytes,
    }),
  });
}

export async function createHostClient(
  transport: HostTransport = new BrowserHostTransport(),
): Promise<HostClient> {
  const bootstrap = await transport.readBootstrap();
  assertBootstrap(bootstrap);
  return new HostClient(bootstrap, transport);
}

export function assertBootstrap(value: unknown): asserts value is GameBootstrap {
  const bootstrap = objectRecord(value) as Partial<GameBootstrap> | undefined;
  if (!bootstrap) throw new TypeError("Missing bootstrap object");
  if (bootstrap.protocolVersion !== 1) throw new TypeError("Unsupported host protocol version");
  if (bootstrap.surface !== SurfaceRole.Main && bootstrap.surface !== SurfaceRole.Companion) {
    throw new TypeError("Bootstrap surface must be main or companion");
  }
  if (!Array.isArray(bootstrap.players) || !Array.isArray(bootstrap.controls)) {
    throw new TypeError("Bootstrap must include players and controls");
  }
  if (!Array.isArray(bootstrap.controlledPlayerSlots)) {
    throw new TypeError("Bootstrap must include surface-controlled Player Slots");
  }
  if (
    !bootstrap.game ||
    typeof bootstrap.game.id !== "string" ||
    typeof bootstrap.game.version !== "string" ||
    typeof bootstrap.game.instanceId !== "string" ||
    bootstrap.game.instanceId.length === 0
  ) throw new TypeError("Bootstrap must identify the Game Release and Game Session instance");
  const slots = new Set<number>();
  for (const player of bootstrap.players) {
    if (
      !Number.isInteger(player.slot) ||
      player.slot < 0 ||
      player.slot > 15 ||
      slots.has(player.slot) ||
      typeof player.displayName !== "string" ||
      typeof player.local !== "boolean"
    ) throw new TypeError("Bootstrap includes an invalid or duplicate Player Slot");
    slots.add(player.slot);
  }
  const controlledSlots = new Set<number>();
  for (const slot of bootstrap.controlledPlayerSlots) {
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > 15 ||
      controlledSlots.has(slot) ||
      !bootstrap.players.some((player) => player.local && player.slot === slot)
    ) throw new TypeError("Bootstrap includes an invalid, duplicate, or non-local controlled Player Slot");
    controlledSlots.add(slot);
  }
  for (const control of bootstrap.controls) {
    if (
      !/^[a-z][a-z0-9-]{0,31}$/.test(control.id) ||
      typeof control.label !== "string" ||
      (control.kind !== "button" && control.kind !== "axis")
    ) throw new TypeError("Bootstrap includes an invalid semantic control");
  }
  if (
    !bootstrap.render ||
    !Number.isFinite(bootstrap.render.logicalWidth) ||
    !Number.isFinite(bootstrap.render.logicalHeight) ||
    !Number.isFinite(bootstrap.render.maximumDevicePixelRatio) ||
    bootstrap.render.logicalWidth <= 0 ||
    bootstrap.render.logicalHeight <= 0 ||
    bootstrap.render.maximumDevicePixelRatio < 1 ||
    bootstrap.render.maximumDevicePixelRatio > 3
  ) {
    throw new TypeError("Bootstrap must include a positive logical render size");
  }
  if (
    !bootstrap.limits ||
    !Number.isInteger(bootstrap.limits.maxLocalPeerMessageBytes) ||
    bootstrap.limits.maxLocalPeerMessageBytes < 1
  ) throw new TypeError("Bootstrap must include a Local Peer Message limit");
  if (bootstrap.colyseus) {
    const endpoint = new URL(bootstrap.colyseus.endpoint);
    const joinOptions = objectRecord(bootstrap.colyseus.joinOptions);
    const joinOptionKeys = joinOptions ? Object.keys(joinOptions).sort() : [];
    if (
      (endpoint.protocol !== "https:" && endpoint.protocol !== "wss:") ||
      (typeof bootstrap.colyseus.roomName !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(bootstrap.colyseus.roomName)) ||
      bootstrap.colyseus.ticket.length === 0 ||
      !Number.isFinite(bootstrap.colyseus.expiresAtEpochMs) ||
      !joinOptions ||
      joinOptionKeys.join(",") !== "gameSessionId,packageDigest,packageId,packageVersion" ||
      typeof joinOptions.gameSessionId !== "string" ||
      joinOptions.gameSessionId !== bootstrap.game.instanceId ||
      typeof joinOptions.packageId !== "string" ||
      joinOptions.packageId !== bootstrap.game.id ||
      typeof joinOptions.packageVersion !== "string" ||
      joinOptions.packageVersion !== bootstrap.game.version ||
      typeof joinOptions.packageDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(joinOptions.packageDigest)
    ) throw new TypeError("Bootstrap includes an invalid Colyseus session capability");
  }
}
