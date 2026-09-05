import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import { resolve, sep } from "node:path";
import type {
  PackageArtifactPublication,
  PackageArtifactPublicationResult,
  PackageArtifactPublicationStore,
} from "../ports/package-artifact-publication-store.js";

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "ENOENT";
}

function isAlreadyPresent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "EEXIST";
}

function verifyPublication(artifact: PackageArtifactPublication): void {
  if (![artifact.key.packageId, artifact.key.version, artifact.key.fileName]
    .every((segment) => SAFE_SEGMENT.test(segment))) {
    throw new Error("invalid_package_artifact_key");
  }
  if (
    !SHA256.test(artifact.sha256)
    || artifact.sizeBytes !== artifact.bytes.byteLength
    || createHash("sha256").update(artifact.bytes).digest("hex") !== artifact.sha256
  ) throw new Error("invalid_package_artifact_publication");
}

async function compareExisting(
  path: string,
  artifact: PackageArtifactPublication,
): Promise<PackageArtifactPublicationResult> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("package_artifact_not_regular_file");
  if (stats.size !== artifact.sizeBytes) return "conflict";
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  return digest === artifact.sha256 ? "already-published" : "conflict";
}

/** Atomically writes immutable archives into the read adapter's package/version layout. */
export class FileSystemPackageArtifactPublicationStore
implements PackageArtifactPublicationStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async publish(artifact: PackageArtifactPublication): Promise<PackageArtifactPublicationResult> {
    verifyPublication(artifact);
    await mkdir(this.#root, { recursive: true });
    const root = await realpath(this.#root);
    const requestedDirectory = resolve(root, artifact.key.packageId, artifact.key.version);
    if (!requestedDirectory.startsWith(`${root}${sep}`)) throw new Error("invalid_package_artifact_path");
    await mkdir(requestedDirectory, { recursive: true });
    const directory = await realpath(requestedDirectory);
    if (!directory.startsWith(`${root}${sep}`)) throw new Error("package_artifact_outside_root");
    const target = resolve(directory, artifact.key.fileName);

    try {
      return await compareExisting(target, artifact);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }

    const temporary = resolve(directory, `.${artifact.key.fileName}.${randomUUID()}.partial`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(artifact.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, 0o444);
    try {
      await link(temporary, target);
      return "published";
    } catch (error) {
      if (!isAlreadyPresent(error)) throw error;
      return compareExisting(target, artifact);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    }
  }
}
