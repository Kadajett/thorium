import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./descriptor.js";
import { loadGamePackage, packGamePackage } from "./pack.js";
import { startPreviewServer } from "./preview-server.js";
import { publishGame } from "./publish.js";
import type { CliCommand } from "./core/cli-arguments.js";
type Action = (file: string, options: CliCommand["options"]) => Promise<void>;
async function writeOutput(outputPath: string, bytes: string | Uint8Array): Promise<void> {
  const absolute = path.resolve(outputPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
}
async function publish(file: string, options: CliCommand["options"]): Promise<void> {
  const receipt = await publishGame(file, {
    platformUrl: options["--platform"] ?? "",
    token: process.env.THORIUM_PUBLISH_TOKEN ?? "",
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
async function serve(file: string, options: CliCommand["options"]): Promise<void> {
  const raw = options["--port"];
  const preview = await startPreviewServer(file, raw === undefined ? {} : { port: Number(raw) });
  console.error(`Thorium local preview: ${preview.url}`);
  console.error(
    "Local development only; no AccountSession credentials or platform server are used.",
  );
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await preview.close();
}
async function validate(file: string, options: CliCommand["options"]): Promise<void> {
  const loaded = await loadGamePackage(file),
    output = options["--out"];
  const canonical = `${canonicalJson(packGamePackage(loaded).descriptor)}\n`;
  if (output === undefined) {
    process.stdout.write(canonical);
    return;
  }
  await writeOutput(output, canonical);
  console.error(
    `Validated ${loaded.manifest.packageId}@${loaded.manifest.version}; wrote ${output}`,
  );
}
async function pack(file: string, options: CliCommand["options"]): Promise<void> {
  const loaded = await loadGamePackage(file),
    manifest = loaded.manifest;
  const name = `${manifest.packageId}-${manifest.version}.zip`;
  const archive = options["--archive"] ?? path.join(path.dirname(file), name);
  const descriptor =
    options["--descriptor"] ?? path.join(path.dirname(file), "deploy-descriptor.json");
  const packed = packGamePackage(loaded, path.basename(archive));
  await writeOutput(archive, packed.archive);
  await writeOutput(descriptor, `${canonicalJson(packed.descriptor)}\n`);
  console.error(
    `Packed ${manifest.packageId}@${manifest.version}: ${String(packed.archive.byteLength)} bytes -> ${archive}`,
  );
  console.error(`Wrote canonical descriptor -> ${descriptor}`);
}
const ACTIONS: Readonly<Record<CliCommand["name"], Action>> = { publish, serve, validate, pack };
export async function runCommand(command: CliCommand): Promise<void> {
  if (path.basename(command.manifest) !== "thorium.json")
    throw new Error("The web-v1 manifest must be named thorium.json");
  await ACTIONS[command.name](path.resolve(command.manifest), command.options);
}
