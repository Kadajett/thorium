import { readFile } from "node:fs/promises";
import path from "node:path";
type Modules = Map<string, Uint8Array>;
const ROOT = new URL("./", import.meta.url);
function dependencies(name: string, source: string): readonly string[] {
  const matches = source.matchAll(/\b(?:from\s*|import\s*)["'](\.{1,2}\/[^"']+\.js)["']/g);
  return [...matches].map((match) => {
    const specifier = match[1];
    if (specifier === undefined) throw new Error("Invalid generated module import");
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
    if (dependency.startsWith("../")) throw new Error("Preview module escapes the SDK");
    return dependency;
  });
}
async function loadModule(name: string, modules: Modules): Promise<void> {
  const key = "/__thorium/" + name;
  if (modules.has(key)) return;
  const bytes = await readFile(new URL(name, ROOT));
  modules.set(key, bytes);
  for (const dependency of dependencies(name, bytes.toString()))
    await loadModule(dependency, modules);
}
export async function previewModules(): Promise<ReadonlyMap<string, Uint8Array>> {
  const modules: Modules = new Map();
  for (const name of ["preview.js", "manifest.js", "types.js", "preview-shell-client.js"])
    await loadModule(name, modules);
  const shell = modules.get("/__thorium/preview-shell-client.js");
  if (shell === undefined) throw new Error("Preview shell not compiled");
  modules.set("/__thorium/shell.js", shell);
  const bridge = await readFile(new URL("./preview-bridge-client.js", ROOT), "utf8");
  modules.set(
    "/__thorium/bridge.js",
    new TextEncoder().encode(bridge.replace(/^export \{\};\s*$/m, "")),
  );
  return modules;
}
