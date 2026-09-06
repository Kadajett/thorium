import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";
import { publishGame } from "./publish.js";
import {
  cleanupPublishFixtures,
  createFixture,
  PLATFORM_URL,
  TOKEN,
  type PublishFixture,
} from "./quality-publish-package-fixture.js";
import {
  expectedPublication,
  invalidReceipts,
  publicationMock,
  receipt,
  safeError,
} from "./quality-publish-http-fixture.js";
import { runWithoutToken } from "./quality-publish-cli-fixture.js";

afterEach(cleanupPublishFixtures);

await test("publishes the exact locally validated package as bounded multipart and safely retries", async () => {
  const fixture = await createFixture(),
    expected = await expectedPublication(fixture.manifestPath);
  const mocked = publicationMock(expected);
  const first = await publishGame(fixture.manifestPath, {
    platformUrl: `${PLATFORM_URL}/`,
    token: TOKEN,
    fetch: mocked.fetch,
  });
  const retry = await publishGame(fixture.manifestPath, {
    platformUrl: PLATFORM_URL,
    token: TOKEN,
    fetch: mocked.fetch,
  });
  assert.deepEqual(first, receipt(expected.digest));
  assert.deepEqual(retry, { ...first, status: "already-published" });
  assert.deepEqual(mocked.archiveDigests, [
    expected.packed.descriptor.bundle.sha256,
    expected.packed.descriptor.bundle.sha256,
  ]);
});

await test("rejects malformed and package-mismatched success receipts", async () => {
  const fixture = await createFixture(),
    expected = await expectedPublication(fixture.manifestPath);
  for (const response of invalidReceipts(expected.digest)) {
    await assert.rejects(
      publishGame(fixture.manifestPath, {
        platformUrl: PLATFORM_URL,
        token: TOKEN,
        fetch: () => Promise.resolve(response()),
      }),
      /invalid publication receipt/i,
    );
  }
});

await test("caps success responses before decoding them", async () => {
  const fixture = await createFixture();
  const echo = `untrusted-response-${TOKEN}-${"x".repeat(17_000)}`;
  await assert.rejects(
    publishGame(fixture.manifestPath, {
      platformUrl: PLATFORM_URL,
      token: TOKEN,
      fetch: () => Promise.resolve(new Response(echo, { status: 201 })),
    }),
    (error: unknown) => safeError(error, /invalid publication receipt/i, echo),
  );
});

async function rejectHttpFailure(manifestPath: string, status: number): Promise<void> {
  const echo = `untrusted-${String(status)}-${TOKEN}-descriptor-and-archive-echo`;
  await assert.rejects(
    publishGame(manifestPath, {
      platformUrl: PLATFORM_URL,
      token: TOKEN,
      fetch: () =>
        Promise.resolve(
          new Response(echo, {
            status,
            ...(status === 429 ? { headers: { "Retry-After": "60" } } : {}),
          }),
        ),
    }),
    (error: unknown) => safeError(error, new RegExp(`HTTP ${String(status)}`), echo),
  );
}
await test("sanitizes authorization and rate-limit failures without reading echoed bodies", async () => {
  const fixture = await createFixture();
  for (const status of [401, 429]) await rejectHttpFailure(fixture.manifestPath, status);
  const echo = `transport-${TOKEN}-descriptor-and-archive-echo`;
  await assert.rejects(
    publishGame(fixture.manifestPath, {
      platformUrl: PLATFORM_URL,
      token: TOKEN,
      fetch: () => Promise.reject(new Error(echo)),
    }),
    (error: unknown) => safeError(error, /could not confirm a response/i, echo),
  );
});

async function rejectOrigins(manifestPath: string, fetch: typeof globalThis.fetch): Promise<void> {
  for (const platformUrl of [
    "http://platform.example",
    "https://user:password@platform.example",
    "https://platform.example/api",
    "https://platform.example?query=yes",
    "https://platform.example#fragment",
  ]) {
    await assert.rejects(
      publishGame(manifestPath, { platformUrl, token: TOKEN, fetch }),
      /HTTPS origin/i,
    );
  }
}
async function rejectTokens(manifestPath: string, fetch: typeof globalThis.fetch): Promise<void> {
  for (const token of [
    "",
    "account-session-token",
    "thp_short",
    `thp_${"A".repeat(42)}`,
    `thp_${"A".repeat(44)}`,
    `thp_${"A".repeat(42)}!`,
  ]) {
    await assert.rejects(
      publishGame(manifestPath, { platformUrl: PLATFORM_URL, token, fetch }),
      /THORIUM_PUBLISH_TOKEN/,
    );
  }
}
async function rejectPackages(
  fixture: PublishFixture,
  fetch: typeof globalThis.fetch,
): Promise<void> {
  const options = { platformUrl: PLATFORM_URL, token: TOKEN, fetch };
  const online = await createFixture({ requiresOnline: true });
  await assert.rejects(
    publishGame(online.manifestPath, options),
    /operator-deployed server module/i,
  );
  const invalid = await createFixture({ packageId: "Not-Lowercase" });
  await assert.rejects(publishGame(invalid.manifestPath, options), /Invalid Thorium game manifest/);
  await unlink(path.join(fixture.root, "game.js"));
  await assert.rejects(publishGame(fixture.manifestPath, options), /ENOENT|no such file/i);
}
await test("rejects unsafe origins, invalid tokens, online authority, and invalid packages before networking", async () => {
  const fixture = await createFixture();
  let networkCalls = 0;
  const mustNotFetch: typeof globalThis.fetch = () => {
    networkCalls += 1;
    return assert.fail("invalid local input must not reach the network");
  };
  await rejectOrigins(fixture.manifestPath, mustNotFetch);
  await rejectTokens(fixture.manifestPath, mustNotFetch);
  await rejectPackages(fixture, mustNotFetch);
  assert.equal(networkCalls, 0);
});

await test("CLI publish dispatch fails safely before networking when its token is absent", async () => {
  const fixture = await createFixture();
  const result = await runWithoutToken(fixture.manifestPath);
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Set THORIUM_PUBLISH_TOKEN/);
  assert.equal(result.stderr.includes("Authorization"), false);
  assert.equal(result.stderr.includes("Bearer"), false);
});
