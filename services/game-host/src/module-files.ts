import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { ExactGameRelease } from "@thorium/game-host-api";

export interface ModuleEntry {
  readonly directory: string;
  readonly release: ExactGameRelease;
}

export async function assertModuleDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error(`unsafe_module_directory:${directory}`);
}

export async function moduleBytes(file: string, maximum: number): Promise<Buffer> {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error(`unsafe_module_file:${file}`);
  return checkedBytes(file, metadata.size, maximum);
}

async function checkedBytes(file: string, size: number, maximum: number): Promise<Buffer> {
  assertModuleSize(size, maximum, file);
  const bytes = await readFile(file);
  if (bytes.length !== size) throw new Error(`module_file_changed:${file}`);
  return bytes;
}

function assertModuleSize(size: number, maximum: number, file: string): void {
  if (size < 1 || size > maximum) throw new Error(`invalid_module_file_size:${file}`);
}

async function childNames(directory: string, pattern: RegExp): Promise<readonly string[]> {
  const entries = (await readdir(directory, { withFileTypes: true })).filter(
    (entry) => !entry.name.startsWith("."),
  );
  return entries.map((entry) => childName(entry, directory, pattern)).sort();
}

function childName(entry: Dirent, directory: string, pattern: RegExp): string {
  if (!entry.isDirectory() || entry.isSymbolicLink() || !pattern.test(entry.name)) {
    throw new Error(`invalid_module_release_path:${join(directory, entry.name)}`);
  }
  return entry.name;
}

async function versionEntries(
  directory: string,
  release: Pick<ExactGameRelease, "packageId" | "version">,
): Promise<readonly ModuleEntry[]> {
  const digests = await childNames(directory, /^[a-f0-9]{64}$/);
  return digests.map((contentDigest) => ({
    directory: join(directory, contentDigest),
    release: { ...release, contentDigest },
  }));
}

async function packageEntries(root: string, packageId: string): Promise<readonly ModuleEntry[]> {
  const directory = join(root, packageId);
  const versions = await childNames(directory, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const entries = await Promise.all(
    versions.map((version) => versionEntries(join(directory, version), { packageId, version })),
  );
  return entries.flat();
}

export async function moduleEntries(root: string): Promise<readonly ModuleEntry[]> {
  await mkdir(root, { recursive: true });
  await assertModuleDirectory(root);
  const packages = await childNames(root, /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
  return (await Promise.all(packages.map((packageId) => packageEntries(root, packageId)))).flat();
}

export async function moduleStateDirectory(
  root: string,
  release: ExactGameRelease,
): Promise<string> {
  const directory = join(root, release.packageId, release.version, release.contentDigest);
  await mkdir(directory, { recursive: true });
  await assertModuleDirectory(directory);
  return directory;
}
