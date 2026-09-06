import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest, ManifestValidationError } from "./manifest.js";
import { CONTROLLER_AXES, CONTROLLER_BUTTONS } from "./controller-bindings.js";
import { packGamePackage } from "./pack.js";
import { unzipSync } from "fflate";
import { HostClient, assertBootstrap } from "./host.js";
import { validManifest, testDevice } from "./test-fixtures.js";
import { createMemoryTransport } from "./memory-transport.js";
import type { GameBootstrap, HostTransport } from "./types.js";
const controls = [
  ...validManifest.controls,
  { id: "steer", label: "Steer", kind: "axis" },
] as const;
const button = { kind: "button", input: "south", control: "tap" };
const axis = { kind: "axis", input: "left-x", control: "steer" };
const direction = { kind: "axis-button", input: "left-y", direction: -1, control: "tap" };
const profile = { schema: 1, bindings: [button, axis, direction] };
function controlled(controllerBindings: unknown) {
  return validateManifest({ ...validManifest, controls, controllerBindings });
}
function seats(defaultLocalSeatPlan: unknown) {
  return validateManifest({
    ...validManifest,
    players: { ...validManifest.players, defaultLocalSeatPlan },
  });
}
await test("validates release-authored local seat routing and required online authority", () => {
  assert.deepEqual(seats({ main: [], companion: [0] }).players.defaultLocalSeatPlan, {
    main: [],
    companion: [0],
  });
  const multiplayer = { ...validManifest.multiplayer, requiresOnline: true };
  assert.equal(
    validateManifest({ ...validManifest, multiplayer }).multiplayer.requiresOnline,
    true,
  );
  assert.throws(
    () => validateManifest({ ...validManifest, multiplayer: { ...multiplayer, online: false } }),
    ManifestValidationError,
  );
});
await test("rejects duplicated, missing, out-of-range and extra seat plan fields", () => {
  for (const plan of [
    { main: [0], companion: [0] },
    { main: [], companion: [] },
    { main: [16], companion: [] },
    { main: [0] },
    { main: [0], companion: [], other: [] },
  ])
    assert.throws(() => seats(plan), ManifestValidationError);
});
await test("controller profiles are included in immutable package identity without legacy defaults", () => {
  const manifest = controlled(profile);
  assert.deepEqual(manifest.controllerBindings, profile);
  const files = validManifest.runtime.files.map((path) => ({
    path,
    bytes: new TextEncoder().encode("game fixture"),
  }));
  const packed = packGamePackage({ manifest, files });
  const archiveManifest: unknown = JSON.parse(
    new TextDecoder().decode(unzipSync(packed.archive)["thorium.json"]),
  );
  assert.deepEqual(validateManifest(archiveManifest).controllerBindings, profile);
  const changed = controlled({
    schema: 1,
    bindings: [{ ...button, input: "north" }, axis, direction],
  });
  assert.notEqual(
    packed.descriptor.manifestSha256,
    packGamePackage({ manifest: changed, files }).descriptor.manifestSha256,
  );
  assert.equal(validateManifest(validManifest).controllerBindings, undefined);
});
await test("all physical controller inputs and shared semantic buttons are supported", () => {
  for (const input of CONTROLLER_BUTTONS)
    controlled({ schema: 1, bindings: [{ ...button, input }] });
  for (const input of CONTROLLER_AXES) controlled({ schema: 1, bindings: [{ ...axis, input }] });
  controlled({ schema: 1, bindings: [button, direction] });
});
const invalidBindings = [
  [button, button],
  [{ ...button, input: "button-999" }],
  [{ ...button, control: "undeclared" }],
  [{ ...button, control: "steer" }],
  [{ ...axis, control: "tap" }],
  [{ ...direction, direction: 0 }],
  [{ ...direction, direction: "-1" }],
  [{ ...button, direction: 1 }],
  [{ ...axis, threshold: 0.1 }],
  [axis, { ...direction, input: "left-x" }],
];
await test("malformed controller profiles reject unknown fields, aliases and conflicting physical sources", () => {
  const invalid = [
    null,
    { schema: 2, bindings: [button] },
    { schema: 1, bindings: [] },
    { schema: 1, bindings: Array.from({ length: 65 }, () => button) },
    { ...profile, playerSlot: 0 },
    ...invalidBindings.map((bindings) => ({ schema: 1, bindings })),
  ];
  for (const candidate of invalid)
    assert.throws(() => controlled(candidate), ManifestValidationError);
});
await test("bootstrap exposes controller authority without granting new PlayerSlot leases", () => {
  const fixture = testDevice(),
    bootstrap = fixture.main.bootstrap;
  const { transport } = createMemoryTransport(bootstrap);
  verifyControllerAuthority(bootstrap, transport);
  assert.equal(new HostClient(bootstrap, transport).bootstrap.controllerInput, undefined);
  assert.throws(() => {
    assertBootstrap({ ...bootstrap, controllerInput: "arbitrary" });
  }, /controller input authority/);
});
function verifyControllerAuthority(bootstrap: GameBootstrap, transport: HostTransport): void {
  for (const controllerInput of ["native", "browser"] as const) {
    const host = new HostClient({ ...bootstrap, controllerInput }, transport);
    assert.equal(host.bootstrap.controllerInput, controllerInput);
    assert.ok(Object.isFrozen(host.bootstrap));
    assert.deepEqual(host.bootstrap.controlledPlayerSlots, bootstrap.controlledPlayerSlots);
  }
}
await test("rejects traversal and online manifests without the Colyseus capability", () => {
  assert.throws(
    () =>
      validateManifest({
        ...validManifest,
        runtime: {
          ...validManifest.runtime,
          entrypoints: {
            ...validManifest.runtime.entrypoints,
            main: { ...validManifest.runtime.entrypoints.main, path: "../index.html" },
          },
        },
        capabilities: ["same-device-peer"],
      }),
    (error: unknown) =>
      error instanceof ManifestValidationError &&
      error.issues.some((issue) => issue.includes("relative package path")) &&
      error.issues.some((issue) => issue.includes("colyseus-session")),
  );
});
