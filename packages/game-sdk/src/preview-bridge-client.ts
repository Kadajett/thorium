/** This type-only module is served as a classic script after removing tsc's empty export marker. */
import type {} from "./host.js";
function hostEnvelope(value: unknown): value is Readonly<{ source: string; message: unknown }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "source" in value &&
    "message" in value &&
    value.source === "thorium-preview-host"
  );
}
function receivePreview(event: MessageEvent<unknown>): void {
  if (event.source !== parent || event.origin !== location.origin || !hostEnvelope(event.data))
    return;
  if (event.data.message === undefined) return;
  const wire = JSON.stringify(event.data.message);
  window.__thoriumReceive?.(wire);
}
function previewBridge(role: string) {
  return Object.freeze({
    postMessage(message: string): void {
      if (typeof message !== "string")
        throw new TypeError("Host Bridge messages must be JSON strings");
      parent.postMessage(
        { source: "thorium-preview-client", surface: role, message },
        location.origin,
      );
    },
  });
}
function installPreviewBridge(): void {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) throw new Error("Preview bridge script is missing");
  const role = new URL(script.src).searchParams.get("surface");
  if (role !== "main" && role !== "companion") throw new Error("Invalid Surface Role");
  Object.defineProperty(window, "thoriumHost", {
    configurable: false,
    writable: false,
    value: previewBridge(role),
  });
  window.addEventListener("message", receivePreview);
}
installPreviewBridge();
