import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./descriptor.js";
import { loadGamePackage, packGamePackage } from "./pack.js";
import type { SurfaceRole } from "./types.js";

export interface PreviewServer {
  readonly url: string;
  close(): Promise<void>;
}

export interface PreviewServerOptions {
  readonly port?: number;
}

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
};

function packageUrl(packagePath: string): string {
  return `/package/${packagePath.split("/").map(encodeURIComponent).join("/")}`;
}

function shellHtml(main: string, companion: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Thorium local preview</title><style>
:root{color-scheme:dark;font:14px system-ui;background:#0a0c14;color:#eef}body{margin:0;padding:16px}
header{display:flex;align-items:baseline;gap:12px;margin-bottom:12px}h1{font-size:18px;margin:0}.badge{color:#ffca6a}
.surfaces{display:grid;grid-template-columns:1fr 1fr;gap:16px}.surface{min-width:0}.surface h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em}
iframe{display:block;width:100%;aspect-ratio:16/9;border:1px solid #31384d;background:#000}#status{white-space:pre-wrap;color:#ff8d8d}
</style></head><body><header><h1>Thorium dual-surface preview</h1><span class="badge">LOCAL DEVELOPMENT ONLY</span></header>
<div class="surfaces"><section class="surface"><h2>Main</h2><iframe id="main" data-role="main" src="${main}"></iframe></section>
<section class="surface"><h2>Companion</h2><iframe id="companion" data-role="companion" src="${companion}"></iframe></section></div>
<pre id="status" role="status"></pre><script type="module" src="/__thorium/shell.js"></script></body></html>`;
}

const shellScript = `import { PreviewRouter } from "/__thorium/preview.js";
const manifest = await fetch("/thorium.json").then((response) => response.json());
const router = new PreviewRouter(manifest);
const frames = { main: document.querySelector("#main"), companion: document.querySelector("#companion") };
const status = document.querySelector("#status");
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || event.data?.source !== "thorium-preview-client") return;
  const source = event.source === frames.main.contentWindow ? "main" : event.source === frames.companion.contentWindow ? "companion" : undefined;
  if (!source) return;
  try {
    for (const delivery of router.route(source, event.data.message)) {
      frames[delivery.target].contentWindow?.postMessage({ source: "thorium-preview-host", message: delivery.message }, location.origin);
    }
    status.textContent = "";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});`;

function bridgeScript(role: SurfaceRole): string {
  return `(() => {
  const role = ${JSON.stringify(role)};
  const origin = location.origin;
  Object.defineProperty(window, "thoriumHost", { configurable: false, writable: false, value: Object.freeze({
    postMessage(message) {
      if (typeof message !== "string") throw new TypeError("Host Bridge messages must be JSON strings");
      parent.postMessage({ source: "thorium-preview-client", surface: role, message }, origin);
    }
  }) });
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.origin !== origin || event.data?.source !== "thorium-preview-host") return;
    window.__thoriumReceive?.(event.data.message);
  });
})();`;
}

function injectBridge(html: Uint8Array, role: SurfaceRole): Uint8Array {
  const source = new TextDecoder().decode(html);
  const tag = `<script src="/__thorium/bridge.js?surface=${role}"></script>`;
  const injected = /<\/head\s*>/i.test(source)
    ? source.replace(/<\/head\s*>/i, `${tag}</head>`)
    : `${tag}${source}`;
  return new TextEncoder().encode(injected);
}

function send(response: ServerResponse, status: number, body: string | Uint8Array, type: string): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function hasUnsafeRawPath(requestTarget: string): boolean {
  const rawPath = requestTarget.split("?", 1)[0] ?? "";
  try {
    const decoded = decodeURIComponent(rawPath);
    return (
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      decoded.split("/").some((segment) => segment === "." || segment === "..")
    );
  } catch {
    return true;
  }
}

export async function startPreviewServer(
  manifestPath: string,
  options: PreviewServerOptions = {},
): Promise<PreviewServer> {
  const loaded = await loadGamePackage(manifestPath);
  packGamePackage(loaded);
  const files = new Map(loaded.files.map((file) => [file.path, file.bytes]));
  const manifestBytes = new TextEncoder().encode(canonicalJson(loaded.manifest));
  const previewModule = await readFile(fileURLToPath(new URL("./preview.js", import.meta.url)));
  const manifestModule = await readFile(fileURLToPath(new URL("./manifest.js", import.meta.url)));
  const typesModule = await readFile(fileURLToPath(new URL("./types.js", import.meta.url)));
  const entrypoints = loaded.manifest.runtime.entrypoints;
  const shell = shellHtml(packageUrl(entrypoints.main.path), packageUrl(entrypoints.companion.path));

  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "Method not allowed", "text/plain; charset=utf-8");
      return;
    }
    if (hasUnsafeRawPath(request.url ?? "/")) {
      send(response, 400, "Invalid request path", "text/plain; charset=utf-8");
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      send(response, 400, "Bad request", "text/plain; charset=utf-8");
      return;
    }
    const finish = (status: number, body: string | Uint8Array, type: string) =>
      request.method === "HEAD" ? send(response, status, "", type) : send(response, status, body, type);
    if (url.pathname === "/") return finish(200, shell, "text/html; charset=utf-8");
    if (url.pathname === "/thorium.json") return finish(200, manifestBytes, "application/json; charset=utf-8");
    if (url.pathname === "/__thorium/shell.js") return finish(200, shellScript, "text/javascript; charset=utf-8");
    if (url.pathname === "/__thorium/preview.js") return finish(200, previewModule, "text/javascript; charset=utf-8");
    if (url.pathname === "/__thorium/manifest.js") return finish(200, manifestModule, "text/javascript; charset=utf-8");
    if (url.pathname === "/__thorium/types.js") return finish(200, typesModule, "text/javascript; charset=utf-8");
    if (url.pathname === "/__thorium/bridge.js") {
      const role = url.searchParams.get("surface");
      if (role !== "main" && role !== "companion") return finish(400, "Invalid Surface Role", "text/plain; charset=utf-8");
      return finish(200, bridgeScript(role), "text/javascript; charset=utf-8");
    }
    if (!url.pathname.startsWith("/package/")) return finish(404, "Not found", "text/plain; charset=utf-8");
    let packagePath: string;
    try {
      const segments = url.pathname.slice("/package/".length).split("/").map(decodeURIComponent);
      if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\/]/.test(segment))) {
        return finish(400, "Invalid package path", "text/plain; charset=utf-8");
      }
      packagePath = segments.join("/");
    } catch {
      return finish(400, "Invalid package path", "text/plain; charset=utf-8");
    }
    const bytes = files.get(packagePath);
    if (!bytes) return finish(404, "Not found", "text/plain; charset=utf-8");
    const role =
      packagePath === entrypoints.main.path
        ? "main"
        : packagePath === entrypoints.companion.path
          ? "companion"
          : undefined;
    const body = role ? injectBridge(bytes, role) : bytes;
    const extension = packagePath.slice(packagePath.lastIndexOf("."));
    return finish(200, body, contentTypes[extension] ?? "application/octet-stream");
  });

  const port = options.port ?? 4173;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new RangeError("Preview port is invalid");
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
