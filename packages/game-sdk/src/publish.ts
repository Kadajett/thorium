import { canonicalJson, sha256 } from "./descriptor.js";
import { loadGamePackage, packGamePackage, type PackedGamePackage } from "./pack.js";
import {
  publisherEndpoint,
  checkPublishToken,
  checkPublishSize,
  type PublicationReceipt,
} from "./core/publication.js";
import { readPublicationReceipt } from "./publication-response.js";
export type { PublicationReceipt } from "./core/publication.js";
export interface PublishOptions {
  readonly platformUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}
function multipart(packed: PackedGamePackage, descriptor: string): FormData {
  checkPublishSize(Buffer.byteLength(descriptor), packed.archive.byteLength);
  const body = new FormData();
  body.set("descriptor", descriptor);
  body.set(
    "archive",
    new Blob([new Uint8Array(packed.archive)], { type: "application/zip" }),
    packed.descriptor.bundle.fileName,
  );
  return body;
}
async function send(endpoint: string, body: FormData, options: PublishOptions): Promise<Response> {
  try {
    return await (options.fetch ?? globalThis.fetch)(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.token}` },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error(
      "Publishing could not confirm a response. Check connectivity and retry the unchanged package; an exact retry is safe.",
    );
  }
}
/** Validate and publish immutable bytes. Credentials stay in the request header. */
export async function publishGame(
  manifestPath: string,
  options: PublishOptions,
): Promise<PublicationReceipt> {
  const endpoint = publisherEndpoint(options.platformUrl);
  checkPublishToken(options.token);
  const loaded = await loadGamePackage(manifestPath);
  if (loaded.manifest.multiplayer.requiresOnline === true)
    throw new Error(
      "This game requires an operator-deployed server module; self-service accepts web client packages.",
    );
  const packed = packGamePackage(loaded),
    descriptor = canonicalJson(packed.descriptor);
  const response = await send(endpoint, multipart(packed, descriptor), options);
  return readPublicationReceipt(response, {
    packageId: packed.descriptor.game.packageId,
    version: packed.descriptor.game.version,
    contentDigest: sha256(descriptor),
  });
}
