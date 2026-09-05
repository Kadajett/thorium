import assert from "node:assert/strict";
import test from "node:test";
import { HostClient } from "./host.js";
import { runGame } from "./runtime.js";
import { createTestDevice, ManualFrameDriver, twoPlayersOneAccount } from "./testing.js";

test("auto-managed predeclared canvas cannot feed DPR-scaled backing pixels into its layout", async () => {
  const globals = ["document", "ResizeObserver", "devicePixelRatio"] as const;
  const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const fixture = createTestDevice({gameId: "dev.yougotserved.canvas-test", accountSessions: twoPlayersOneAccount, controls: []});
  const bootstrap = {...fixture.main.bootstrap, render: {...fixture.main.bootstrap.render, maximumDevicePixelRatio: 2}};
  const host = new HostClient(bootstrap, {
    readBootstrap: async () => bootstrap,
    send: () => undefined,
    subscribe: () => () => undefined,
  });
  let cssWidth = 960;
  let resize: () => void = () => assert.fail("ResizeObserver was not installed");
  let replacements = 0;
  const canvas = {
    width: 300,
    height: 150,
    style: {} as Record<string, string>,
    getBoundingClientRect() {
      // Canvas intrinsic dimensions become CSS dimensions unless independently
      // constrained. This reproduces the real browser's allocation feedback.
      return {
        width: this.style.width === "100%" ? cssWidth : this.width,
        height: this.style.height === "100%" ? 540 : this.height,
      };
    },
  };
  Object.defineProperties(globalThis, {
    document: {configurable: true, value: {
      querySelector: () => canvas,
      documentElement: {style: {}},
      body: {style: {}, replaceChildren: () => { replacements++; }},
    }},
    devicePixelRatio: {configurable: true, value: 2.30625},
    ResizeObserver: {configurable: true, value: class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect() {}
    }},
  });
  let running: Awaited<ReturnType<typeof runGame>> | undefined;
  try {
    const surface = () => ({start: () => undefined, tick: () => undefined});
    running = await runGame({main: surface, companion: surface}, {host, frameDriver: new ManualFrameDriver()});
    for (let count = 0; count < 3; count++) resize();
    assert.deepEqual(canvas.getBoundingClientRect(), {width: 960, height: 540});
    assert.equal(canvas.width, 1920);
    assert.equal(canvas.height, 1080);
    assert.equal(replacements, 0, "Adopting an existing canvas must preserve its surrounding DOM");

    cssWidth = 620;
    resize();
    resize();
    assert.deepEqual(canvas.getBoundingClientRect(), {width: 620, height: 540});
    assert.equal(canvas.width, 1240);
    assert.equal(canvas.height, 1080);
  } finally {
    running?.stop();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
