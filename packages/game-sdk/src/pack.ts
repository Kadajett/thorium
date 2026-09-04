import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import {
  buildDeployDescriptor,
  canonicalJson,
  type DeployDescriptor,
  type PackageFile,
} from "./descriptor.js";
import { validateManifest, type WebGameManifest } from "./manifest.js";

const zipEpoch = new Date(1980, 0, 1, 0, 0, 0, 0);
const encoder = new TextEncoder();

export interface LoadedGamePackage {
  readonly manifest: WebGameManifest;
  readonly files: readonly PackageFile[];
}

export interface PackedGamePackage {
  readonly archive: Uint8Array;
  readonly descriptor: DeployDescriptor;
}

function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function readRegularPackageFile(root: string, rootReal: string, relativePath: string): Promise<Uint8Array> {
  let candidate = root;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    candidate = path.join(candidate, segment);
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink()) throw new Error(`Package path must not contain a symlink: ${relativePath}`);
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`Package path parent is not a directory: ${relativePath}`);
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      throw new Error(`Package entry is not a regular file: ${relativePath}`);
    }
  }
  const resolved = await realpath(candidate);
  if (!insideRoot(rootReal, resolved)) throw new Error(`Package file escapes its root: ${relativePath}`);
  return readFile(candidate);
}

/** Load exactly the manifest and its declared files; undeclared source files are ignored. */
export async function loadGamePackage(manifestPath: string): Promise<LoadedGamePackage> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestStat = await lstat(absoluteManifest);
  if (manifestStat.isSymbolicLink()) throw new Error("thorium.json must not be a symlink");
  if (!manifestStat.isFile()) throw new Error("thorium.json must be a regular file");

  const root = path.dirname(absoluteManifest);
  const rootReal = await realpath(root);
  const manifest = validateManifest(JSON.parse(await readFile(absoluteManifest, "utf8")) as unknown);
  const actualFileCount = manifest.runtime.files.length + 1;
  if (actualFileCount > manifest.budgets.maxFileCount) {
    throw new Error(
      `Game Package has ${actualFileCount} entries but budgets.maxFileCount is ${manifest.budgets.maxFileCount}`,
    );
  }

  const files = await Promise.all(
    manifest.runtime.files.map(async (relativePath) => ({
      path: relativePath,
      bytes: await readRegularPackageFile(root, rootReal, relativePath),
    })),
  );
  return { manifest, files };
}

/** Produce byte-for-byte stable ZIP and descriptor output for identical input. */
export function packGamePackage(
  loaded: LoadedGamePackage,
  archiveFileName = `${loaded.manifest.packageId}-${loaded.manifest.version}.zip`,
): PackedGamePackage {
  const manifestBytes = encoder.encode(canonicalJson(loaded.manifest));
  const allEntries: PackageFile[] = [
    { path: "thorium.json", bytes: manifestBytes },
    ...loaded.files,
  ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  if (allEntries.length > loaded.manifest.budgets.maxFileCount) {
    throw new Error(
      `Game Package has ${allEntries.length} entries but budgets.maxFileCount is ${loaded.manifest.budgets.maxFileCount}`,
    );
  }
  const contentBytes = allEntries.reduce((total, entry) => total + entry.bytes.byteLength, 0);
  if (contentBytes > loaded.manifest.budgets.maxPackageBytes) {
    throw new Error(
      `Game Package contains ${contentBytes} bytes but budgets.maxPackageBytes is ${loaded.manifest.budgets.maxPackageBytes}`,
    );
  }

  const zipEntries: Zippable = {};
  for (const entry of allEntries) {
    zipEntries[entry.path] = [
      entry.bytes,
      { level: 9, mtime: zipEpoch, os: 3, attrs: 0o644 << 16 },
    ];
  }
  const archive = zipSync(zipEntries, { level: 9 });
  if (archive.byteLength > loaded.manifest.budgets.maxPackageBytes) {
    throw new Error(
      `ZIP is ${archive.byteLength} bytes but budgets.maxPackageBytes is ${loaded.manifest.budgets.maxPackageBytes}`,
    );
  }
  const descriptor = buildDeployDescriptor(loaded.manifest, loaded.files, {
    fileName: archiveFileName,
    bytes: archive,
  });
  return { archive, descriptor };
}
