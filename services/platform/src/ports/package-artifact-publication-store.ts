import type { PackageArtifactKey } from "./package-artifact-store.js";

export interface PackageArtifactPublication {
  readonly key: PackageArtifactKey;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export type PackageArtifactPublicationResult =
  | "published"
  | "already-published"
  | "conflict";

/** Durable byte-storage seam for an immutable Game Package archive. */
export interface PackageArtifactPublicationStore {
  publish(artifact: PackageArtifactPublication): Promise<PackageArtifactPublicationResult>;
}
