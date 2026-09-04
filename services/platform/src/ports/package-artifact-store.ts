export interface PackageArtifactKey {
  readonly packageId: string;
  readonly version: string;
  readonly fileName: string;
}

export interface PackageArtifact {
  /** Callers must treat these bytes as immutable. */
  readonly bytes: Uint8Array;
  /** Verified once by the adapter when immutable bytes enter its read cache. */
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** Persistence seam for immutable, already-published Game Package archives. */
export interface PackageArtifactStore {
  read(key: PackageArtifactKey): Promise<PackageArtifact | undefined>;
}
