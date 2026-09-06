import { createHash } from "node:crypto";
import type { WebGameManifest } from "./manifest.js";
import { canonicalJson } from "./core/canonical-json.js";
export { canonicalJson } from "./core/canonical-json.js";

export interface PackageFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface DeployDescriptor {
  readonly descriptorSchema: 1;
  readonly game: {
    readonly packageId: string;
    readonly version: string;
    readonly displayName: string;
  };
  readonly manifestSha256: string;
  readonly execution: {
    readonly kind: "web-v1";
    readonly main: string;
    readonly companion: string;
    readonly files: readonly {
      readonly path: string;
      readonly sha256: string;
      readonly size: number;
    }[];
  };
  readonly capabilities: readonly string[];
  readonly bundle: {
    readonly fileName: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  };
  readonly deployable: true;
}

export interface PackageArchive {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildDeployDescriptor(
  manifest: WebGameManifest,
  packageFiles: readonly PackageFile[],
  archive: PackageArchive,
): DeployDescriptor {
  const files = executionFiles(manifest.runtime.files, packageFiles);

  return {
    descriptorSchema: 1,
    game: {
      packageId: manifest.packageId,
      version: manifest.version,
      displayName: manifest.displayName,
    },
    manifestSha256: sha256(canonicalJson(manifest)),
    execution: {
      kind: "web-v1",
      main: manifest.runtime.entrypoints.main.path,
      companion: manifest.runtime.entrypoints.companion.path,
      files,
    },
    capabilities: [...manifest.capabilities].sort(),
    bundle: {
      fileName: archive.fileName,
      sha256: sha256(archive.bytes),
      sizeBytes: archive.bytes.byteLength,
    },
    deployable: true,
  };
}
function executionFiles(
  expected: readonly string[],
  files: readonly PackageFile[],
): DeployDescriptor["execution"]["files"] {
  const byPath = new Map(files.map((file) => [file.path, file.bytes]));
  checkPaths(expected, byPath);
  return [...expected].sort().map((path) => {
    const bytes = byPath.get(path);
    if (bytes === undefined) throw new Error(`Missing package file: ${path}`);
    return { path, sha256: sha256(bytes), size: bytes.byteLength };
  });
}
function checkPaths(expected: readonly string[], byPath: ReadonlyMap<string, Uint8Array>): void {
  const missing = expected.filter((path) => !byPath.has(path));
  rejectFiles(missing, "Missing");
  const unexpected = [...byPath.keys()].filter((path) => !expected.includes(path));
  rejectFiles(unexpected, "Unexpected");
}
function rejectFiles(files: readonly string[], reason: string): void {
  if (files.length > 0) throw new Error(`${reason} package files: ${files.join(", ")}`);
}
