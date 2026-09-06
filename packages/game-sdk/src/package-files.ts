import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { Stats } from "node:fs";
type Root = Readonly<{ path: string; real: string }>;
type Segments = readonly string[];
function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}
function checkEntry(stat: Stats, leaf: boolean, relative: string): void {
  if (stat.isSymbolicLink())
    throw new Error(`Package path must not contain a symlink: ${relative}`);
  if (!leaf && !stat.isDirectory())
    throw new Error(`Package path parent is not a directory: ${relative}`);
  if (leaf && !stat.isFile()) throw new Error(`Package entry is not a regular file: ${relative}`);
}
export async function readRegularPackageFile(root: Root, relative: string): Promise<Uint8Array> {
  const candidate = await checkedPath(root.path, relative.split("/"), relative);
  if (!insideRoot(root.real, await realpath(candidate)))
    throw new Error(`Package file escapes its root: ${relative}`);
  return readFile(candidate);
}
async function checkedPath(root: string, segments: Segments, relative: string): Promise<string> {
  const segment = segments[0];
  if (segment === undefined) return root;
  const candidate = path.join(root, segment);
  checkEntry(await lstat(candidate), segments.length === 1, relative);
  return checkedPath(candidate, segments.slice(1), relative);
}
export async function manifestInput(absolute: string): Promise<unknown> {
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error("thorium.json must not be a symlink");
  if (!stat.isFile()) throw new Error("thorium.json must be a regular file");
  const input: unknown = JSON.parse(await readFile(absolute, "utf8"));
  return input;
}
