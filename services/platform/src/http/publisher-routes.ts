import type { Application, Request, Response } from "express";
import multer, { MulterError } from "multer";
import { isIP } from "node:net";
import {
  GameReleasePublicationError,
} from "../publication/game-release-publisher.js";
import {
  PublisherPackageOwnershipError,
  type PublisherPublicationService,
  PublisherQuotaError,
  PublisherServerModuleRequiredError,
} from "../publication/publisher-publication-service.js";
import {
  InvalidPublisherCredentialsError,
  type PublisherAccessService,
} from "../security/publisher-access-service.js";

const MAX_DESCRIPTOR_BYTES = 1_048_576;
// Leaves room for the descriptor and multipart framing below Cloudflare Free's
// 100 MB request-body ceiling. Offline operator imports retain the 128 MiB limit.
const MAX_ARCHIVE_BYTES = 90 * 1_024 * 1_024;
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1_024;

export interface PublisherHttpDependencies {
  readonly access: PublisherAccessService;
  readonly publication: PublisherPublicationService;
  readonly limits?: {
    readonly descriptorBytes?: number;
    readonly archiveBytes?: number;
    readonly exchangeAttempts?: number;
    readonly publishAttempts?: number;
    readonly windowMs?: number;
    readonly publisherPublishAttempts?: number;
    readonly publisherWindowMs?: number;
    readonly concurrentPublications?: number;
  };
}

interface HttpFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

interface AttemptBucket {
  count: number;
  startedAt: number;
}

export class PublisherRequestLimiter {
  readonly #buckets = new Map<string, AttemptBucket>();
  readonly #windowMs: number;
  readonly #maximumKeys: number;
  readonly #maximums: Readonly<Record<"exchange" | "publish", number>>;
  #lastSweep = 0;

  constructor(input: {
    readonly windowMs: number;
    readonly exchangeAttempts: number;
    readonly publishAttempts: number;
    readonly maximumKeys?: number;
  }) {
    this.#windowMs = input.windowMs;
    this.#maximumKeys = input.maximumKeys ?? 10_000;
    this.#maximums = {
      exchange: input.exchangeAttempts,
      publish: input.publishAttempts,
    };
  }

  attempt(kind: "exchange" | "publish", peer: string, now = Date.now()): number | undefined {
    const key = `${kind}\0${peer}`;
    const existing = this.#buckets.get(key);
    if (existing === undefined || now - existing.startedAt >= this.#windowMs) {
      if (now - this.#lastSweep >= this.#windowMs || this.#buckets.size >= this.#maximumKeys) {
        for (const [candidateKey, bucket] of this.#buckets) {
          if (now - bucket.startedAt >= this.#windowMs) this.#buckets.delete(candidateKey);
        }
        this.#lastSweep = now;
      }
      if (!this.#buckets.has(key) && this.#buckets.size >= this.#maximumKeys) {
        return Math.max(1, Math.ceil(this.#windowMs / 1_000));
      }
      this.#buckets.set(key, { count: 1, startedAt: now });
      return undefined;
    }
    existing.count += 1;
    if (existing.count <= this.#maximums[kind]) return undefined;
    return Math.max(1, Math.ceil((existing.startedAt + this.#windowMs - now) / 1_000));
  }
}

export class PublicationConcurrencyGate {
  readonly #maximum: number;
  #active = 0;

  constructor(maximum: number) {
    this.#maximum = maximum;
  }

  acquire(): (() => void) | undefined {
    if (this.#active >= this.#maximum) return undefined;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}

function sendFailure(response: Response, request: Request, failure: HttpFailure): void {
  response.setHeader("Cache-Control", "no-store");
  response.status(failure.status).json({
    error: { code: failure.code, message: failure.message },
    path: request.path,
  });
}

function invalidCredentials(response: Response, request: Request): void {
  response.setHeader("WWW-Authenticate", 'Basic realm="Thorium Publisher", charset="UTF-8"');
  sendFailure(response, request, {
    status: 401,
    code: "invalid_publisher_credentials",
    message: "The publisher credentials are invalid.",
  });
}

function invalidToken(response: Response, request: Request): void {
  response.setHeader("WWW-Authenticate", 'Bearer realm="Thorium Publisher"');
  sendFailure(response, request, {
    status: 401,
    code: "invalid_publish_token",
    message: "The publish token is invalid.",
  });
}

function parseBasicAuthorization(value: string | undefined): {
  readonly username: string;
  readonly password: string;
} | undefined {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(value ?? "");
  const encoded = match?.[1];
  if (encoded === undefined || encoded.length > 1_024) return undefined;
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
    || bytes.byteLength === 0
  ) return undefined;
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  const separator = decoded.indexOf(":");
  if (separator < 1) return undefined;
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

function parseBearerAuthorization(value: string | undefined): string | undefined {
  const match = /^Bearer ([^\s]+)$/i.exec(value ?? "");
  return match?.[1] !== undefined && match[1].length <= 128 ? match[1] : undefined;
}

function receiveUpload(
  request: Request,
  response: Response,
  parser: ReturnType<typeof multer>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    parser.single("archive")(request, response, (error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

function uploadFailure(error: unknown): HttpFailure | undefined {
  if (!(error instanceof Error)) return undefined;
  const tooLarge = error instanceof MulterError && error.code === "LIMIT_FILE_SIZE";
  return {
    status: tooLarge ? 413 : 400,
    code: tooLarge ? "archive_too_large" : "invalid_release_upload",
    message: tooLarge
      ? "The Game Package archive is too large."
      : "The release upload is invalid.",
  };
}

function requestPeer(request: Request): string {
  const cloudflareAddress = request.header("cf-connecting-ip")?.trim();
  if (
    cloudflareAddress !== undefined
    && cloudflareAddress.length <= 45
    && isIP(cloudflareAddress) !== 0
  ) return cloudflareAddress;
  return request.ip ?? request.socket.remoteAddress ?? "unknown-peer";
}

export function registerPublisherRoutes(
  app: Application,
  dependencies: PublisherHttpDependencies,
): void {
  const parser = multer({
    storage: multer.memoryStorage(),
    limits: {
      fieldNameSize: 64,
      fieldSize: dependencies.limits?.descriptorBytes ?? MAX_DESCRIPTOR_BYTES,
      fields: 1,
      files: 1,
      // busboy's partsLimit event is raised as the configured boundary is
      // reached, so allow the terminal count after the two required parts.
      parts: 3,
      fileSize: dependencies.limits?.archiveBytes ?? MAX_ARCHIVE_BYTES,
    },
  });
  const limiter = new PublisherRequestLimiter({
    windowMs: dependencies.limits?.windowMs ?? 60_000,
    exchangeAttempts: dependencies.limits?.exchangeAttempts ?? 5,
    publishAttempts: dependencies.limits?.publishAttempts ?? 6,
  });
  const publisherLimiter = new PublisherRequestLimiter({
    windowMs: dependencies.limits?.publisherWindowMs ?? 60 * 60_000,
    exchangeAttempts: 1,
    publishAttempts: dependencies.limits?.publisherPublishAttempts ?? 6,
  });
  const concurrencyGate = new PublicationConcurrencyGate(
    dependencies.limits?.concurrentPublications ?? 2,
  );
  const enforceLimit = (
    kind: "exchange" | "publish",
    request: Request,
    response: Response,
  ): boolean => {
    // The public origin is expected to be reachable only through Cloudflare;
    // fall back to the direct peer for local/test operation.
    const retryAfter = limiter.attempt(kind, requestPeer(request));
    if (retryAfter === undefined) return true;
    response.setHeader("Retry-After", String(retryAfter));
    sendFailure(response, request, {
      status: 429,
      code: "publisher_rate_limited",
      message: "Too many publisher requests. Try again later.",
    });
    return false;
  };

  app.post("/v1/publishers/token", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!enforceLimit("exchange", request, response)) return;
    const credentials = parseBasicAuthorization(request.header("authorization"));
    if (credentials === undefined) {
      invalidCredentials(response, request);
      return;
    }
    try {
      const issued = await dependencies.access.exchange(
        credentials.username,
        credentials.password,
      );
      response.status(201).json(issued);
    } catch (error) {
      if (error instanceof InvalidPublisherCredentialsError) {
        invalidCredentials(response, request);
        return;
      }
      throw error;
    }
  });

  app.post("/v1/publisher/releases", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!enforceLimit("publish", request, response)) return;
    const token = parseBearerAuthorization(request.header("authorization"));
    if (token === undefined) {
      invalidToken(response, request);
      return;
    }
    let principal;
    try {
      principal = await dependencies.access.authenticate(token);
    } catch {
      invalidToken(response, request);
      return;
    }

    const publisherRetryAfter = publisherLimiter.attempt("publish", principal.publisherId);
    if (publisherRetryAfter !== undefined) {
      response.setHeader("Retry-After", String(publisherRetryAfter));
      sendFailure(response, request, {
        status: 429,
        code: "publisher_rate_limited",
        message: "Too many publisher requests. Try again later.",
      });
      return;
    }
    if (!request.is("multipart/form-data")) {
      sendFailure(response, request, {
        status: 415,
        code: "multipart_required",
        message: "A multipart release upload is required.",
      });
      return;
    }

    const descriptorLimit = dependencies.limits?.descriptorBytes ?? MAX_DESCRIPTOR_BYTES;
    const archiveLimit = dependencies.limits?.archiveBytes ?? MAX_ARCHIVE_BYTES;
    const maximumRequestBytes = descriptorLimit + archiveLimit + MAX_MULTIPART_OVERHEAD_BYTES;
    const contentLengthText = request.header("content-length");
    const contentLength = contentLengthText === undefined ? maximumRequestBytes : Number(contentLengthText);
    if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > maximumRequestBytes) {
      sendFailure(response, request, {
        status: 413,
        code: "release_upload_too_large",
        message: "The release upload is too large.",
      });
      return;
    }

    const releaseGate = concurrencyGate.acquire();
    if (releaseGate === undefined) {
      response.setHeader("Retry-After", "5");
      sendFailure(response, request, {
        status: 503,
        code: "publisher_busy",
        message: "The publisher is busy. Try again shortly.",
      });
      return;
    }

    try {
      if (!await dependencies.publication.canAcceptUpload(contentLength)) {
        sendFailure(response, request, {
          status: 507,
          code: "publication_capacity_exceeded",
          message: "The self-service publication capacity is exhausted.",
        });
        return;
      }
      try {
        await receiveUpload(request, response, parser);
      } catch (error) {
        const failure = uploadFailure(error);
        if (failure !== undefined) {
          sendFailure(response, request, failure);
          return;
        }
        throw error;
      }

      const descriptorText = request.body?.descriptor as unknown;
      const archive = request.file;
      if (typeof descriptorText !== "string" || archive === undefined) {
        sendFailure(response, request, {
          status: 400,
          code: "invalid_release_upload",
          message: "The release upload is invalid.",
        });
        return;
      }
      let descriptor: unknown;
      try {
        descriptor = JSON.parse(descriptorText) as unknown;
      } catch {
        sendFailure(response, request, {
          status: 400,
          code: "invalid_release",
          message: "The Game Release is invalid.",
        });
        return;
      }

      try {
        const result = await dependencies.publication.publish(principal.publisherId, {
          descriptor,
          archive: {
            fileName: archive.originalname,
            bytes: archive.buffer,
          },
        });
        response.status(result.status === "published" ? 201 : 200).json({
          status: result.status,
          release: {
            packageId: result.release.packageId,
            version: result.release.version,
            contentDigest: result.release.contentDigest,
          },
        });
      } catch (error) {
        if (error instanceof PublisherServerModuleRequiredError) {
          sendFailure(response, request, {
            status: 422,
            code: "server_module_required",
            message: "Self-service publishing accepts web client packages only; this release requires an operator-deployed server module.",
          });
          return;
        }
        if (error instanceof PublisherPackageOwnershipError) {
          sendFailure(response, request, {
            status: 409,
            code: "package_id_not_owned",
            message: "This publisher does not own that package ID.",
          });
          return;
        }
        if (error instanceof PublisherQuotaError) {
          sendFailure(response, request, {
            status: 403,
            code: error.code,
            message: "The self-service publisher quota is exhausted.",
          });
          return;
        }
        if (error instanceof GameReleasePublicationError) {
          const invalid = error.code === "invalid_release";
          sendFailure(response, request, {
            status: invalid ? 400 : 409,
            code: error.code,
            message: invalid
              ? "The Game Release is invalid."
              : "The immutable Game Release conflicts with existing content.",
          });
          return;
        }
        throw error;
      }
    } finally {
      releaseGate();
    }
  });
}
