import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type {
  PackageArtifact,
  PackageArtifactKey,
  PackageArtifactStore,
} from "../ports/package-artifact-store.js";

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/;

function assertSafeKey(key: PackageArtifactKey): void {
  if (![key.packageId, key.version, key.fileName].every((segment) => SAFE_SEGMENT.test(segment))) {
    throw new Error("invalid_package_artifact_key");
  }
}

/** Filesystem adapter for a read-only package volume laid out as package/version/file. */
export class FileSystemPackageArtifactStore implements PackageArtifactStore {
  readonly #root: string;
  #realRoot: Promise<string> | undefined;
  readonly #cache = new Map<string, Promise<PackageArtifact | undefined>>();

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async read(key: PackageArtifactKey): Promise<PackageArtifact | undefined> {
    assertSafeKey(key);
    const path = resolve(this.#root, key.packageId, key.version, key.fileName);
    if (!path.startsWith(`${this.#root}${sep}`)) throw new Error("invalid_package_artifact_path");

    let pending = this.#cache.get(path);
    if (pending === undefined) {
      pending = this.#load(path);
      this.#cache.set(path, pending);
    }
    try {
      const artifact = await pending;
      if (artifact === undefined && this.#cache.get(path) === pending) {
        // A public release can appear after an earlier guessed/missing read.
        // Only immutable, successfully loaded artifacts are safe to cache.
        this.#cache.delete(path);
        this.#realRoot = undefined;
      }
      return artifact;
    } catch (error) {
      if (this.#cache.get(path) === pending) this.#cache.delete(path);
      this.#realRoot = undefined;
      throw error;
    }
  }

  async #load(path: string): Promise<PackageArtifact | undefined> {
    try {
      this.#realRoot ??= realpath(this.#root);
      const [root, resolvedPath] = await Promise.all([this.#realRoot, realpath(path)]);
      if (!resolvedPath.startsWith(`${root}${sep}`)) {
        throw new Error("package_artifact_outside_root");
      }
      const stats = await lstat(resolvedPath);
      if (!stats.isFile()) throw new Error("package_artifact_not_regular_file");
      const bytes = await readFile(resolvedPath);
      return {
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
      };
    } catch (error: unknown) {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT"
      ) return undefined;
      throw error;
    }
  }
}
