import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Room } from "@colyseus/core";
import {
  GAME_HOST_API_VERSION,
  type CreateThoriumGameModule,
  type ThoriumGameHostContext,
  type ThoriumGameModule,
  type ThoriumGameRoomDefinition,
} from "@thorium/game-host-api";
import { assertGameModule, gameModuleFactory, gameModuleDisposer } from "./core/module-contract.js";
import type { ServerModuleDescriptor } from "./module-descriptor.js";
import { moduleStateDirectory, type ModuleEntry } from "./module-files.js";
import type { GameModuleLoaderOptions, LoadedGameModule } from "./module-loader.js";
import { physicalRoomName } from "./room-name.js";

function isRoomConstructor(value: unknown): value is ThoriumGameRoomDefinition["roomClass"] {
  return typeof value === "function" && value.prototype instanceof Room;
}

async function moduleContext(
  entry: ModuleEntry,
  descriptor: ServerModuleDescriptor,
  options: GameModuleLoaderOptions,
): Promise<ThoriumGameHostContext> {
  const registry = options.registry.scoped(entry.release);
  const localRoomNames = new Set(descriptor.rooms.map((room) => room.localName));
  return {
    apiVersion: GAME_HOST_API_VERSION,
    release: entry.release,
    endpoint: options.endpoint,
    stateDirectory: await moduleStateDirectory(options.stateDirectory, entry.release),
    roomName: (name) => physicalRoomName(entry.release, name),
    admission: options.admission.scoped(
      entry.release,
      (name) => localRoomNames.has(name),
      (fence) => registry.isActive(fence),
    ),
    registry,
  };
}

async function createModule(
  entry: ModuleEntry,
  descriptor: ServerModuleDescriptor,
  options: GameModuleLoaderOptions,
): Promise<unknown> {
  const context = await moduleContext(entry, descriptor, options);
  const url = pathToFileURL(join(entry.directory, descriptor.entrypoint));
  const factory = await moduleFactory(
    `${url.href}?digest=${entry.release.contentDigest}`,
    entry.directory,
  );
  return factory(context);
}

async function moduleFactory(url: string, directory: string): Promise<CreateThoriumGameModule> {
  const imported: unknown = await import(url);
  return gameModuleFactory(imported, directory);
}

async function disposeRejectedModule(value: unknown): Promise<void> {
  const dispose = gameModuleDisposer(value);
  if (dispose !== undefined) await dispose.call(value);
}

function registerModule(
  module: ThoriumGameModule,
  entry: ModuleEntry,
  options: GameModuleLoaderOptions,
): void {
  for (const definition of module.rooms) {
    options.registerRoom(physicalRoomName(entry.release, definition.localName), definition);
  }
}

export async function initializeGameModule(
  entry: ModuleEntry,
  descriptor: ServerModuleDescriptor,
  options: GameModuleLoaderOptions,
): Promise<LoadedGameModule> {
  const module = await createModule(entry, descriptor, options);
  try {
    assertGameModule(descriptor.rooms, module, isRoomConstructor);
    registerModule(module, entry, options);
  } catch (error) {
    await disposeRejectedModule(module);
    throw error;
  }
  return { descriptor, module, directory: entry.directory };
}
