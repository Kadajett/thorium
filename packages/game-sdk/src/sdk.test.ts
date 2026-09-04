import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { unzipSync } from "fflate";
import { canonicalJson, sha256 } from "./descriptor.js";
import { connectAuthoritativeSession } from "./colyseus.js";
import { BrowserHostTransport, HostClient } from "./host.js";
import { ManifestValidationError, validateManifest } from "./manifest.js";
import { loadGamePackage, packGamePackage } from "./pack.js";
import { runGame } from "./runtime.js";
import { createTestDevice, ManualFrameDriver, twoPlayersOneAccount } from "./testing.js";
import {
  SurfaceRole,
  playerSlot,
  type GameBootstrap,
  type HostOutboundMessage,
  type HostTransport,
} from "./types.js";

const validManifest = {
  schema: 1,
  packageId: "dev.yougotserved.test-game",
  version: "1.0.0",
  displayName: "Test Game",
  summary: "A test game.",
  description: "A complete manifest used by the public-interface tests.",
  runtime: {
    kind: "web-v1",
    sdkCompatibility: "^0.1.0",
    entrypoints: {
      main: { path: "main/index.html", purpose: "primary-gameplay" },
      companion: { path: "companion/index.html", purpose: "companion-controls" },
    },
    files: ["game.js", "main/index.html", "companion/index.html"],
  },
  displays: {
    requiredSurfaces: ["main", "companion"],
    supportsSingleSurfaceFallback: false,
    main: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
    companion: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
  },
  players: { minSlots: 1, maxSlots: 4, maxLocalSlots: 2, sameAccountMultipleSlots: true },
  multiplayer: {
    online: true,
    roomName: "game_session",
    protocol: "thorium-game-channel-v1",
  },
  controls: [{ id: "tap", label: "Tap", kind: "button" }],
  capabilities: ["same-device-peer", "colyseus-session"],
  budgets: { maxPackageBytes: 1_048_576, maxFileCount: 8, maxLocalPeerMessageBytes: 4096 },
} as const;

test("packs byte-for-byte deterministic ZIPs and a stable sorted descriptor", () => {
  const manifest = validateManifest(validManifest);
  const files = [
    { path: "main/index.html", bytes: new TextEncoder().encode("<canvas></canvas>") },
    { path: "companion/index.html", bytes: new TextEncoder().encode("<canvas></canvas>") },
    { path: "game.js", bytes: new TextEncoder().encode("export {}") },
  ];
  const first = packGamePackage({ manifest, files }, "test-game.zip");
  const second = packGamePackage({ manifest, files: [...files].reverse() }, "test-game.zip");
  assert.deepEqual(first.archive, second.archive);
  assert.equal(canonicalJson(first.descriptor), canonicalJson(second.descriptor));
  assert.deepEqual(
    first.descriptor.execution.files.map((file) => file.path),
    ["companion/index.html", "game.js", "main/index.html"],
  );
  assert.deepEqual(Object.keys(unzipSync(first.archive)).sort(), [
    "companion/index.html",
    "game.js",
    "main/index.html",
    "thorium.json",
  ]);
  assert.equal(first.descriptor.bundle.sha256, sha256(first.archive));
  assert.equal(first.descriptor.bundle.sizeBytes, first.archive.byteLength);
});

test("archive digest is tamper evidence for the immutable Game Package", () => {
  const manifest = validateManifest(validManifest);
  const packed = packGamePackage({
    manifest,
    files: [
      { path: "main/index.html", bytes: new TextEncoder().encode("main") },
      { path: "companion/index.html", bytes: new TextEncoder().encode("companion") },
      { path: "game.js", bytes: new TextEncoder().encode("export {}") },
    ],
  });
  const tampered = packed.archive.slice();
  tampered[Math.floor(tampered.length / 2)]! ^= 1;
  assert.notEqual(sha256(tampered), packed.descriptor.bundle.sha256);
});

test("packing enforces real archive entry and byte budgets", () => {
  const files = [
    { path: "main/index.html", bytes: new TextEncoder().encode("main") },
    { path: "companion/index.html", bytes: new TextEncoder().encode("companion") },
    { path: "game.js", bytes: new TextEncoder().encode("export {}") },
  ];
  const tooFewEntries = validateManifest({
    ...validManifest,
    budgets: { ...validManifest.budgets, maxFileCount: 3 },
  });
  assert.throws(
    () => packGamePackage({ manifest: tooFewEntries, files }),
    /4 entries.*maxFileCount is 3/,
  );
  const tooFewBytes = validateManifest({
    ...validManifest,
    budgets: { ...validManifest.budgets, maxPackageBytes: 10 },
  });
  assert.throws(
    () => packGamePackage({ manifest: tooFewBytes, files }),
    /maxPackageBytes is 10/,
  );
});

test("rejects traversal and online manifests without the Colyseus capability", () => {
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

test("filesystem loader rejects symlinks and non-regular declared entries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "thorium-pack-test-"));
  const outside = `${root}-outside.js`;
  try {
    await mkdir(path.join(root, "main"), { recursive: true });
    await mkdir(path.join(root, "companion"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "main/index.html"), "main");
    await writeFile(path.join(root, "companion/index.html"), "companion");
    await writeFile(outside, "outside");
    await writeFile(path.join(root, "thorium.json"), JSON.stringify(validManifest));
    await symlink(outside, path.join(root, "game.js"));

    await assert.rejects(loadGamePackage(path.join(root, "thorium.json")), /symlink/);

    await rm(path.join(root, "game.js"));
    await mkdir(path.join(root, "game.js"));
    await assert.rejects(loadGamePackage(path.join(root, "thorium.json")), /not a regular file/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});

test("routes controls and peer messages between surfaces while keeping account identity host-only", () => {
  const device = createTestDevice({
    gameId: "dev.yougotserved.test-game",
    accountSessions: twoPlayersOneAccount,
    controls: validManifest.controls,
  });
  const controls: string[] = [];
  const peers: string[] = [];
  device.main.onControl((event) => controls.push(`${event.player}:${event.control}`));
  device.main.onPeer("score", (event) => peers.push(JSON.stringify(event.payload)));

  device.companion.emitControl({
    control: "tap",
    player: playerSlot(1),
    phase: "pressed",
    value: 1,
  });
  device.companion.sendToPeer("score", { player: 1, score: 2 });
  device.companion.flushPeerMessages();

  assert.throws(
    () => device.main.emitControl({
      control: "tap",
      player: playerSlot(1),
      phase: "pressed",
      value: 1,
    }),
    /not controlled by this surface/,
  );
  assert.throws(
    () => device.companion.emitControl({
      control: "tap",
      player: playerSlot(0),
      phase: "pressed",
      value: 1,
    }),
    /not controlled by this surface/,
  );

  assert.deepEqual(controls, ["1:tap"]);
  assert.deepEqual(peers, ['{"player":1,"score":2}']);
  assert.equal(JSON.stringify(device.main.bootstrap).includes("account-session:test-only"), false);
  assert.deepEqual(device.accountSessions[0]?.playerSlots, [playerSlot(0), playerSlot(1)]);
});

test("HostClient privately captures short-lived Colyseus tickets claimable once", () => {
  const gameSessionId = "f28f99e7-7caa-445f-9c88-aa0cafbc7fd2";
  const bootstrap: GameBootstrap = {
    protocolVersion: 1,
    surface: SurfaceRole.Main,
    game: { id: "dev.test.game", version: "1.0.0", instanceId: gameSessionId },
    players: [],
    controlledPlayerSlots: [],
    controls: [],
    render: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
    limits: { maxLocalPeerMessageBytes: 4096 },
    colyseus: {
      endpoint: "wss://games.yougotserved.dev",
      roomName: "game_session",
      ticket: "single-use",
      expiresAtEpochMs: Date.now() + 60_000,
      joinOptions: {
        gameSessionId,
        packageId: "dev.test.game",
        packageVersion: "1.0.0",
        packageDigest: "a".repeat(64),
      },
    },
  };
  const transport: HostTransport = {
    readBootstrap: async () => bootstrap,
    send: () => undefined,
    subscribe: () => () => undefined,
  };
  const unsafeBootstrap = {
    ...bootstrap,
    accountToken: "account-secret-must-not-survive",
  } as GameBootstrap;
  const host = new HostClient(unsafeBootstrap, transport);
  const visibleBootstrap = JSON.stringify(host.bootstrap);
  assert.equal("colyseus" in host.bootstrap, false);
  assert.equal(visibleBootstrap.includes("single-use"), false);
  assert.equal(visibleBootstrap.includes("account-secret-must-not-survive"), false);
  assert.equal(JSON.stringify(host).includes("single-use"), false);
  assert.equal(host.takeColyseusTicket()?.ticket, "single-use");
  assert.throws(() => host.takeColyseusTicket(), /already been claimed/);
});

test("authoritative connection maps and erases the surface ticket", async () => {
  const gameSessionId = "102d7c65-2534-4c8f-afb6-8ea550e434e2";
  const joinOptions = {
    gameSessionId,
    packageId: "dev.test.game",
    packageVersion: "1.0.0",
    packageDigest: "b".repeat(64),
  } as const;
  const bootstrap: GameBootstrap = {
    protocolVersion: 1,
    surface: SurfaceRole.Main,
    game: { id: joinOptions.packageId, version: joinOptions.packageVersion, instanceId: gameSessionId },
    players: [{ slot: playerSlot(0), displayName: "Player 1", local: true }],
    controlledPlayerSlots: [playerSlot(0)],
    controls: [],
    render: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
    limits: { maxLocalPeerMessageBytes: 4096 },
    colyseus: {
      endpoint: "wss://games.yougotserved.dev",
      roomName: "game_session",
      ticket: "surface-only",
      expiresAtEpochMs: Date.now() + 60_000,
      joinOptions,
    },
  };
  const host = new HostClient(bootstrap, {
    readBootstrap: async () => bootstrap,
    send: () => undefined,
    subscribe: () => () => undefined,
  });
  const room = { id: "room", reconnection: { minUptime: 5_000 } };
  const seen: unknown[] = [];
  const auth: { token: string | undefined } = { token: undefined };

  const connected = await connectAuthoritativeSession(host, (endpoint) => ({
    auth,
    joinOrCreate: async (roomName, options) => {
      seen.push({ endpoint, roomName, options, token: auth.token });
      return room;
    },
  }));

  assert.equal(connected, room);
  assert.equal(connected?.reconnection.minUptime, 0);
  assert.deepEqual(seen, [{
    endpoint: "wss://games.yougotserved.dev",
    roomName: "game_session",
    options: joinOptions,
    token: "surface-only",
  }]);
  assert.equal(auth.token, undefined);
  await assert.rejects(connectAuthoritativeSession(host, () => assert.fail("must not create twice")),
    /already been claimed/);
});

test("authoritative connection is offline-safe and consumes expired access without networking", async () => {
  const localDevice = createTestDevice({
    gameId: "dev.yougotserved.test-game",
    accountSessions: twoPlayersOneAccount,
    controls: validManifest.controls,
  });
  let factoryCalls = 0;
  assert.equal(
    await connectAuthoritativeSession(localDevice.main, () => {
      factoryCalls += 1;
      throw new Error("offline sessions must not construct a client");
    }),
    undefined,
  );

  const expiredBootstrap: GameBootstrap = {
    ...localDevice.companion.bootstrap,
    game: {
      id: "dev.yougotserved.test-game",
      version: "0.0.0-test",
      instanceId: "c9d4b54b-b420-478d-915e-63d02de0e651",
    },
    colyseus: {
      endpoint: "https://games.yougotserved.dev",
      roomName: "game_session",
      ticket: "expired",
      expiresAtEpochMs: Date.now() - 1,
      joinOptions: {
        gameSessionId: "c9d4b54b-b420-478d-915e-63d02de0e651",
        packageId: "dev.yougotserved.test-game",
        packageVersion: "0.0.0-test",
        packageDigest: "c".repeat(64),
      },
    },
  };
  const expiredHost = new HostClient(expiredBootstrap, {
    readBootstrap: async () => expiredBootstrap,
    send: () => undefined,
    subscribe: () => () => undefined,
  });
  await assert.rejects(
    connectAuthoritativeSession(expiredHost, () => {
      factoryCalls += 1;
      throw new Error("expired access must not construct a client");
    }),
    /expired/,
  );
  assert.equal(factoryCalls, 0);
  await assert.rejects(
    connectAuthoritativeSession(expiredHost, () => assert.fail("expired access is one-shot")),
    /already been claimed/,
  );
});

test("browser transport requests bootstrap through postMessage and matches the response", async () => {
  const device = createTestDevice({
    gameId: "dev.yougotserved.test-game",
    accountSessions: twoPlayersOneAccount,
    controls: validManifest.controls,
  });
  const sent: HostOutboundMessage[] = [];
  const fakeWindow = {
    addEventListener: () => undefined,
    thoriumHost: { postMessage: (_message: string) => undefined },
  } as unknown as Window;
  fakeWindow.thoriumHost!.postMessage = (raw) => {
    const request = JSON.parse(raw) as HostOutboundMessage;
    sent.push(request);
    if (request.kind === "bootstrap-request") {
      queueMicrotask(() =>
        fakeWindow.__thoriumReceive?.({
          kind: "bootstrap",
          requestId: request.requestId,
          bootstrap: device.main.bootstrap,
        }),
      );
    }
  };

  const transport = new BrowserHostTransport(fakeWindow, 100);
  const bootstrap = await transport.readBootstrap();

  assert.equal(bootstrap.game.id, "dev.yougotserved.test-game");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.kind, "bootstrap-request");
  assert.equal(JSON.stringify(sent).includes("single-use"), false);
});

test("manual frame driver makes the two-method surface interface deterministic in tests", async () => {
  const device = createTestDevice({
    gameId: "dev.yougotserved.test-game",
    accountSessions: twoPlayersOneAccount,
    controls: validManifest.controls,
  });
  const driver = new ManualFrameDriver();
  const seen: number[] = [];
  const starts: string[] = [];
  const running = await runGame(
    {
      main: () => ({
        start: ({ surface }) => {
          starts.push(surface);
        },
        tick: ({ deltaMs }) => seen.push(deltaMs),
      }),
      companion: () => ({ start: () => undefined, tick: () => undefined }),
    },
    {
      host: device.main,
      canvas: { width: 960, height: 540 } as HTMLCanvasElement,
      frameDriver: driver,
      autoResize: false,
      maximumDeltaMs: 20,
    },
  );
  driver.advance(100);
  driver.advance(180);
  running.stop();

  assert.deepEqual(starts, ["main"]);
  assert.deepEqual(seen, [0, 20]);
});
