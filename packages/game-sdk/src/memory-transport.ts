import { createListeners } from "./listeners.js";
import type {
  GameBootstrap,
  HostInboundMessage,
  HostOutboundMessage,
  HostTransport,
} from "./types.js";
function inbound(message: HostOutboundMessage): HostInboundMessage | undefined {
  if (message.kind === "control") return { kind: "control", event: message.event };
  if (message.kind === "peer")
    return {
      kind: "peer",
      event: {
        channel: message.channel,
        payload: message.payload,
        source: message.source,
      },
    };
  return undefined;
}
export function createMemoryTransport(bootstrap: GameBootstrap) {
  const listeners = createListeners<HostInboundMessage>();
  let peer: ((message: HostInboundMessage) => void) | undefined;
  const transport: HostTransport = {
    readBootstrap: () => Promise.resolve(bootstrap),
    subscribe: listeners.listen,
    send(message) {
      const delivery = inbound(message);
      if (delivery !== undefined) peer?.(delivery);
    },
  };
  return {
    transport,
    deliver: listeners.emit,
    connect: (deliver: (message: HostInboundMessage) => void) => {
      peer = deliver;
    },
  };
}
