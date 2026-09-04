import { createHash } from "node:crypto";
import type {
  PackageArtifact,
  PackageArtifactKey,
  PackageArtifactStore,
} from "../ports/package-artifact-store.js";

export interface InMemoryPackageArtifact {
  readonly key: PackageArtifactKey;
  readonly bytes: Uint8Array;
}

function storageKey(key: PackageArtifactKey): string {
  return `${key.packageId}\0${key.version}\0${key.fileName}`;
}

/** Constructor-only test adapter: published artifacts cannot be mutated after creation. */
export class InMemoryPackageArtifactStore implements PackageArtifactStore {
  readonly #artifacts: ReadonlyMap<string, PackageArtifact>;

  constructor(artifacts: readonly InMemoryPackageArtifact[]) {
    const records = new Map<string, PackageArtifact>();
    for (const artifact of artifacts) {
      const key = storageKey(artifact.key);
      if (records.has(key)) throw new Error("duplicate_package_artifact");
      const bytes = Uint8Array.from(artifact.bytes);
      records.set(key, {
        bytes,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
      });
    }
    this.#artifacts = records;
  }

  async read(key: PackageArtifactKey): Promise<PackageArtifact | undefined> {
    return this.#artifacts.get(storageKey(key));
  }
}
