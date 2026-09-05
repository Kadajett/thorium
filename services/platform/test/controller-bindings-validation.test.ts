import { describe, expect, it } from "vitest";
import { verifyPublishedGameRelease } from "../src/publication/verify-game-release.js";
import { createControllerBindingsTestGamePackageFixture } from
  "./test-game-package-fixture.js";

const controls = [
  { id: "primary", label: "Primary action", kind: "button" },
  { id: "secondary", label: "Secondary action", kind: "button" },
  { id: "movement", label: "Movement", kind: "axis" },
] as const;

function verify(controllerBindings: unknown) {
  const fixture = createControllerBindingsTestGamePackageFixture({
    controls,
    controllerBindings,
  });
  return verifyPublishedGameRelease({
    descriptor: fixture.descriptor,
    archive: {
      fileName: fixture.artifact.key.fileName,
      bytes: fixture.artifact.bytes,
    },
    publicBaseUrl: "https://games.yougotserved.dev",
    publishedAt: "2026-09-04T20:00:00.000Z",
  });
}

describe("controller binding manifest validation", () => {
  it.each([
    {
      name: "an empty binding list",
      value: { schema: 1, bindings: [] },
    },
    {
      name: "more than 64 bindings",
      value: {
        schema: 1,
        bindings: Array.from({ length: 65 }, () => (
          { kind: "button", input: "south", control: "primary" }
        )),
      },
    },
    {
      name: "a schema version other than 1",
      value: {
        schema: 2,
        bindings: [{ kind: "button", input: "south", control: "primary" }],
      },
    },
    {
      name: "unknown fields on the container",
      value: {
        schema: 1,
        bindings: [{ kind: "button", input: "south", control: "primary" }],
        fallback: true,
      },
    },
    {
      name: "unknown fields on a binding",
      value: {
        schema: 1,
        bindings: [{ kind: "button", input: "south", control: "primary", turbo: true }],
      },
    },
    {
      name: "an unknown button input",
      value: {
        schema: 1,
        bindings: [{ kind: "button", input: "menu", control: "primary" }],
      },
    },
    {
      name: "an unknown axis input",
      value: {
        schema: 1,
        bindings: [{ kind: "axis", input: "accelerometer-x", control: "movement" }],
      },
    },
    {
      name: "an axis-button direction other than negative or positive one",
      value: {
        schema: 1,
        bindings: [
          { kind: "axis-button", input: "left-x", direction: 0, control: "primary" },
        ],
      },
    },
    {
      name: "an undeclared control",
      value: {
        schema: 1,
        bindings: [{ kind: "button", input: "south", control: "missing" }],
      },
    },
    {
      name: "a button source targeting an axis control",
      value: {
        schema: 1,
        bindings: [{ kind: "button", input: "south", control: "movement" }],
      },
    },
    {
      name: "an axis source targeting a button control",
      value: {
        schema: 1,
        bindings: [{ kind: "axis", input: "left-x", control: "primary" }],
      },
    },
    {
      name: "an axis-button source targeting an axis control",
      value: {
        schema: 1,
        bindings: [
          { kind: "axis-button", input: "left-x", direction: -1, control: "movement" },
        ],
      },
    },
  ])("rejects $name", ({ value }) => {
    expect(() => verify(value)).toThrow();
  });

  it.each([
    {
      name: "button source",
      bindings: [
        { kind: "button", input: "south", control: "primary" },
        { kind: "button", input: "south", control: "secondary" },
      ],
    },
    {
      name: "axis source",
      bindings: [
        { kind: "axis", input: "left-x", control: "movement" },
        { kind: "axis", input: "left-x", control: "movement" },
      ],
    },
    {
      name: "axis-button source and direction",
      bindings: [
        { kind: "axis-button", input: "left-x", direction: -1, control: "primary" },
        { kind: "axis-button", input: "left-x", direction: -1, control: "secondary" },
      ],
    },
  ])("rejects a duplicate $name", ({ bindings }) => {
    expect(() => verify({ schema: 1, bindings })).toThrow("controller binding sources must be unique");
  });

  it("rejects axis and axis-button mappings for the same physical axis", () => {
    expect(() => verify({
      schema: 1,
      bindings: [
        { kind: "axis", input: "left-x", control: "movement" },
        { kind: "axis-button", input: "left-x", direction: 1, control: "primary" },
      ],
    })).toThrow("an axis input cannot mix axis and axis-button bindings");
  });

  it("allows shared button targets and distinct controls for opposite axis directions", () => {
    const controllerBindings = {
      schema: 1,
      bindings: [
        { kind: "button", input: "south", control: "primary" },
        { kind: "button", input: "east", control: "primary" },
        { kind: "axis-button", input: "left-x", direction: -1, control: "primary" },
        { kind: "axis-button", input: "left-x", direction: 1, control: "secondary" },
      ],
    } as const;

    expect(verify(controllerBindings).release.controllerBindings).toEqual(controllerBindings);
  });
});
