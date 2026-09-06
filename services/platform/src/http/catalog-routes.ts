import type { Application, Request, Response } from "express";
import { z } from "zod";
import type { GameCatalogRepository } from "../ports/game-catalog-repository.js";
import type { CatalogQuery } from "../domain/game-package.js";
import { HttpError } from "./http-error.js";

const ListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).optional(),
});
const SearchQuerySchema = ListQuerySchema.extend({ q: z.string().trim().min(1).max(100) });
const DetailParamsSchema = z.strictObject({ packageId: z.string().min(1).max(128) });
const DetailQuerySchema = z.strictObject({ version: z.string().min(1).max(64).optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "invalid_request", "The request is invalid.", result.error.issues);
  return result.data;
}

function listQuery(raw: unknown, search: boolean): CatalogQuery {
  const input = search ? parse(SearchQuerySchema, raw) : parse(ListQuerySchema, raw);
  return {
    limit: input.limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...("q" in input && typeof input.q === "string" ? { query: input.q } : {}),
  };
}

async function sendList(
  catalog: GameCatalogRepository,
  response: Response,
  query: CatalogQuery,
): Promise<void> {
  try {
    response.setHeader("Cache-Control", "no-store");
    response.json(await catalog.list(query));
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_catalog_cursor")
      throw new HttpError(400, "invalid_cursor", "The catalog cursor is invalid.");
    throw error;
  }
}

async function sendDetail(
  catalog: GameCatalogRepository,
  request: Request,
  response: Response,
): Promise<void> {
  const params = parse(DetailParamsSchema, request.params);
  const query = parse(DetailQuerySchema, request.query);
  const game = await catalog.findById(params.packageId, query.version);
  if (game === undefined)
    throw new HttpError(404, "game_not_found", "The requested game package was not found.");
  response.setHeader("Cache-Control", "no-store");
  response.json({ game });
}

export function registerCatalogRoutes(app: Application, catalog: GameCatalogRepository): void {
  app.get("/v1/catalog/games", (request, response) =>
    sendList(catalog, response, listQuery(request.query, false)),
  );
  app.get("/v1/catalog/games/search", (request, response) =>
    sendList(catalog, response, listQuery(request.query, true)),
  );
  app.get("/v1/catalog/games/:packageId", (request, response) =>
    sendDetail(catalog, request, response),
  );
}
