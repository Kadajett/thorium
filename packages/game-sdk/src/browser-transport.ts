import type {
  GameBootstrap,
  HostInboundMessage,
  HostOutboundMessage,
  HostTransport,
} from "./types.js";
import { parseMessage } from "./core/bridge-message.js";
import { isRecord } from "./core/validation.js";
import { createListeners } from "./listeners.js";

declare global {
  interface Window {
    thoriumHost?: { postMessage(message: string): void };
    __thoriumReceive?: (message: string | HostInboundMessage) => void;
  }
}

/** Replaceable browser adapter surface; tests need not pretend to implement a full Window. */
export interface BrowserBridgeWindow {
  thoriumHost?: { postMessage(message: string): void };
  __thoriumReceive?: (message: string | HostInboundMessage) => void;
  readonly addEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
}

function attachReceiver(
  bridgeWindow: BrowserBridgeWindow,
  deliver: (value: unknown) => void,
): void {
  const previous = bridgeWindow.__thoriumReceive;
  bridgeWindow.__thoriumReceive = (message) => {
    previous?.(message);
    deliver(message);
  };
  bridgeWindow.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (isRecord(event.data) && event.data.source === "thorium-host") deliver(event.data.message);
  });
}

function requestBootstrap(transport: HostTransport, timeoutMs: number): Promise<GameBootstrap> {
  const requestId = "bootstrap-1";
  return new Promise((resolve, reject) => {
    const unsubscribe = transport.subscribe((message) => {
      if (message.kind !== "bootstrap" || message.requestId !== requestId) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(message.bootstrap);
    });
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(
        new Error("Host Bridge bootstrap response timed out after " + String(timeoutMs) + "ms"),
      );
    }, timeoutMs);
    transport.send({ kind: "bootstrap-request", requestId });
  });
}

/** Browser effects around the validated message core; native host owns origin checks. */
export function createBrowserHostTransport(
  bridgeWindow: BrowserBridgeWindow = window,
  timeoutMs = 5_000,
): HostTransport {
  const listeners = createListeners<HostInboundMessage>();
  let bootstrap: Promise<GameBootstrap> | undefined;
  const transport: HostTransport = {
    readBootstrap() {
      if (bridgeWindow.thoriumHost === undefined)
        throw new Error(
          "Thorium host bridge is missing. Supply a development HostTransport when running in a normal browser.",
        );
      bootstrap ??= requestBootstrap(transport, timeoutMs);
      return bootstrap;
    },
    send(message: HostOutboundMessage) {
      if (bridgeWindow.thoriumHost === undefined) throw new Error("Thorium host bridge is missing");
      bridgeWindow.thoriumHost.postMessage(JSON.stringify(message));
    },
    subscribe: listeners.listen,
  };
  attachReceiver(bridgeWindow, (value) => {
    listeners.emit(parseMessage(value));
  });
  return transport;
}

/** Constructible compatibility adapter; new code should use createBrowserHostTransport. */
export class BrowserHostTransport implements HostTransport {
  readonly readBootstrap: HostTransport["readBootstrap"];
  readonly send: HostTransport["send"];
  readonly subscribe: HostTransport["subscribe"];

  constructor(bridgeWindow: BrowserBridgeWindow = window, timeoutMs = 5_000) {
    const transport = createBrowserHostTransport(bridgeWindow, timeoutMs);
    this.readBootstrap = transport.readBootstrap;
    this.send = transport.send;
    this.subscribe = transport.subscribe;
  }
}
