import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExactGameRelease,
  ThoriumGameRoomDefinition,
  GameHostAdmissionPort,
  GameHostRegistryPort,
} from "@thorium/game-host-api";
import { canonicalJson, sha256 } from "../src/canonical-json.js";
import { GameModuleLoader } from "../src/module-loader.js";

const temporaryDirectories: string[] = [];
function unexpectedHostOperation(): Promise<never> {
  return Promise.reject(
    new Error("Fixture module must not request host admission or registry effects"),
  );
}
const fixtureAdmission: GameHostAdmissionPort = {
  verifyPlatform: unexpectedHostOperation,
  consumePlatform: unexpectedHostOperation,
  issueTransfer: unexpectedHostOperation,
  verifyTransfer: unexpectedHostOperation,
  consumeTransfer: unexpectedHostOperation,
};
const fixtureRegistry: GameHostRegistryPort = {
  admit: unexpectedHostOperation,
  isActive: unexpectedHostOperation,
  finish: unexpectedHostOperation,
};
export interface FixtureOptions {
  readonly tamperEntrypoint?: boolean;
  readonly tamperDigest?: boolean;
  readonly tamperSignature?: boolean;
  readonly pathVersion?: string;
  readonly moduleReturn?: string;
}
export type Registration = {
  readonly name: string;
  readonly definition: ThoriumGameRoomDefinition;
};
const release: ExactGameRelease = {
  packageId: "dev.yougotserved.fixture",
  version: "0.1.0",
  contentDigest: "a".repeat(64),
};

export async function cleanupModuleFixtures(): Promise<void> {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}

function fixtureSource(result?: string): string {
  const module =
    result ??
    "{ apiVersion: 'thorium-game-host-v1', rooms: [{ localName: 'game_session', kind: 'account-session', filterBy: ['gameSessionId'], roomClass: FixtureRoom }] }";
  return [
    `import { Room } from ${JSON.stringify(import.meta.resolve("@colyseus/core"))};`,
    "class FixtureRoom extends Room {}",
    "export function createThoriumGameModule(context) {",
    "  if (context.release.packageId !== 'dev.yougotserved.fixture') throw new Error('bad scope');",
    `  return ${module};`,
    "}",
  ].join("\n");
}

function fixtureDescriptor(bytes: Buffer) {
  return {
    schema: 1,
    apiVersion: "thorium-game-host-v1",
    release,
    entrypoint: "server.mjs",
    entrypointSha256: sha256(bytes),
    entrypointSizeBytes: bytes.length,
    rooms: [{ localName: "game_session", kind: "account-session", filterBy: ["gameSessionId"] }],
  } as const;
}

async function writeSignedFixture(directory: string, options: FixtureOptions): Promise<string> {
  const source = fixtureSource(options.moduleReturn);
  const descriptor = fixtureDescriptor(Buffer.from(source));
  const keys = generateKeyPairSync("ed25519");
  const signingKey =
    options.tamperSignature === true ? generateKeyPairSync("ed25519").privateKey : keys.privateKey;
  const signature = sign(null, Buffer.from(canonicalJson(descriptor)), signingKey);
  await Promise.all([
    writeFile(join(directory, "server-module.json"), JSON.stringify(descriptor)),
    writeFile(join(directory, "server-module.sig"), signature.toString("base64")),
    writeFile(join(directory, "server.mjs"), storedSource(source, options)),
  ]);
  return keys.publicKey.export({ format: "pem", type: "spki" }).toString();
}

function storedSource(source: string, options: FixtureOptions): string {
  if (options.tamperEntrypoint === true) return `${source}\n// tampered`;
  return options.tamperDigest === true ? source.replace("FixtureRoom", "FixtureRoam") : source;
}

export async function moduleFixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "thorium-host-loader-"));
  temporaryDirectories.push(root);
  const directory = join(
    root,
    "modules",
    release.packageId,
    options.pathVersion ?? release.version,
    release.contentDigest,
  );
  await mkdir(directory, { recursive: true });
  return { root, release, publicKeyPem: await writeSignedFixture(directory, options) };
}

export function loaderFor(
  setup: Awaited<ReturnType<typeof moduleFixture>>,
  registrations: Registration[],
) {
  return new GameModuleLoader({
    moduleDirectory: join(setup.root, "modules"),
    stateDirectory: join(setup.root, "state"),
    endpoint: "https://games.yougotserved.dev/play",
    moduleSigningPublicKeyPem: setup.publicKeyPem,
    admission: { scoped: () => fixtureAdmission },
    registry: { scoped: () => fixtureRegistry },
    registerRoom: (name, definition) => {
      registrations.push({ name, definition });
    },
  });
}
