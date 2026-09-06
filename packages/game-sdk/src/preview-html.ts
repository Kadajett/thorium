import type { SurfaceRole } from "./types.js";
export const contentTypes: Readonly<Record<string, string>> = {
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

export function packageUrl(packagePath: string): string {
  return `/package/${packagePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function shellHtml(main: string, companion: string): string {
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

export function injectBridge(html: Uint8Array, role: SurfaceRole): Uint8Array {
  const source = new TextDecoder().decode(html);
  const tag = `<script src="/__thorium/bridge.js?surface=${role}"></script>`;
  const injected = /<\/head\s*>/i.test(source)
    ? source.replace(/<\/head\s*>/i, `${tag}</head>`)
    : `${tag}${source}`;
  return new TextEncoder().encode(injected);
}
