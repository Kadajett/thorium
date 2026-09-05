import { createPublicKey, verify } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Room, type Server } from "@colyseus/core";
import {
  GAME_HOST_API_VERSION,
  type CreateThoriumGameModule,
  type ExactGameRelease,
  type ThoriumGameModule,
  type ThoriumGameRoomDefinition,
} from "@thorium/game-host-api";
import type { AdmissionService } from "./admission.js";
import { canonicalJson, sha256 } from "./canonical-json.js";
import {
  ServerModuleDescriptorSchema,
  type ServerModuleDescriptor,
} from "./module-descriptor.js";
import type { PlatformRegistryClient } from "./registry-client.js";
import { physicalRoomName } from "./room-name.js";

const PACKAGE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST = /^[a-f0-9]{64}$/;
const DESCRIPTOR_FILE = "server-module.json";
const SIGNATURE_FILE = "server-module.sig";
const MAX_DESCRIPTOR_BYTES = 32 * 1_024;
const MAX_SIGNATURE_BYTES = 2 * 1_024;

export interface LoadedGameModule {
  readonly descriptor: ServerModuleDescriptor;
  readonly module: ThoriumGameModule;
  readonly directory: string;
}

export interface GameModuleLoaderOptions {
  readonly moduleDirectory: string;
  readonly stateDirectory: string;
  readonly endpoint: string;
  readonly moduleSigningPublicKeyPem: string;
  readonly admission: AdmissionService;
  readonly registry: PlatformRegistryClient;
  readonly registerRoom: (
    physicalName: string,
    definition: ThoriumGameRoomDefinition,
  ) => void;
}

function releaseKey(release: ExactGameRelease): string {
  return `${release.packageId}@${release.version}#${release.contentDigest}`;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function assertRegularFile(file: string, maximumBytes: number): Promise<number> {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`unsafe_module_file:${file}`);
  if (metadata.size < 1 || metadata.size > maximumBytes) throw new Error(`invalid_module_file_size:${file}`);
  return metadata.size;
}

async function assertDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`unsafe_module_directory:${directory}`);
  }
}

async function childDirectoryNames(directory: string, pattern: RegExp): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink() || !pattern.test(entry.name)) {
      throw new Error(`invalid_module_release_path:${join(directory, entry.name)}`);
    }
    names.push(entry.name);
  }
  return names.sort();
}

function validateModule(
  descriptor: ServerModuleDescriptor,
  module: ThoriumGameModule,
): void {
  if (module.apiVersion !== GAME_HOST_API_VERSION) throw new Error("module_api_version_mismatch");
  if (!Array.isArray(module.rooms) || module.rooms.length !== descriptor.rooms.length) {
    throw new Error("module_room_manifest_mismatch");
  }
  const byName = new Map(module.rooms.map((room) => [room.localName, room]));
  if (byName.size !== module.rooms.length) throw new Error("module_room_name_duplicate");
  for (const expected of descriptor.rooms) {
    const actual = byName.get(expected.localName);
    if (
      actual === undefined || actual.kind !== expected.kind
      || !sameStrings(actual.filterBy ?? [], expected.filterBy)
    ) throw new Error(`module_room_manifest_mismatch:${expected.localName}`);
    if (typeof actual.roomClass !== "function" || !(actual.roomClass.prototype instanceof Room)) {
      throw new Error(`module_room_class_invalid:${expected.localName}`);
    }
  }
}

export class GameModuleLoader {
  readonly #moduleDirectory: string;
  readonly #stateDirectory: string;
  readonly #endpoint: string;
  readonly #publicKey: ReturnType<typeof createPublicKey>;
  readonly #admission: AdmissionService;
  readonly #registry: PlatformRegistryClient;
  readonly #registerRoom: GameModuleLoaderOptions["registerRoom"];
  readonly #loaded = new Map<string, LoadedGameModule>();

  constructor(options: GameModuleLoaderOptions) {
    this.#moduleDirectory = resolve(options.moduleDirectory);
    this.#stateDirectory = resolve(options.stateDirectory);
    this.#endpoint = options.endpoint;
    this.#publicKey = createPublicKey(options.moduleSigningPublicKeyPem);
    if (this.#publicKey.asymmetricKeyType !== "ed25519") {
      throw new Error("module signing key must be Ed25519");
    }
    this.#admission = options.admission;
    this.#registry = options.registry;
    this.#registerRoom = options.registerRoom;
  }

  get loaded(): readonly LoadedGameModule[] {
    return [...this.#loaded.values()];
  }

  async scan(): Promise<number> {
    await mkdir(this.#moduleDirectory, { recursive: true });
    await mkdir(this.#stateDirectory, { recursive: true });
    await assertDirectory(this.#moduleDirectory);
    const packages = await childDirectoryNames(this.#moduleDirectory, PACKAGE_ID);
    let added = 0;
    for (const packageId of packages) {
      const packageDirectory = join(this.#moduleDirectory, packageId);
      const versions = await childDirectoryNames(packageDirectory, VERSION);
      for (const version of versions) {
        const versionDirectory = join(packageDirectory, version);
        const digests = await childDirectoryNames(versionDirectory, DIGEST);
        for (const contentDigest of digests) {
          const release: ExactGameRelease = { packageId, version, contentDigest };
          if (this.#loaded.has(releaseKey(release))) continue;
          await this.#loadRelease(join(versionDirectory, contentDigest), release);
          added += 1;
        }
      }
    }
    return added;
  }

  async dispose(): Promise<void> {
    const modules = [...this.#loaded.values()].reverse();
    this.#loaded.clear();
    await Promise.allSettled(modules.map(async (loaded) => loaded.module.dispose?.()));
  }

  async #loadRelease(directory: string, pathRelease: ExactGameRelease): Promise<void> {
    await assertDirectory(directory);
    const descriptorFile = join(directory, DESCRIPTOR_FILE);
    const signatureFile = join(directory, SIGNATURE_FILE);
    await assertRegularFile(descriptorFile, MAX_DESCRIPTOR_BYTES);
    await assertRegularFile(signatureFile, MAX_SIGNATURE_BYTES);
    const descriptorBytes = await readFile(descriptorFile);
    const descriptor = ServerModuleDescriptorSchema.parse(JSON.parse(descriptorBytes.toString("utf8")));
    if (releaseKey(descriptor.release) !== releaseKey(pathRelease)) {
      throw new Error(`module_release_path_mismatch:${directory}`);
    }
    const canonicalDescriptor = canonicalJson(descriptor);
    const signatureText = (await readFile(signatureFile, "utf8")).trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)) {
      throw new Error(`invalid_module_signature_encoding:${directory}`);
    }
    const signature = Buffer.from(signatureText, "base64");
    if (
      signature.length !== 64
      || !verify(null, Buffer.from(canonicalDescriptor), this.#publicKey, signature)
    ) throw new Error(`invalid_module_signature:${directory}`);

    const entrypoint = join(directory, descriptor.entrypoint);
    const entrypointSize = await assertRegularFile(entrypoint, 16 * 1_024 * 1_024);
    if (entrypointSize !== descriptor.entrypointSizeBytes) {
      throw new Error(`module_entrypoint_size_mismatch:${directory}`);
    }
    const entrypointBytes = await readFile(entrypoint);
    if (sha256(entrypointBytes) !== descriptor.entrypointSha256) {
      throw new Error(`module_entrypoint_digest_mismatch:${directory}`);
    }

    const stateDirectory = join(
      this.#stateDirectory,
      pathRelease.packageId,
      pathRelease.version,
      pathRelease.contentDigest,
    );
    await mkdir(stateDirectory, { recursive: true });
    await assertDirectory(stateDirectory);
    const localRoomNames = new Set(descriptor.rooms.map((room) => room.localName));
    const scopedRegistry = this.#registry.scoped(pathRelease);
    const imported = await import(`${pathToFileURL(entrypoint).href}?digest=${pathRelease.contentDigest}`) as {
      readonly createThoriumGameModule?: CreateThoriumGameModule;
    };
    if (typeof imported.createThoriumGameModule !== "function") {
      throw new Error(`module_factory_missing:${directory}`);
    }
    const gameModule = await imported.createThoriumGameModule({
      apiVersion: GAME_HOST_API_VERSION,
      release: pathRelease,
      endpoint: this.#endpoint,
      stateDirectory,
      roomName: (localName) => physicalRoomName(pathRelease, localName),
      admission: this.#admission.scoped(
        pathRelease,
        (name) => localRoomNames.has(name),
        (fence) => scopedRegistry.isActive(fence),
      ),
      registry: scopedRegistry,
    });
    try {
      validateModule(descriptor, gameModule);
      for (const definition of gameModule.rooms) {
        this.#registerRoom(physicalRoomName(pathRelease, definition.localName), definition);
      }
    } catch (error) {
      await gameModule.dispose?.();
      throw error;
    }
    this.#loaded.set(releaseKey(pathRelease), { descriptor, module: gameModule, directory });
  }
}

/** Narrow type-check helper for the Colyseus server callback. */
export function registerOnServer(server: Server): GameModuleLoaderOptions["registerRoom"] {
  return (physicalName, definition) => {
    const handler = server.define(physicalName, definition.roomClass);
    if ((definition.filterBy?.length ?? 0) > 0) handler.filterBy([...definition.filterBy!]);
  };
}
