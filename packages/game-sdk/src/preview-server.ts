import { createServer, type Server, type ServerResponse } from "node:http";
import { canonicalJson } from "./descriptor.js";
import { loadGamePackage, packGamePackage } from "./pack.js";
import { packageUrl, shellHtml } from "./preview-html.js";
import { previewModules } from "./preview-modules.js";
import { previewReply, type PreviewAssets, type Reply } from "./preview-response.js";
export interface PreviewServer {
  readonly url: string;
  close(): Promise<void>;
}
export interface PreviewServerOptions {
  readonly port?: number;
}
async function loadAssets(manifestPath: string): Promise<PreviewAssets> {
  const loaded = await loadGamePackage(manifestPath);
  packGamePackage(loaded);
  const entrypoints = loaded.manifest.runtime.entrypoints,
    encoder = new TextEncoder();
  const shell = shellHtml(
    packageUrl(entrypoints.main.path),
    packageUrl(entrypoints.companion.path),
  );
  const support = new Map(await previewModules());
  support.set("/", encoder.encode(shell));
  support.set("/thorium.json", encoder.encode(canonicalJson(loaded.manifest)));
  return {
    support,
    entrypoints,
    files: new Map(loaded.files.map((file) => [file.path, file.bytes])),
  };
}
function send(response: ServerResponse, reply: Reply, head: boolean): void {
  response.writeHead(reply.status, {
    "Cache-Control": "no-store",
    "Content-Type": reply.type,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(head ? "" : reply.body);
}
async function listen(server: Server, port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new RangeError("Preview port is invalid");
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
export async function startPreviewServer(
  manifestPath: string,
  options: PreviewServerOptions = {},
): Promise<PreviewServer> {
  const assets = await loadAssets(manifestPath);
  const server = createServer((request, response) => {
    send(
      response,
      previewReply(request.method, request.url ?? "/", assets),
      request.method === "HEAD",
    );
  });
  await listen(server, options.port ?? 4173);
  return { url: serverUrl(server), close: () => close(server) };
}
function serverUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Preview has no TCP address");
  return `http://127.0.0.1:${String(address.port)}`;
}
