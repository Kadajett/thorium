import type { LoadedGamePackage } from "./pack.js";
import { contentTypes, injectBridge } from "./preview-html.js";
import { hasUnsafeRawPath, packagePath } from "./core/preview-path.js";
type Files = ReadonlyMap<string, Uint8Array>;
export type PreviewAssets = Readonly<{
  support: Files;
  files: Files;
  entrypoints: LoadedGamePackage["manifest"]["runtime"]["entrypoints"];
}>;
export type Reply = Readonly<{ status: number; body: string | Uint8Array; type: string }>;
function error(status: number, message: string): Reply {
  return { status, body: message, type: "text/plain; charset=utf-8" };
}
function packageReply(pathname: string, assets: PreviewAssets): Reply {
  const name = packagePath(pathname);
  if (name === undefined) return error(400, "Invalid package path");
  const bytes = assets.files.get(name);
  if (bytes === undefined) return error(404, "Not found");
  const role =
    name === assets.entrypoints.main.path
      ? "main"
      : name === assets.entrypoints.companion.path
        ? "companion"
        : undefined;
  const body = role === undefined ? bytes : injectBridge(bytes, role);
  return {
    status: 200,
    body,
    type: contentTypes[name.slice(name.lastIndexOf("."))] ?? "application/octet-stream",
  };
}
function targetReply(url: URL, assets: PreviewAssets): Reply {
  if (url.pathname === "/__thorium/bridge.js") {
    const role = url.searchParams.get("surface");
    if (role !== "main" && role !== "companion") return error(400, "Invalid Surface Role");
  }
  const support = assets.support.get(url.pathname);
  if (support !== undefined) return supportReply(url.pathname, support);
  if (!url.pathname.startsWith("/package/")) return error(404, "Not found");
  return packageReply(url.pathname, assets);
}
function supportReply(path: string, body: Uint8Array): Reply {
  const type =
    path === "/"
      ? "text/html; charset=utf-8"
      : path === "/thorium.json"
        ? "application/json; charset=utf-8"
        : "text/javascript; charset=utf-8";
  return { status: 200, body, type };
}
export function previewReply(
  method: string | undefined,
  target: string,
  assets: PreviewAssets,
): Reply {
  if (method !== "GET" && method !== "HEAD") return error(405, "Method not allowed");
  if (hasUnsafeRawPath(target)) return error(400, "Invalid request path");
  try {
    return targetReply(new URL(target, "http://127.0.0.1"), assets);
  } catch {
    return error(400, "Bad request");
  }
}
