import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { startPreviewServer } from "./preview-server.js";
import { PreviewRouter } from "./preview.js";
import { SurfaceRole, type GameBootstrap } from "./types.js";

const previewManifest = {
  schema: 1,
  packageId: "dev.yougotserved.preview-test",
  version: "1.0.0",
  displayName: "Preview Test",
  summary: "Exercises the local dual-surface preview.",
  description: "A complete web-v1 package used to test preview isolation and routing.",
  runtime: {
    kind: "web-v1",
    sdkCompatibility: "^0.1.0",
    entrypoints: {
      main: { path: "main/index.html", purpose: "primary-gameplay" },
      companion: { path: "companion/index.html", purpose: "companion-controls" },
    },
    files: ["main/index.html", "companion/index.html", "dist/game.js"],
  },
  displays: {
    requiredSurfaces: ["main", "companion"],
    supportsSingleSurfaceFallback: false,
    main: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
    companion: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
  },
  players: { minSlots: 2, maxSlots: 2, maxLocalSlots: 2, sameAccountMultipleSlots: true },
  multiplayer: { online: false, roomName: "game_session", protocol: "thorium-game-channel-v1" },
  controls: [{ id: "tap", label: "Tap", kind: "button" }],
  capabilities: ["same-device-peer"],
  budgets: { maxPackageBytes: 1_048_576, maxFileCount: 8, maxLocalPeerMessageBytes: 4096 },
} as const;

await test("preview handshake preserves requestId and supplies capability-only local bootstraps", () => {
  const router = new PreviewRouter(previewManifest);
  const [delivery] = router.route(
    SurfaceRole.Main,
    JSON.stringify({ kind: "bootstrap-request", requestId: "preview-request-1" }),
  );

  assert.equal(delivery?.target, SurfaceRole.Main);
  assert.equal(delivery.message.kind, "bootstrap");
  assert.equal(delivery.message.requestId, "preview-request-1");
  assertMainBootstrap(delivery.message.bootstrap);
  assert.deepEqual(router.bootstrap(SurfaceRole.Companion).controlledPlayerSlots, [1]);

  assert.deepEqual(router.route(SurfaceRole.Main, { kind: "ready", surface: "main" }), [
    { target: "main", message: { kind: "lifecycle", state: "active" } },
  ]);
  assert.throws(
    () =>
      router.route(SurfaceRole.Main, { kind: "bootstrap-request", requestId: "contains spaces" }),
    /requestId/,
  );
});
function assertMainBootstrap(bootstrap: GameBootstrap): void {
  assert.equal(bootstrap.surface, SurfaceRole.Main);
  assert.deepEqual(
    bootstrap.players.map((player) => player.slot),
    [0, 1],
  );
  assert.deepEqual(bootstrap.controlledPlayerSlots, [0]);
  assert.equal(bootstrap.colyseus, undefined);
  assert.equal(JSON.stringify(bootstrap).includes("account"), false);
}

await test("preview validates and routes semantic controls and peer messages by actual source surface", () => {
  const router = new PreviewRouter(previewManifest);
  const control = router.route(SurfaceRole.Companion, {
    kind: "control",
    event: { control: "tap", player: 1, phase: "pressed", value: 1, sequence: 7 },
  });
  assert.deepEqual(control, [
    {
      target: "main",
      message: {
        kind: "control",
        event: { control: "tap", player: 1, phase: "pressed", value: 1, sequence: 7 },
      },
    },
  ]);

  assertPeerRoute(router);
  assertInvalidRouting(router);
});
function assertPeerRoute(router: PreviewRouter): void {
  const peer = router.route(SurfaceRole.Main, {
    kind: "peer",
    source: "main",
    channel: "score",
    payload: { player: 1, score: 2 },
  });
  assert.deepEqual(peer, [
    {
      target: "companion",
      message: {
        kind: "peer",
        event: { source: "main", channel: "score", payload: { player: 1, score: 2 } },
      },
    },
  ]);
}
function assertInvalidRouting(router: PreviewRouter): void {
  assert.throws(
    () =>
      router.route(SurfaceRole.Main, {
        kind: "control",
        event: { control: "tap", player: 1, phase: "pressed", value: 1, sequence: 8 },
      }),
    /not controlled by this surface/,
  );
  assert.throws(
    () =>
      router.route(SurfaceRole.Companion, {
        kind: "peer",
        source: "main",
        channel: "score",
        payload: null,
      }),
    /envelope/,
  );
  assert.throws(
    () =>
      router.route(SurfaceRole.Companion, {
        kind: "control",
        event: { control: "raw-keycode", player: 1, phase: "pressed", value: 1, sequence: 8 },
      }),
    /Unknown preview semantic control/,
  );
}

async function rawStatus(baseUrl: string, requestPath: string): Promise<number | undefined> {
  const base = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: base.hostname,
        port: Number(base.port),
        method: "GET",
        path: requestPath,
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          resolve(response.statusCode);
        });
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

await test("preview server binds loopback and exposes only declared package files and support modules", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "thorium-preview-test-"));
  try {
    await writePreviewFixture(root);

    const server = await startPreviewServer(path.join(root, "thorium.json"), { port: 0 });
    try {
      assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      await assertPreviewShell(server.url);
      await assertPackageRoutes(server.url);
      await assertHiddenFiles(server.url);
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
async function writePreviewFixture(root: string): Promise<void> {
  for (const directory of ["main", "companion", "dist"])
    await mkdir(path.join(root, directory), { recursive: true });
  await writeFile(path.join(root, "thorium.json"), JSON.stringify(previewManifest));
  await writeFile(
    path.join(root, "main/index.html"),
    "<!doctype html><head></head><canvas></canvas>",
  );
  await writeFile(path.join(root, "companion/index.html"), "<!doctype html><canvas></canvas>");
  await writeFile(path.join(root, "dist/game.js"), "export const declared = true;");
  await writeFile(path.join(root, "secret.txt"), "must not be served");
}
async function assertPreviewShell(url: string): Promise<void> {
  const shell = await fetch(url);
  assert.equal(shell.status, 200);
  const body = await shell.text();
  assert.match(body, /id="main"/);
  assert.match(body, /id="companion"/);
  assert.match(body, /LOCAL DEVELOPMENT ONLY/);
}
async function assertPackageRoutes(url: string): Promise<void> {
  const main = await fetch(`${url}/package/main/index.html`);
  assert.equal(main.status, 200);
  assert.match(await main.text(), /\/__thorium\/bridge\.js\?surface=main/);
  assert.equal(
    await (await fetch(`${url}/package/dist/game.js`)).text(),
    "export const declared = true;",
  );
  for (const moduleName of ["preview.js", "manifest.js", "types.js"])
    assert.equal((await fetch(`${url}/__thorium/${moduleName}`)).status, 200);
}
async function assertHiddenFiles(url: string): Promise<void> {
  for (const resource of ["/package/secret.txt", "/secret.txt", "/package/thorium.json"])
    assert.equal((await fetch(`${url}${resource}`)).status, 404);
  assert.equal(await rawStatus(url, "/package/%2e%2e/secret.txt"), 400);
  assert.equal(await rawStatus(url, "/package/main%2findex.html"), 400);
}
