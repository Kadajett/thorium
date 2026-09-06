import assert from "node:assert/strict";
import { createTestDevice, twoPlayersOneAccount } from "./testing.js";
import { testHost } from "./test-fixtures.js";
import type { DualSurfaceGame } from "./types.js";

export const emptyGame: DualSurfaceGame = {
  main: () => ({ start: () => undefined, tick: () => undefined }),
  companion: () => ({ start: () => undefined, tick: () => undefined }),
};
export function runtimeHost(gameId: string) {
  const fixture = createTestDevice({ gameId, accountSessions: twoPlayersOneAccount, controls: [] });
  const bootstrap = {
    ...fixture.main.bootstrap,
    render: { ...fixture.main.bootstrap.render, maximumDevicePixelRatio: 2 },
  };
  return testHost(bootstrap);
}
export function restoreGlobals(names: readonly string[]): () => void {
  const previous = names.map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  return () => {
    for (const [name, descriptor] of previous) {
      restoreGlobal(name, descriptor);
    }
  };
}
function restoreGlobal(name: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor !== undefined) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}
interface OverlayElement {
  readonly dataset: Record<string, string>;
  readonly style: { cssText: string };
  readonly attributes: Record<string, string>;
  textContent: string;
  removed: boolean;
  readonly setAttribute: (key: string, value: string) => void;
  readonly attachShadow: () => Readonly<{ append: () => void }>;
  readonly remove: () => void;
}
function overlayElement(): OverlayElement {
  const element: OverlayElement = {
    dataset: {},
    style: { cssText: "" },
    attributes: {},
    textContent: "",
    removed: false,
    setAttribute: (key, value) => {
      element.attributes[key] = value;
    },
    attachShadow: () => ({ append: () => undefined }),
    remove: () => {
      element.removed = true;
    },
  };
  return element;
}
export function overlayDocument() {
  const elements: OverlayElement[] = [];
  let mounts = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        const element = overlayElement();
        elements.push(element);
        return element;
      },
      body: {
        append: () => {
          mounts++;
        },
      },
    },
  });
  return {
    elements,
    mounts: () => mounts,
    element: (index: number) => {
      const element = elements[index];
      assert.ok(element !== undefined);
      return element;
    },
  };
}
interface ResizeState {
  width: number;
  replacements: number;
  resize: () => void;
}
function feedbackCanvas(state: ResizeState) {
  const canvas = {
    width: 300,
    height: 150,
    style: {} as Record<string, string>,
    getBoundingClientRect() {
      // Intrinsic backing dimensions feed layout unless independently constrained.
      return {
        width: canvas.style.width === "100%" ? state.width : canvas.width,
        height: canvas.style.height === "100%" ? 540 : canvas.height,
      };
    },
  };
  return canvas;
}
function resizeObserver(state: ResizeState) {
  return function fixtureObserver(callback: () => void) {
    state.resize = callback;
    return { observe: () => undefined, disconnect: () => undefined };
  };
}
export function canvasDocument() {
  const state: ResizeState = {
    width: 960,
    replacements: 0,
    resize: () => assert.fail("ResizeObserver was not installed"),
  };
  const canvas = feedbackCanvas(state);
  Object.defineProperties(globalThis, {
    document: {
      configurable: true,
      value: {
        querySelector: () => canvas,
        documentElement: { style: {} },
        body: {
          style: {},
          replaceChildren: () => {
            state.replacements++;
          },
        },
      },
    },
    devicePixelRatio: { configurable: true, value: 2.30625 },
    ResizeObserver: { configurable: true, value: resizeObserver(state) },
  });
  return {
    canvas,
    resize: () => {
      state.resize();
    },
    replacements: () => state.replacements,
    width: (width: number) => {
      state.width = width;
    },
  };
}
