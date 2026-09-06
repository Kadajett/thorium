import { afterEach, expect, it } from "vitest";
import {
  cleanupModuleFixtures,
  loaderFor,
  moduleFixture,
  type Registration,
  type FixtureOptions,
} from "./module-loader-fixture.js";

afterEach(cleanupModuleFixtures);

it("verifies and registers an immutable signed module only once", async () => {
  const setup = await moduleFixture();
  const registrations: Registration[] = [];
  const loader = loaderFor(setup, registrations);
  await expect(loader.scan()).resolves.toBe(1);
  await expect(loader.scan()).resolves.toBe(0);
  expect(loader.loaded).toHaveLength(1);
  expect(registrations).toHaveLength(1);
  expect(registrations[0]?.name).toMatch(/^g_[a-f0-9]{32}$/);
  expect(registrations[0]?.definition.localName).toBe("game_session");
});

it("rejects entrypoint bytes changed after the descriptor was signed", async () => {
  const loader = loaderFor(await moduleFixture({ tamperEntrypoint: true }), []);
  await expect(loader.scan()).rejects.toThrow("module_entrypoint_size_mismatch");
  expect(loader.loaded).toHaveLength(0);
});

it.each<[FixtureOptions, string]>([
  [{ tamperDigest: true }, "module_entrypoint_digest_mismatch"],
  [{ tamperSignature: true }, "invalid_module_signature"],
  [{ pathVersion: "0.2.0" }, "module_release_path_mismatch"],
])("rejects corrupted or misplaced signed releases: %j", async (options, error) => {
  const registrations: Registration[] = [];
  const loader = loaderFor(await moduleFixture(options), registrations);
  await expect(loader.scan()).rejects.toThrow(error);
  expect(registrations).toHaveLength(0);
  expect(loader.loaded).toHaveLength(0);
});

it("serializes concurrent scans so one release is registered only once", async () => {
  const registrations: Registration[] = [];
  const loader = loaderFor(await moduleFixture(), registrations);
  expect(await Promise.all([loader.scan(), loader.scan()])).toEqual([1, 0]);
  expect(registrations).toHaveLength(1);
  expect(loader.loaded).toHaveLength(1);
});

it("disposal waits for an in-flight scan and leaves no late-loaded release", async () => {
  const loader = loaderFor(await moduleFixture(), []);
  await Promise.all([loader.scan(), loader.dispose()]);
  expect(loader.loaded).toHaveLength(0);
});

it.each([
  ["null", "module_api_version_mismatch"],
  ["{ apiVersion: 'other', rooms: [] }", "module_api_version_mismatch"],
  ["{ apiVersion: 'thorium-game-host-v1', rooms: null }", "module_room_manifest_mismatch"],
  ["{ apiVersion: 'thorium-game-host-v1', rooms: [null] }", "module_room_manifest_mismatch"],
  ["{ apiVersion: 'thorium-game-host-v1', rooms: [], dispose: 1 }", "module_dispose_invalid"],
  [
    "{ apiVersion: 'thorium-game-host-v1', rooms: [{ localName: 'game_session', kind: 'account-session', filterBy: ['gameSessionId'], roomClass: FixtureRoom }], dispose: 1 }",
    "module_dispose_invalid",
  ],
  [
    "{ apiVersion: 'thorium-game-host-v1', rooms: [{ localName: 'game_session', kind: 'public-world', filterBy: ['gameSessionId'], roomClass: FixtureRoom }] }",
    "module_room_manifest_mismatch:game_session",
  ],
  [
    "{ apiVersion: 'thorium-game-host-v1', rooms: [{ localName: 'game_session', kind: 'account-session', filterBy: null, roomClass: FixtureRoom }] }",
    "module_room_manifest_mismatch:game_session",
  ],
  [
    "{ apiVersion: 'thorium-game-host-v1', rooms: [{ localName: 'game_session', kind: 'account-session', filterBy: ['gameSessionId'], roomClass: class Other {} }] }",
    "module_room_class_invalid:game_session",
  ],
])(
  "rejects malformed factory results before registering any room: %s",
  async (moduleReturn, error) => {
    const setup = await moduleFixture({ moduleReturn });
    const registrations: Registration[] = [];
    const loader = loaderFor(setup, registrations);
    await expect(loader.scan()).rejects.toThrow(error);
    expect(registrations).toHaveLength(0);
    expect(loader.loaded).toHaveLength(0);
  },
);
