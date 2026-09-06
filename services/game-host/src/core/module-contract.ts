import {
  GAME_HOST_API_VERSION,
  type CreateThoriumGameModule,
  type ThoriumGameModule,
  type ThoriumGameRoomDefinition,
} from "@thorium/game-host-api";

interface RoomContract {
  readonly localName: string;
  readonly kind: string;
  readonly filterBy: readonly string[];
}
type RoomConstructorCheck = (value: unknown) => value is ThoriumGameRoomDefinition["roomClass"];
type ModuleDisposer = () => unknown;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, error: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(error);
  return value;
}

export function gameModuleFactory(value: unknown, directory: string): CreateThoriumGameModule {
  const factory = record(value, "module_namespace_invalid").createThoriumGameModule;
  if (typeof factory !== "function") throw new Error(`module_factory_missing:${directory}`);
  return factory as CreateThoriumGameModule;
}

function optionalDisposer(value: unknown): ModuleDisposer | undefined {
  return typeof value === "function" ? (value as ModuleDisposer) : undefined;
}

export function gameModuleDisposer(value: unknown): ModuleDisposer | undefined {
  if (!isRecord(value)) return undefined;
  return optionalDisposer(value.dispose);
}

function roomList(value: unknown, length: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new Error("module_room_manifest_mismatch");
  return value as readonly unknown[];
}

function sameFilters(value: unknown, expected: readonly string[]): boolean {
  const actual: unknown = value === undefined ? [] : value;
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((filter, index) => actual[index] === filter)
  );
}

function assertRoom(
  actual: Readonly<Record<string, unknown>>,
  expected: RoomContract,
  isRoomConstructor: RoomConstructorCheck,
): void {
  if (actual.kind !== expected.kind || !sameFilters(actual.filterBy, expected.filterBy)) {
    throw new Error(`module_room_manifest_mismatch:${expected.localName}`);
  }
  if (!isRoomConstructor(actual.roomClass))
    throw new Error(`module_room_class_invalid:${expected.localName}`);
}

function uniqueRooms(values: readonly unknown[]): readonly Readonly<Record<string, unknown>>[] {
  const rooms: readonly Readonly<Record<string, unknown>>[] = values.map((value) =>
    record(value, "module_room_manifest_mismatch"),
  );
  const names: readonly unknown[] = rooms.map((room) => room.localName);
  if (new Set(names).size !== rooms.length) throw new Error("module_room_name_duplicate");
  return rooms;
}

function assertRooms(
  values: readonly unknown[],
  expected: readonly RoomContract[],
  isRoomConstructor: RoomConstructorCheck,
): void {
  const rooms = uniqueRooms(values);
  for (const contract of expected) {
    const actual = rooms.find((room) => room.localName === contract.localName);
    assertRoom(
      record(actual, `module_room_manifest_mismatch:${contract.localName}`),
      contract,
      isRoomConstructor,
    );
  }
}

export function assertGameModule(
  expected: readonly RoomContract[],
  value: unknown,
  isRoomConstructor: RoomConstructorCheck,
): asserts value is ThoriumGameModule {
  const module = record(value, "module_api_version_mismatch");
  if (module.apiVersion !== GAME_HOST_API_VERSION) throw new Error("module_api_version_mismatch");
  if (module.dispose !== undefined && typeof module.dispose !== "function")
    throw new Error("module_dispose_invalid");
  assertRooms(roomList(module.rooms, expected.length), expected, isRoomConstructor);
}
