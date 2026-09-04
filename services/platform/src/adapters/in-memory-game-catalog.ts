import type {
  CatalogPage,
  CatalogQuery,
  GameRelease,
} from "../domain/game-package.js";
import type { GameCatalogRepository } from "../ports/game-catalog-repository.js";

function encodeCursor(packageId: string): string {
  return Buffer.from(packageId, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (decoded.length === 0 || encodeCursor(decoded) !== cursor) {
    throw new Error("invalid_catalog_cursor");
  }
  return decoded;
}

function copy(record: GameRelease): GameRelease {
  return structuredClone(record);
}

export class InMemoryGameCatalogRepository implements GameCatalogRepository {
  readonly #records: readonly GameRelease[];

  constructor(records: readonly GameRelease[]) {
    this.#records = records
      .map(copy)
      .sort((left, right) => left.packageId.localeCompare(right.packageId));
  }

  async list({ query, limit, cursor }: CatalogQuery): Promise<CatalogPage> {
    const normalizedQuery = query?.trim().toLocaleLowerCase();
    const afterPackageId = cursor === undefined ? undefined : decodeCursor(cursor);

    const matches = this.#records.filter((record) => {
      if (afterPackageId !== undefined && record.packageId <= afterPackageId) {
        return false;
      }
      if (normalizedQuery === undefined || normalizedQuery.length === 0) {
        return true;
      }

      const searchable = [
        record.packageId,
        record.displayName,
        record.summary,
        ...record.tags,
      ].join("\n").toLocaleLowerCase();
      return searchable.includes(normalizedQuery);
    });

    const pageRecords = matches.slice(0, limit);
    const lastRecord = pageRecords.at(-1);
    const nextCursor = matches.length > pageRecords.length && lastRecord !== undefined
      ? encodeCursor(lastRecord.packageId)
      : undefined;

    return {
      items: pageRecords.map(copy),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  async findById(
    packageId: string,
    version?: string,
  ): Promise<GameRelease | undefined> {
    const record = this.#records.find((candidate) =>
      candidate.packageId === packageId
      && (version === undefined || candidate.version === version));
    return record === undefined ? undefined : copy(record);
  }
}
