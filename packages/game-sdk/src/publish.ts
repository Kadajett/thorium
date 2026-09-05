import { canonicalJson, sha256 } from "./descriptor.js";
import { loadGamePackage, packGamePackage } from "./pack.js";

export interface PublishOptions {
  readonly platformUrl: string;
  readonly token: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface PublicationReceipt {
  readonly status: "published" | "already-published";
  readonly release: {
    readonly packageId: string;
    readonly version: string;
    readonly contentDigest: string;
  };
}

const HTTP_ERRORS: Readonly<Record<number, string>> = {
  400: "The server rejected the package or descriptor.",
  401: "The publishing token is invalid or has been rotated.",
  403: "The publisher quota is exhausted.",
  409: "The package belongs to another publisher or this version has different content.",
  413: "The upload exceeds the server limit.",
  422: "This game requires an operator-deployed server module.",
  429: "Publishing is rate limited. Wait before retrying.",
  503: "Publishing is temporarily unavailable.",
};

/** Validate and publish immutable bytes. Credentials stay in the request header. */
export async function publishGame(
  manifestPath: string,
  options: PublishOptions,
): Promise<PublicationReceipt> {
  let endpoint: URL;
  try {
    endpoint = new URL(options.platformUrl);
  } catch {
    throw new Error("The platform URL must be an HTTPS origin.");
  }
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
    endpoint.pathname !== "/" || endpoint.search || endpoint.hash
  ) throw new Error("The platform URL must be an HTTPS origin without credentials or a path.");
  if (!/^thp_[A-Za-z0-9_-]{43}$/.test(options.token)) {
    throw new Error("Set THORIUM_PUBLISH_TOKEN to the scoped token from /v1/publishers/token.");
  }

  const loaded = await loadGamePackage(manifestPath);
  if (loaded.manifest.multiplayer.requiresOnline) {
    throw new Error("This game requires an operator-deployed server module; self-service accepts web client packages.");
  }
  const packed = packGamePackage(loaded);
  const descriptor = canonicalJson(packed.descriptor);
  if (Buffer.byteLength(descriptor) > 1024 * 1024 || packed.archive.byteLength > 90 * 1024 * 1024) {
    throw new Error("Publishing allows a descriptor up to 1 MiB and an archive up to 90 MiB.");
  }
  const body = new FormData();
  body.set("descriptor", descriptor);
  body.set("archive", new Blob([new Uint8Array(packed.archive)], { type: "application/zip" }), packed.descriptor.bundle.fileName);
  endpoint.pathname = "/v1/publisher/releases";
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.token}` },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("Publishing could not confirm a response. Check connectivity and retry the unchanged package; an exact retry is safe.");
  }
  if (response.status !== 200 && response.status !== 201) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Publishing failed (HTTP ${response.status}). ${HTTP_ERRORS[response.status] ?? "Check the platform and retry the unchanged package."}`);
  }

  // Never print arbitrary server bodies: a proxy can echo request credentials.
  let receipt: PublicationReceipt;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16_384) throw new Error();
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    receipt = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PublicationReceipt;
    if (
      receipt?.status !== (response.status === 201 ? "published" : "already-published") ||
      receipt.release?.packageId !== packed.descriptor.game.packageId ||
      receipt.release?.version !== packed.descriptor.game.version ||
      receipt.release?.contentDigest !== sha256(descriptor)
    ) throw new Error();
  } catch {
    throw new Error("The server returned an invalid publication receipt. Check the catalog before retrying the unchanged package.");
  }
  return {
    status: receipt.status,
    release: {
      packageId: receipt.release.packageId,
      version: receipt.release.version,
      contentDigest: receipt.release.contentDigest,
    },
  };
}
