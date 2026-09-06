import assert from "node:assert/strict";
import type { BrowserBridgeWindow } from "./browser-transport.js";
import type { GameBootstrap } from "./types.js";
function requestId(raw: string): string | undefined {
  const parsed: unknown = JSON.parse(raw);
  assert.ok(typeof parsed === "object" && parsed !== null && "kind" in parsed);
  if (parsed.kind !== "bootstrap-request") return undefined;
  assert.ok("requestId" in parsed && typeof parsed.requestId === "string");
  return parsed.requestId;
}
export function bootstrapWindow(bootstrap: GameBootstrap, deferred = false) {
  const sent: string[] = [];
  const bridge: BrowserBridgeWindow = {
    addEventListener: () => undefined,
    thoriumHost: {
      postMessage(raw) {
        sent.push(raw);
        const id = requestId(raw);
        if (id === undefined) return;
        const receive = () => {
          bridge.__thoriumReceive?.(
            JSON.stringify({
              kind: "bootstrap",
              requestId: id,
              bootstrap,
            }),
          );
        };
        if (deferred) queueMicrotask(receive);
        else receive();
      },
    },
  };
  return { bridge, sent };
}
