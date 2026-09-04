import express, {
  type Application,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import type { GameRelease, SurfaceRole } from "../domain/game-package.js";
import type { AccountIdentityPort, AccountSession } from "../ports/account-identity.js";
import type { GameCatalogRepository } from "../ports/game-catalog-repository.js";
import type { PackageArtifactStore } from "../ports/package-artifact-store.js";
import type { GameSessionRegistry } from "../session-registry/game-session-registry.js";
import {
  AccountSessionExpiringError,
  type SessionTicketService,
  type SeatLeaseRequest,
} from "../security/session-ticket-service.js";

export interface HttpDependencies {
  readonly catalog: GameCatalogRepository;
  readonly packageArtifacts: PackageArtifactStore;
  readonly accountIdentity: AccountIdentityPort;
  readonly sessionTickets: SessionTicketService;
  readonly gameSessions: GameSessionRegistry;
  readonly isReady?: () => Promise<boolean>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const ListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).optional(),
});

const SearchQuerySchema = ListQuerySchema.extend({
  q: z.string().trim().min(1).max(100),
});

const DetailParamsSchema = z.strictObject({
  packageId: z.string().min(1).max(128),
});

const DetailQuerySchema = z.strictObject({
  version: z.string().min(1).max(64).optional(),
});

const PackageParamsSchema = z.strictObject({
  packageId: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  fileName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}\.zip$/),
});

const GameSessionRequestSchema = z.strictObject({
  requestId: z.string().uuid(),
  release: z.strictObject({
    packageId: z.string().max(128).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/),
    version: z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  surfaces: z.array(z.strictObject({
    surfaceId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    role: z.enum(["main", "companion"]),
    playerSlots: z.array(z.number().int().min(0).max(15)).max(16),
  })).min(1).max(2),
});

function parseBearerToken(header: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? "");
  if (match?.[1] === undefined || match[1].length > 8_192) {
    throw new HttpError(401, "account_token_required", "A bearer account token is required.");
  }
  return match[1];
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "invalid_request", "The request is invalid.", result.error.issues);
  }
  return result.data;
}

function validateSurfaceLeases(
  surfaces: readonly SeatLeaseRequest[],
  game: GameRelease,
): void {
  const surfaceIds = new Set<string>();
  const roles = new Set<SurfaceRole>();
  const playerSlots = new Set<number>();

  for (const surface of surfaces) {
    if (surfaceIds.has(surface.surfaceId)) {
      throw new HttpError(400, "duplicate_surface", "Each surfaceId must be unique.");
    }
    if (roles.has(surface.role)) {
      throw new HttpError(400, "duplicate_surface_role", "Each Surface Role may be leased once per Game Session.");
    }
    surfaceIds.add(surface.surfaceId);
    roles.add(surface.role);

    if (game.runtime.entrypoints[surface.role] === undefined) {
      throw new HttpError(400, "unknown_surface_role", "The Game Release does not provide the requested Surface Role.");
    }
    for (const playerSlot of surface.playerSlots) {
      if (playerSlots.has(playerSlot)) {
        throw new HttpError(400, "duplicate_player_slot", "A PlayerSlot may be controlled by only one surface client.");
      }
      playerSlots.add(playerSlot);
    }
  }

  const missingRequiredRoles = game.displays.requiredSurfaces.filter((role) => !roles.has(role));
  if (missingRequiredRoles.length > 0) {
    throw new HttpError(
      400,
      "required_surface_missing",
      "Every required Surface Role must be present in the Game Session request.",
      { roles: missingRequiredRoles },
    );
  }

  if (playerSlots.size < game.players.minSlots || playerSlots.size > game.players.maxSlots) {
    throw new HttpError(
      400,
      "player_slot_count_out_of_range",
      `This package requires ${game.players.minSlots}-${game.players.maxSlots} PlayerSlots.`,
    );
  }
  if (playerSlots.size > game.players.maxLocalSlots) {
    throw new HttpError(
      400,
      "local_player_slot_count_out_of_range",
      `This package allows at most ${game.players.maxLocalSlots} local PlayerSlots.`,
    );
  }
  if (!game.players.sameAccountMultipleSlots && playerSlots.size > 1) {
    throw new HttpError(400, "same_account_multiple_slots_denied", "This package allows one PlayerSlot per account.");
  }
}

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  return (ifNoneMatch ?? "")
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate.replace(/^W\//, "") === etag);
}

function parseByteRange(header: string, size: number): ByteRange | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === "" && match[2] === "")) return undefined;

  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? size - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) return undefined;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function setPackageHeaders(
  response: Response,
  game: GameRelease,
  etag: string,
): void {
  const digest = Buffer.from(game.bundle.sha256, "hex").toString("base64");
  response.set({
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable, no-transform",
    "Content-Digest": `sha-256=:${digest}:`,
    "Content-Disposition": `attachment; filename="${game.bundle.fileName}"`,
    "Content-Length": String(game.bundle.sizeBytes),
    "Content-Type": "application/zip",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
}

async function deliverPackageArtifact(
  request: Request,
  response: Response,
  dependencies: HttpDependencies,
): Promise<void> {
  const params = parse(PackageParamsSchema, request.params);
  const game = await dependencies.catalog.findById(params.packageId, params.version);
  if (game === undefined || game.bundle.fileName !== params.fileName) {
    throw new HttpError(404, "package_artifact_not_found", "The requested package artifact was not found.");
  }

  const artifact = await dependencies.packageArtifacts.read(params);
  if (artifact === undefined) {
    throw new HttpError(404, "package_artifact_not_found", "The requested package artifact was not found.");
  }
  const bytes = Buffer.from(artifact.bytes.buffer, artifact.bytes.byteOffset, artifact.bytes.byteLength);
  if (artifact.sizeBytes !== game.bundle.sizeBytes || artifact.sha256 !== game.bundle.sha256) {
    throw new HttpError(
      500,
      "package_artifact_integrity_error",
      "The stored package artifact does not match its published catalog metadata.",
    );
  }

  const etag = `"${game.bundle.sha256}"`;
  setPackageHeaders(response, game, etag);
  if (etagMatches(request.header("if-none-match"), etag)) {
    response.status(304).end();
    return;
  }

  const rangeHeader = request.method === "GET" ? request.header("range") : undefined;
  if (rangeHeader !== undefined && (request.header("if-range") ?? etag) === etag) {
    const range = parseByteRange(rangeHeader, bytes.byteLength);
    if (range === undefined) {
      response.setHeader("Content-Range", `bytes */${bytes.byteLength}`);
      response.removeHeader("Content-Length");
      response.status(416).end();
      return;
    }
    const partial = bytes.subarray(range.start, range.end + 1);
    response.setHeader("Content-Length", String(partial.byteLength));
    response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
    response.status(206).end(partial);
    return;
  }

  if (request.method === "HEAD") {
    response.status(200).end();
    return;
  }
  response.status(200).end(bytes);
}

export function registerPlatformRoutes(app: Application, dependencies: HttpDependencies): void {
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb", strict: true }));

  app.get("/health", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ status: "ok", service: "thorium-platform", version: "0.1.0" });
  });

  app.get("/ready", async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const ready = await (dependencies.isReady?.() ?? Promise.resolve(true));
      response.status(ready ? 200 : 503).json({
        status: ready ? "ready" : "unavailable",
        service: "thorium-platform",
      });
    } catch {
      response.status(503).json({
        status: "unavailable",
        service: "thorium-platform",
      });
    }
  });

  app.route("/v1/packages/:packageId/:version/:fileName")
    .head(async (request, response) => deliverPackageArtifact(request, response, dependencies))
    .get(async (request, response) => deliverPackageArtifact(request, response, dependencies));

  app.get("/v1/catalog/games", async (request, response) => {
    const query = parse(ListQuerySchema, request.query);
    try {
      const page = await dependencies.catalog.list({
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      response.json(page);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_catalog_cursor") {
        throw new HttpError(400, "invalid_cursor", "The catalog cursor is invalid.");
      }
      throw error;
    }
  });

  app.get("/v1/catalog/games/search", async (request, response) => {
    const query = parse(SearchQuerySchema, request.query);
    try {
      const page = await dependencies.catalog.list({
        query: query.q,
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      response.json(page);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_catalog_cursor") {
        throw new HttpError(400, "invalid_cursor", "The catalog cursor is invalid.");
      }
      throw error;
    }
  });

  app.get("/v1/catalog/games/:packageId", async (request, response) => {
    const params = parse(DetailParamsSchema, request.params);
    const query = parse(DetailQuerySchema, request.query);
    const game = await dependencies.catalog.findById(params.packageId, query.version);
    if (game === undefined) {
      throw new HttpError(404, "game_not_found", "The requested game package was not found.");
    }
    response.json({ game });
  });

  app.post("/v1/game-sessions", async (request, response) => {
    const body = parse(GameSessionRequestSchema, request.body);
    const accountToken = parseBearerToken(request.header("authorization"));

    let account: AccountSession;
    try {
      account = await dependencies.accountIdentity.verifyAccountToken(accountToken);
    } catch {
      throw new HttpError(401, "invalid_account_token", "The account token is invalid or expired.");
    }

    const game = await dependencies.catalog.findById(body.release.packageId, body.release.version);
    if (game === undefined) {
      throw new HttpError(404, "game_not_found", "The requested game package was not found.");
    }
    if (game.contentDigest !== body.release.contentDigest) {
      throw new HttpError(
        409,
        "game_release_mismatch",
        "The requested content digest does not match the catalog Game Release.",
      );
    }
    validateSurfaceLeases(body.surfaces, game);
    let preparedTicketIssue;
    try {
      preparedTicketIssue = dependencies.sessionTickets.prepareIssue(account);
    } catch (error) {
      if (error instanceof AccountSessionExpiringError) {
        throw new HttpError(
          401,
          "account_session_expiring",
          "The Account Session must be refreshed before starting a Game Session.",
        );
      }
      throw error;
    }

    const activationResult = await dependencies.gameSessions.activate({
      requestId: body.requestId,
      accountId: account.accountId,
      release: body.release,
      surfaces: body.surfaces,
    });
    if (!activationResult.ok) {
      throw new HttpError(
        activationResult.conflict.code === "INVALID_ACTIVATION" ? 400 : 409,
        activationResult.conflict.code.toLowerCase(),
        activationResult.conflict.message,
      );
    }

    const ticketBundle = await dependencies.sessionTickets.issueBundle(
      preparedTicketIssue,
      activationResult.activation,
    );

    response.setHeader("Cache-Control", "no-store");
    response.status(activationResult.replayed ? 200 : 201).json(ticketBundle);
  });

  app.use((_request, _response, next) => {
    next(new HttpError(404, "route_not_found", "The requested route does not exist."));
  });

  app.use((
    error: unknown,
    request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    const httpError = error instanceof HttpError
      ? error
      : new HttpError(500, "internal_error", "An unexpected error occurred.");
    response.status(httpError.status).json({
      error: {
        code: httpError.code,
        message: httpError.message,
        ...(httpError.details === undefined ? {} : { details: httpError.details }),
      },
      path: request.path,
    });
  });
}

export function createHttpApplication(dependencies: HttpDependencies): Application {
  const app = express();
  registerPlatformRoutes(app, dependencies);
  return app;
}
