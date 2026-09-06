import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { KeyObject } from "node:crypto";
import type { Server } from "@colyseus/core";
import type { ThoriumGameModule, ThoriumGameRoomDefinition } from "@thorium/game-host-api";
import type { AdmissionService } from "./admission.js";
import { moduleReleaseKey } from "./core/release-key.js";
import type { ServerModuleDescriptor } from "./module-descriptor.js";
import { moduleEntries } from "./module-files.js";
import { createModuleOperationQueue } from "./module-operation-queue.js";
import { initializeGameModule } from "./module-runtime.js";
import { modulePublicKey, verifiedModuleDescriptor } from "./module-verification.js";
import type { PlatformRegistryClient } from "./registry-client.js";

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
  readonly admission: Pick<AdmissionService, "scoped">;
  readonly registry: Pick<PlatformRegistryClient, "scoped">;
  readonly registerRoom: (physicalName: string, definition: ThoriumGameRoomDefinition) => void;
}

export interface GameModuleLoaderPort {
  readonly loaded: readonly LoadedGameModule[];
  readonly scan: () => Promise<number>;
  readonly dispose: () => Promise<void>;
}

async function scanModules(
  options: GameModuleLoaderOptions,
  key: KeyObject,
  loaded: Map<string, LoadedGameModule>,
): Promise<number> {
  await mkdir(options.stateDirectory, { recursive: true });
  const entries = await moduleEntries(options.moduleDirectory);
  let added = 0;
  for (const entry of entries) {
    const id = moduleReleaseKey(entry.release);
    if (loaded.has(id)) continue;
    const descriptor = await verifiedModuleDescriptor(entry, key);
    loaded.set(id, await initializeGameModule(entry, descriptor, options));
    added += 1;
  }
  return added;
}

async function disposeModules(loaded: Map<string, LoadedGameModule>): Promise<void> {
  const modules = [...loaded.values()].reverse();
  loaded.clear();
  await Promise.allSettled(modules.map(async (entry) => entry.module.dispose?.()));
}

/** File/import/registration effects are owned here; contract policy is pure. */
export function createGameModuleLoader(input: GameModuleLoaderOptions): GameModuleLoaderPort {
  const options = {
    ...input,
    moduleDirectory: resolve(input.moduleDirectory),
    stateDirectory: resolve(input.stateDirectory),
  };
  const key = modulePublicKey(options.moduleSigningPublicKeyPem);
  const loaded = new Map<string, LoadedGameModule>();
  const ordered = createModuleOperationQueue();
  return {
    get loaded() {
      return [...loaded.values()];
    },
    scan: () => ordered(() => scanModules(options, key, loaded)),
    dispose: () => ordered(() => disposeModules(loaded)),
  };
}

/** Compatibility constructor for existing host compositions; no duplicate policy. */
export class GameModuleLoader implements GameModuleLoaderPort {
  readonly #port: GameModuleLoaderPort;
  constructor(options: GameModuleLoaderOptions) {
    this.#port = createGameModuleLoader(options);
  }
  get loaded(): readonly LoadedGameModule[] {
    return this.#port.loaded;
  }
  scan(): Promise<number> {
    return this.#port.scan();
  }
  dispose(): Promise<void> {
    return this.#port.dispose();
  }
}

export function registerOnServer(server: Server): GameModuleLoaderOptions["registerRoom"] {
  return (physicalName, definition) => {
    const handler = server.define(physicalName, definition.roomClass);
    const filters = definition.filterBy ?? [];
    if (filters.length > 0) handler.filterBy([...filters]);
  };
}
