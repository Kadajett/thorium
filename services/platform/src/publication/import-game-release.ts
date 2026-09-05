import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { z } from "zod";
import { FileSystemPackageArtifactPublicationStore } from
  "../adapters/filesystem-package-artifact-publication-store.js";
import { PostgresGameCatalogRepository } from
  "../adapters/postgres/postgres-game-catalog-repository.js";
import { runPostgresMigrations } from "../adapters/postgres/postgres-migrations.js";
import {
  GameReleasePublicationError,
  GameReleasePublisher,
} from "./game-release-publisher.js";

const MAX_DESCRIPTOR_BYTES = 1_048_576;
const MAX_ARCHIVE_BYTES = 134_217_728;

const ImportEnvironmentSchema = z.object({
  DATABASE_URL: z.string().trim().min(1).refine((value) => {
    try {
      return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "DATABASE_URL must be a PostgreSQL URL"),
  PUBLIC_BASE_URL: z.string().trim().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === "";
  }, "PUBLIC_BASE_URL must be a credential-free HTTPS URL"),
  PACKAGE_ARTIFACT_DIRECTORY: z.string().trim().min(1),
});

async function readRegularFile(path: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size < 1 || stats.size > maximumBytes) {
      throw new Error("invalid_import_file");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Filesystem-volume publication entrypoint. Authorization is supplied by the
 * operator's ability to run this command with the database Secret and RW PVC.
 */
export async function runGameReleaseImport(
  environmentInput: NodeJS.ProcessEnv,
  argumentsInput: readonly string[],
): Promise<{
  readonly status: "published" | "already-published";
  readonly packageId: string;
  readonly version: string;
  readonly contentDigest: string;
}> {
  const environment = ImportEnvironmentSchema.parse(environmentInput);
  if (argumentsInput.length !== 2) throw new Error("usage_error");
  const [descriptorPath, archivePath] = argumentsInput;
  if (descriptorPath === undefined || archivePath === undefined) throw new Error("usage_error");

  const [descriptorBytes, archiveBytes] = await Promise.all([
    readRegularFile(descriptorPath, MAX_DESCRIPTOR_BYTES),
    readRegularFile(archivePath, MAX_ARCHIVE_BYTES),
  ]);
  const descriptor = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(descriptorBytes)) as unknown;
  const pool = new Pool({ connectionString: environment.DATABASE_URL });
  try {
    await runPostgresMigrations(pool);
    const repository = new PostgresGameCatalogRepository(pool);
    const publisher = new GameReleasePublisher({
      artifacts: new FileSystemPackageArtifactPublicationStore(
        environment.PACKAGE_ARTIFACT_DIRECTORY,
      ),
      releases: repository,
      publicBaseUrl: environment.PUBLIC_BASE_URL,
    });
    const result = await publisher.publish({
      descriptor,
      archive: { fileName: basename(archivePath), bytes: archiveBytes },
    });
    return {
      status: result.status,
      packageId: result.release.packageId,
      version: result.release.version,
      contentDigest: result.release.contentDigest,
    };
  } finally {
    await pool.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    const result = await runGameReleaseImport(process.env, process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof GameReleasePublicationError
      ? error.code
      : error instanceof Error && error.message === "usage_error"
        ? "usage_error"
        : "import_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
