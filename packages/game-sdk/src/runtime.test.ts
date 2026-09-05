import assert from "node:assert/strict";
import test from "node:test";
import { HostClient } from "./host.js";
import { runGame } from "./runtime.js";
import { createTestDevice, ManualFrameDriver, twoPlayersOneAccount } from "./testing.js";
import type { HostInboundMessage } from "./types.js";

test("default FPS overlay follows game frames and lifecycle; opt-out creates no DOM", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const elements: Array<{
    dataset: Record<string, string>;
    style: {cssText: string};
    textContent: string;
    removed: boolean;
    attributes: Record<string, string>;
    setAttribute(key: string, value: string): void;
    attachShadow(): {append(): void};
    remove(): void;
  }> = [];
  let mounts = 0;
  Object.defineProperty(globalThis, "document", {configurable: true, value: {
    createElement: () => {
      const element = {
        dataset: {}, style: {cssText: ""}, textContent: "", removed: false,
        attributes: {} as Record<string, string>,
        setAttribute(key: string, value: string) { this.attributes[key] = value; },
        attachShadow: () => ({append: () => undefined}),
        remove() { this.removed = true; },
      };
      elements.push(element);
      return element;
    },
    body: {append: () => { mounts++; }},
  }});
  const fixture = createTestDevice({gameId: "dev.yougotserved.fps-test", accountSessions: twoPlayersOneAccount, controls: []});
  let deliver: (message: HostInboundMessage) => void = () => undefined;
  const host = new HostClient(fixture.main.bootstrap, {
    readBootstrap: async () => fixture.main.bootstrap,
    send: () => undefined,
    subscribe: (listener) => { deliver = listener; return () => undefined; },
  });
  const driver = new ManualFrameDriver();
  const surface = () => ({start: () => undefined, tick: () => undefined});
  const options = {host, canvas: {width: 960, height: 540} as HTMLCanvasElement, autoResize: false, frameDriver: driver};
  let running: Awaited<ReturnType<typeof runGame>> | undefined;
  try {
    running = await runGame({main: surface, companion: surface}, options);
    assert.equal(mounts, 1);
    const container = elements[0]!;
    const label = elements[1]!;
    assert.equal(container.attributes["aria-hidden"], "true");
    assert.match(container.style.cssText, /pointer-events:none/);
    assert.equal(label.textContent, "FPS —");
    for (let frame = 0; frame <= 50; frame++) driver.advance(frame * 20);
    assert.equal(label.textContent, "50 FPS · 20.0 ms");
    deliver({kind: "lifecycle", state: "suspended"});
    assert.throws(() => driver.advance(2_000), /No frame/);
    assert.equal(label.textContent, "FPS —");
    deliver({kind: "lifecycle", state: "active"});
    for (let frame = 0; frame <= 25; frame++) driver.advance(60_000 + frame * 40);
    assert.equal(label.textContent, "25 FPS · 40.0 ms");
    deliver({kind: "lifecycle", state: "stopped"});
    assert.equal(container.removed, true);
    assert.throws(() => driver.advance(62_000), /No frame/);
    running.stop();
    running = await runGame({main: surface, companion: surface}, {...options, fpsOverlay: false});
    for (let frame = 0; frame <= 50; frame++) driver.advance(frame * 20);
    assert.equal(mounts, 1);
    assert.equal(elements.length, 2);
  } finally {
    running?.stop();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

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
    running = await runGame({main: surface, companion: surface}, {host, frameDriver: new ManualFrameDriver(), fpsOverlay: false});
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
