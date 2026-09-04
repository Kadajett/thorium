import { createHash } from "node:crypto";
import type { WebGameManifest } from "./manifest.js";
import type { JsonValue } from "./types.js";

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

function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = normalize(child);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildDeployDescriptor(
  manifest: WebGameManifest,
  packageFiles: readonly PackageFile[],
  archive: PackageArchive,
): DeployDescriptor {
  const byPath = new Map(packageFiles.map((file) => [file.path, file.bytes]));
  const expected = [...manifest.runtime.files].sort();
  const missing = expected.filter((path) => !byPath.has(path));
  if (missing.length > 0) throw new Error(`Missing package files: ${missing.join(", ")}`);
  const unexpected = [...byPath.keys()].filter((path) => !expected.includes(path));
  if (unexpected.length > 0) throw new Error(`Unexpected package files: ${unexpected.join(", ")}`);

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
      files: expected.map((path) => {
        const bytes = byPath.get(path);
        if (!bytes) throw new Error(`Missing package file: ${path}`);
        return { path, sha256: sha256(bytes), size: bytes.byteLength };
      }),
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
