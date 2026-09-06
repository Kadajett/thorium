import { realpath } from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import {
  buildDeployDescriptor,
  canonicalJson,
  type DeployDescriptor,
  type PackageFile,
} from "./descriptor.js";
import { validateManifest, type WebGameManifest } from "./manifest.js";
import { checkFileCount, checkContentSize, checkArchiveSize } from "./core/package-budget.js";
import { manifestInput, readRegularPackageFile } from "./package-files.js";
export interface LoadedGamePackage {
  readonly manifest: WebGameManifest;
  readonly files: readonly PackageFile[];
}
export interface PackedGamePackage {
  readonly archive: Uint8Array;
  readonly descriptor: DeployDescriptor;
}
/** Load exactly the manifest and its declared files; undeclared source files are ignored. */
export async function loadGamePackage(manifestPath: string): Promise<LoadedGamePackage> {
  const absolute = path.resolve(manifestPath);
  const manifest = validateManifest(await manifestInput(absolute));
  const directory = path.dirname(absolute);
  const root = { path: directory, real: await realpath(directory) };
  checkFileCount(manifest.runtime.files.length + 1, manifest.budgets);
  const files = await Promise.all(
    manifest.runtime.files.map(async (relative) => ({
      path: relative,
      bytes: await readRegularPackageFile(root, relative),
    })),
  );
  return { manifest, files };
}
function archiveEntries(loaded: LoadedGamePackage): readonly PackageFile[] {
  const manifest = new TextEncoder().encode(canonicalJson(loaded.manifest));
  return [{ path: "thorium.json", bytes: manifest }, ...loaded.files].sort(comparePaths);
}
function comparePaths(left: PackageFile, right: PackageFile): number {
  return left.path < right.path ? -1 : Number(left.path > right.path);
}
function zip(entries: readonly PackageFile[]): Uint8Array {
  const result: Zippable = {};
  const mtime = new Date(1980, 0, 1, 0, 0, 0, 0);
  for (const entry of entries)
    result[entry.path] = [entry.bytes, { level: 9, mtime, os: 3, attrs: 0o644 << 16 }];
  return zipSync(result, { level: 9 });
}
/** Produce byte-for-byte stable ZIP and descriptor output for identical input. */
export function packGamePackage(
  loaded: LoadedGamePackage,
  archiveFileName = `${loaded.manifest.packageId}-${loaded.manifest.version}.zip`,
): PackedGamePackage {
  const entries = archiveEntries(loaded),
    budgets = loaded.manifest.budgets;
  checkFileCount(entries.length, budgets);
  checkContentSize(
    entries.reduce((total, entry) => total + entry.bytes.byteLength, 0),
    budgets,
  );
  const archive = zip(entries);
  checkArchiveSize(archive.byteLength, budgets);
  const descriptor = buildDeployDescriptor(loaded.manifest, loaded.files, {
    fileName: archiveFileName,
    bytes: archive,
  });
  return { archive, descriptor };
}
