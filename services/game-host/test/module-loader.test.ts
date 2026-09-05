import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ThoriumGameRoomDefinition } from "@thorium/game-host-api";
import type { AdmissionService } from "../src/admission.js";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { GameModuleLoader } from "../src/module-loader.js";
import type { PlatformRegistryClient } from "../src/registry-client.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function fixture(options: { tamperEntrypoint?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "thorium-host-loader-"));
  temporaryDirectories.push(root);
  const release = {
    packageId: "dev.yougotserved.fixture",
    version: "0.1.0",
    contentDigest: "a".repeat(64),
  } as const;
  const releaseDirectory = join(
    root,
    "modules",
    release.packageId,
    release.version,
    release.contentDigest,
  );
  await mkdir(releaseDirectory, { recursive: true });
  const coreUrl = import.meta.resolve("@colyseus/core");
  const entrypoint = [
    `import { Room } from ${JSON.stringify(coreUrl)};`,
    "class FixtureRoom extends Room {}",
    "export function createThoriumGameModule(context) {",
    "  if (context.release.packageId !== 'dev.yougotserved.fixture') throw new Error('bad scope');",
    "  return { apiVersion: 'thorium-game-host-v1', rooms: [{",
    "    localName: 'game_session', kind: 'account-session',",
    "    filterBy: ['gameSessionId'], roomClass: FixtureRoom",
    "  }] };",
    "}",
  ].join("\n");
  const entrypointBytes = Buffer.from(entrypoint);
  const descriptor = {
    schema: 1,
    apiVersion: "thorium-game-host-v1",
    release,
    entrypoint: "server.mjs",
    entrypointSha256: sha256(entrypointBytes),
    entrypointSizeBytes: entrypointBytes.length,
    rooms: [{
      localName: "game_session",
      kind: "account-session",
      filterBy: ["gameSessionId"],
    }],
  } as const;
  const keys = generateKeyPairSync("ed25519");
  const signature = sign(null, Buffer.from(canonicalJson(descriptor)), keys.privateKey);
  await Promise.all([
    writeFile(join(releaseDirectory, "server-module.json"), JSON.stringify(descriptor)),
    writeFile(join(releaseDirectory, "server-module.sig"), signature.toString("base64")),
    writeFile(
      join(releaseDirectory, "server.mjs"),
      options.tamperEntrypoint ? `${entrypoint}\n// tampered` : entrypoint,
    ),
  ]);
  return {
    root,
    release,
    publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

function loaderFor(
  setup: Awaited<ReturnType<typeof fixture>>,
  registrations: Array<{ name: string; definition: ThoriumGameRoomDefinition }>,
) {
  return new GameModuleLoader({
    moduleDirectory: join(setup.root, "modules"),
    stateDirectory: join(setup.root, "state"),
    endpoint: "https://games.yougotserved.dev/play",
    moduleSigningPublicKeyPem: setup.publicKeyPem,
    admission: { scoped: () => ({}) } as unknown as AdmissionService,
    registry: { scoped: () => ({}) } as unknown as PlatformRegistryClient,
    registerRoom: (name, definition) => registrations.push({ name, definition }),
  });
}

describe("GameModuleLoader", () => {
  it("verifies and registers an immutable signed module only once", async () => {
    const setup = await fixture();
    const registrations: Array<{ name: string; definition: ThoriumGameRoomDefinition }> = [];
    const loader = loaderFor(setup, registrations);

    await expect(loader.scan()).resolves.toBe(1);
    await expect(loader.scan()).resolves.toBe(0);
    expect(loader.loaded).toHaveLength(1);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.name).toMatch(/^g_[a-f0-9]{32}$/);
    expect(registrations[0]?.definition.localName).toBe("game_session");
  });

  it("rejects entrypoint bytes changed after the descriptor was signed", async () => {
    const setup = await fixture({ tamperEntrypoint: true });
    const loader = loaderFor(setup, []);
    await expect(loader.scan()).rejects.toThrow("module_entrypoint_size_mismatch");
    expect(loader.loaded).toHaveLength(0);
  });
});
