import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "node:test";
type Contents = Readonly<Record<string, string>>;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function writeEntry(root: string, entry: readonly [string, string]): Promise<void> {
  const file = path.join(root, entry[0]);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, entry[1]);
}
export async function packageFixture(manifest: unknown, contents: Contents = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "thorium-sdk-test-"));
  roots.push(root);
  const files = {
    "main/index.html": "<!doctype html><head></head><canvas></canvas>",
    "companion/index.html": "<!doctype html><canvas></canvas>",
    "game.js": "export {}",
    ...contents,
    "thorium.json": JSON.stringify(manifest),
  };
  await Promise.all(Object.entries(files).map((entry) => writeEntry(root, entry)));
  return { root, manifestPath: path.join(root, "thorium.json") };
}
