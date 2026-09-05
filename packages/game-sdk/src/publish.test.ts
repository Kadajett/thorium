import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { canonicalJson, sha256 } from "./descriptor.js";
import { loadGamePackage, packGamePackage } from "./pack.js";
import { publishGame } from "./publish.js";

const TOKEN = `thp_${"A".repeat(43)}`;
const PLATFORM_URL = "https://platform.example";
const temporaryDirectories: string[] = [];

const validManifest = {
  schema: 1,
  packageId: "dev.yougotserved.publish-test",
  version: "1.2.3",
  displayName: "Publish Test",
  summary: "A tiny publisher test package.",
  description: "Exercises the public publisher client with real package files.",
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
  players: {
    minSlots: 1,
    maxSlots: 2,
    maxLocalSlots: 2,
    sameAccountMultipleSlots: true,
  },
  multiplayer: {
    online: false,
    roomName: "game_session",
    protocol: "thorium-game-channel-v1",
  },
  controls: [{ id: "confirm", label: "Confirm", kind: "button" }],
  capabilities: ["same-device-peer"],
  budgets: {
    maxPackageBytes: 1_048_576,
    maxFileCount: 8,
    maxLocalPeerMessageBytes: 4_096,
  },
} as const;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function createFixture(options: {
  readonly requiresOnline?: boolean;
  readonly packageId?: string;
} = {}): Promise<{ readonly root: string; readonly manifestPath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "thorium-publish-test-"));
  temporaryDirectories.push(root);
  await Promise.all([
    mkdir(path.join(root, "main"), { recursive: true }),
    mkdir(path.join(root, "companion"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, "main/index.html"), "<!doctype html><main>Main</main>\n"),
    writeFile(
      path.join(root, "companion/index.html"),
      "<!doctype html><button>Confirm</button>\n",
    ),
    writeFile(path.join(root, "game.js"), "globalThis.publishTest = true;\n"),
  ]);
  const requiresOnline = options.requiresOnline === true;
  const manifest = {
    ...validManifest,
    ...(options.packageId === undefined ? {} : { packageId: options.packageId }),
    multiplayer: requiresOnline
      ? { ...validManifest.multiplayer, online: true, requiresOnline: true }
      : validManifest.multiplayer,
    capabilities: requiresOnline
      ? ["same-device-peer", "colyseus-session"]
      : validManifest.capabilities,
  };
  const manifestPath = path.join(root, "thorium.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, manifestPath };
}

function publicationResponse(
  status: 200 | 201,
  receipt: {
    readonly status: "published" | "already-published";
    readonly release: {
      readonly packageId: string;
      readonly version: string;
      readonly contentDigest: string;
    };
  },
): Response {
  return Response.json(receipt, { status });
}

test("publishes the exact locally validated package as bounded multipart and safely retries", async () => {
  const fixture = await createFixture();
  const expectedPackage = packGamePackage(await loadGamePackage(fixture.manifestPath));
  const expectedDescriptor = canonicalJson(expectedPackage.descriptor);
  const expectedDigest = sha256(expectedDescriptor);
  const archiveDigests: string[] = [];
  let requests = 0;

  const injectedFetch: typeof globalThis.fetch = async (input, init) => {
    requests += 1;
    assert.equal(new URL(input instanceof Request ? input.url : input).toString(),
      `${PLATFORM_URL}/v1/publisher/releases`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal, "a publication timeout signal is required");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
    assert.ok(init?.body instanceof FormData);

    const request = new Request(input, init);
    const form = await request.formData();
    assert.deepEqual([...form.keys()].sort(), ["archive", "descriptor"]);
    const descriptor = form.get("descriptor");
    const archive = form.get("archive");
    assert.equal(typeof descriptor, "string");
    assert.notEqual(typeof archive, "string");
    if (typeof descriptor !== "string" || archive === null || typeof archive === "string") {
      return assert.fail("multipart fields were not encoded as descriptor text and an archive file");
    }
    assert.equal(descriptor, expectedDescriptor);
    assert.equal(archive.name, expectedPackage.descriptor.bundle.fileName);
    assert.equal(archive.type, "application/zip");
    assert.equal(archive.size, expectedPackage.descriptor.bundle.sizeBytes);
    const archiveBytes = new Uint8Array(await archive.arrayBuffer());
    const archiveDigest = sha256(archiveBytes);
    archiveDigests.push(archiveDigest);
    assert.equal(archiveDigest, expectedPackage.descriptor.bundle.sha256);

    const status = requests === 1 ? 201 : 200;
    return publicationResponse(status, {
      status: status === 201 ? "published" : "already-published",
      release: {
        packageId: validManifest.packageId,
        version: validManifest.version,
        contentDigest: expectedDigest,
      },
    });
  };

  const first = await publishGame(fixture.manifestPath, {
    platformUrl: `${PLATFORM_URL}/`,
    token: TOKEN,
    fetch: injectedFetch,
  });
  const retry = await publishGame(fixture.manifestPath, {
    platformUrl: PLATFORM_URL,
    token: TOKEN,
    fetch: injectedFetch,
  });

  assert.deepEqual(first, {
    status: "published",
    release: {
      packageId: validManifest.packageId,
      version: validManifest.version,
      contentDigest: expectedDigest,
    },
  });
  assert.deepEqual(retry, { ...first, status: "already-published" });
  assert.deepEqual(archiveDigests, [
    expectedPackage.descriptor.bundle.sha256,
    expectedPackage.descriptor.bundle.sha256,
  ]);
});

test("rejects malformed and package-mismatched success receipts", async () => {
  const fixture = await createFixture();
  const packed = packGamePackage(await loadGamePackage(fixture.manifestPath));
  const digest = sha256(canonicalJson(packed.descriptor));
  const invalidResponses = [
    () => new Response("not json", { status: 201 }),
    () => publicationResponse(201, {
      status: "already-published",
      release: { packageId: validManifest.packageId, version: validManifest.version, contentDigest: digest },
    }),
    () => publicationResponse(201, {
      status: "published",
      release: { packageId: "dev.example.other", version: validManifest.version, contentDigest: digest },
    }),
    () => publicationResponse(201, {
      status: "published",
      release: { packageId: validManifest.packageId, version: "9.9.9", contentDigest: digest },
    }),
    () => publicationResponse(201, {
      status: "published",
      release: {
        packageId: validManifest.packageId,
        version: validManifest.version,
        contentDigest: "f".repeat(64),
      },
    }),
  ];

  for (const response of invalidResponses) {
    await assert.rejects(
      publishGame(fixture.manifestPath, {
        platformUrl: PLATFORM_URL,
        token: TOKEN,
        fetch: async () => response(),
      }),
      /invalid publication receipt/i,
    );
  }
});

test("caps success responses before decoding them", async () => {
  const fixture = await createFixture();
  const echoedBody = `untrusted-response-${TOKEN}-${"x".repeat(17_000)}`;
  await assert.rejects(
    publishGame(fixture.manifestPath, {
      platformUrl: PLATFORM_URL,
      token: TOKEN,
      fetch: async () => new Response(echoedBody, { status: 201 }),
    }),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /invalid publication receipt/i);
      assert.equal(message.includes(TOKEN), false);
      assert.equal(message.includes(echoedBody), false);
      return true;
    },
  );
});

test("sanitizes authorization and rate-limit failures without reading echoed bodies", async () => {
  const fixture = await createFixture();
  for (const status of [401, 429]) {
    const echoedBody = `untrusted-${status}-${TOKEN}-descriptor-and-archive-echo`;
    await assert.rejects(
      publishGame(fixture.manifestPath, {
        platformUrl: PLATFORM_URL,
        token: TOKEN,
        fetch: async () => new Response(echoedBody, {
          status,
          ...(status === 429 ? { headers: { "Retry-After": "60" } } : {}),
        }),
      }),
      (error: unknown) => {
        const message = String(error);
        assert.match(message, new RegExp(`HTTP ${status}`));
        assert.equal(message.includes(TOKEN), false);
        assert.equal(message.includes(echoedBody), false);
        assert.equal(message.includes("descriptor-and-archive-echo"), false);
        return true;
      },
    );
  }

  const transportEcho = `transport-${TOKEN}-descriptor-and-archive-echo`;
  await assert.rejects(
    publishGame(fixture.manifestPath, {
      platformUrl: PLATFORM_URL,
      token: TOKEN,
      fetch: async () => {
        throw new Error(transportEcho);
      },
    }),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /could not confirm a response/i);
      assert.equal(message.includes(TOKEN), false);
      assert.equal(message.includes(transportEcho), false);
      assert.equal(message.includes("descriptor-and-archive-echo"), false);
      return true;
    },
  );
});

test("rejects unsafe origins, invalid tokens, online authority, and invalid packages before networking", async () => {
  const fixture = await createFixture();
  let networkCalls = 0;
  const mustNotFetch: typeof globalThis.fetch = async () => {
    networkCalls += 1;
    return assert.fail("invalid local input must not reach the network");
  };

  for (const platformUrl of [
    "http://platform.example",
    "https://user:password@platform.example",
    "https://platform.example/api",
    "https://platform.example?query=yes",
    "https://platform.example#fragment",
  ]) {
    await assert.rejects(
      publishGame(fixture.manifestPath, { platformUrl, token: TOKEN, fetch: mustNotFetch }),
      /HTTPS origin/i,
    );
  }
  for (const token of [
    "",
    "account-session-token",
    "thp_short",
    `thp_${"A".repeat(42)}`,
    `thp_${"A".repeat(44)}`,
    `thp_${"A".repeat(42)}!`,
  ]) {
    await assert.rejects(
      publishGame(fixture.manifestPath, { platformUrl: PLATFORM_URL, token, fetch: mustNotFetch }),
      /THORIUM_PUBLISH_TOKEN/,
    );
  }

  const online = await createFixture({ requiresOnline: true });
  await assert.rejects(
    publishGame(online.manifestPath, {
      platformUrl: PLATFORM_URL,
      token: TOKEN,
      fetch: mustNotFetch,
    }),
    /operator-deployed server module/i,
  );

  const invalid = await createFixture({ packageId: "Not-Lowercase" });
  await assert.rejects(
    publishGame(invalid.manifestPath, {
      platformUrl: PLATFORM_URL,
      token: TOKEN,
      fetch: mustNotFetch,
    }),
    /Invalid Thorium game manifest/,
  );

  await unlink(path.join(fixture.root, "game.js"));
  await assert.rejects(
    publishGame(fixture.manifestPath, {
      platformUrl: PLATFORM_URL,
      token: TOKEN,
      fetch: mustNotFetch,
    }),
    /ENOENT|no such file/i,
  );
  assert.equal(networkCalls, 0);
});

test("CLI publish dispatch fails safely before networking when its token is absent", async () => {
  const fixture = await createFixture();
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const environment = { ...process.env };
  delete environment.THORIUM_PUBLISH_TOKEN;
  const result = await new Promise<{
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }>((resolve) => {
    execFile(
      process.execPath,
      [cli, "publish", fixture.manifestPath, "--platform", PLATFORM_URL],
      { env: environment },
      (error, stdout, stderr) => resolve({
        code: typeof error === "object" && error !== null && "code" in error
          && typeof error.code === "number" ? error.code : 0,
        stdout,
        stderr,
      }),
    );
  });

  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Set THORIUM_PUBLISH_TOKEN/);
  assert.equal(result.stderr.includes("Authorization"), false);
  assert.equal(result.stderr.includes("Bearer"), false);
});
