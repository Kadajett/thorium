#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./descriptor.js";
import { loadGamePackage, packGamePackage } from "./pack.js";
import { startPreviewServer } from "./preview-server.js";
import { publishGame } from "./publish.js";

function usage(): never {
  console.error(
      "Usage:\n" +
      "  thorium-game validate <thorium.json> [--out <descriptor.json>]\n" +
      "  thorium-game pack <thorium.json> [--archive <game.zip>] [--descriptor <descriptor.json>]\n" +
      "  thorium-game serve <thorium.json> [--port <port>]\n" +
      "  thorium-game publish <thorium.json> --platform <https://host>\n" +
      "    Reads the scoped token from THORIUM_PUBLISH_TOKEN.",
  );
  process.exit(2);
}

function option(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) usage();
  return value;
}

function rejectUnknownOptions(arguments_: readonly string[], allowed: readonly string[]): void {
  for (let index = 0; index < arguments_.length; index += 2) {
    if (!allowed.includes(arguments_[index] ?? "") || !arguments_[index + 1]) usage();
  }
}

async function writeOutput(outputPath: string, bytes: string | Uint8Array): Promise<void> {
  const absolute = path.resolve(outputPath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
}

async function main(): Promise<void> {
  const [command, manifestArgument, ...rest] = process.argv.slice(2);
  if (!["validate", "pack", "serve", "publish"].includes(command ?? "") || !manifestArgument) {
    usage();
  }
  if (path.basename(manifestArgument) !== "thorium.json") {
    throw new Error("The web-v1 manifest must be named thorium.json");
  }

  const absoluteManifest = path.resolve(manifestArgument);

  if (command === "publish") {
    rejectUnknownOptions(rest, ["--platform"]);
    const platformUrl = option(rest, "--platform");
    if (!platformUrl) usage();
    const receipt = await publishGame(absoluteManifest, {
      platformUrl,
      token: process.env.THORIUM_PUBLISH_TOKEN ?? "",
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }

  if (command === "serve") {
    rejectUnknownOptions(rest, ["--port"]);
    const rawPort = option(rest, "--port");
    const port = rawPort === undefined ? undefined : Number(rawPort);
    const preview = await startPreviewServer(
      absoluteManifest,
      port === undefined ? {} : { port },
    );
    console.error(`Thorium local preview: ${preview.url}`);
    console.error("Local development only; no AccountSession credentials or platform server are used.");
    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    await preview.close();
    return;
  }

  const loaded = await loadGamePackage(absoluteManifest);

  if (command === "validate") {
    rejectUnknownOptions(rest, ["--out"]);
    const outputPath = option(rest, "--out");
    const packed = packGamePackage(loaded);
    const canonical = `${canonicalJson(packed.descriptor)}\n`;
    if (outputPath) {
      await writeOutput(outputPath, canonical);
      console.error(
        `Validated ${loaded.manifest.packageId}@${loaded.manifest.version}; wrote ${outputPath}`,
      );
    } else process.stdout.write(canonical);
    return;
  }

  rejectUnknownOptions(rest, ["--archive", "--descriptor"]);
  const defaultName = `${loaded.manifest.packageId}-${loaded.manifest.version}.zip`;
  const archivePath = option(rest, "--archive") ?? path.join(path.dirname(absoluteManifest), defaultName);
  const descriptorPath =
    option(rest, "--descriptor") ?? path.join(path.dirname(absoluteManifest), "deploy-descriptor.json");
  const packed = packGamePackage(loaded, path.basename(archivePath));
  await writeOutput(archivePath, packed.archive);
  await writeOutput(descriptorPath, `${canonicalJson(packed.descriptor)}\n`);
  console.error(
    `Packed ${loaded.manifest.packageId}@${loaded.manifest.version}: ${packed.archive.byteLength} bytes -> ${archivePath}`,
  );
  console.error(`Wrote canonical descriptor -> ${descriptorPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
