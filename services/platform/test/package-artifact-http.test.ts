import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { InMemoryPackageArtifactStore } from "../src/adapters/in-memory-package-artifact-store.js";
import { createHttpApplication } from "../src/http/routes.js";
import {
  createTestHarness,
  TEST_GAMES,
} from "./test-harness.js";
import {
  TEST_GAME_ARCHIVE_BYTES,
  TEST_GAME_ARTIFACT_KEY,
} from "./test-game-package-fixture.js";

function testGameRelease() {
  const release = TEST_GAMES[0];
  if (release === undefined) throw new Error("Test catalog release is missing");
  return release;
}

function binaryParser(
  response: request.Response,
  callback: (error: Error | null, body: any) => void,
): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: unknown) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", (error: Error) => callback(error, undefined));
}

describe("immutable package artifact delivery", () => {
  it("serves the exact catalog URL with immutable integrity headers", async () => {
    const release = testGameRelease();
    const app = createHttpApplication(createTestHarness().dependencies);
    const path = new URL(release.bundle.url).pathname;

    const response = await request(app).get(path).buffer(true).parse(binaryParser).expect(200);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body).toEqual(TEST_GAME_ARCHIVE_BYTES);
    expect(response.body.byteLength).toBe(release.bundle.sizeBytes);
    expect(createHash("sha256").update(response.body).digest("hex")).toBe(release.bundle.sha256);
    expect(response.headers).toMatchObject({
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable, no-transform",
      "content-digest": `sha-256=:${Buffer.from(release.bundle.sha256, "hex").toString("base64")}:`,
      "content-disposition": `attachment; filename="${release.bundle.fileName}"`,
      "content-length": String(release.bundle.sizeBytes),
      "content-type": "application/zip",
      etag: `"${release.bundle.sha256}"`,
      "x-content-type-options": "nosniff",
    });
  });

  it("supports HEAD, ETag revalidation, and one byte range", async () => {
    const release = testGameRelease();
    const app = createHttpApplication(createTestHarness().dependencies);
    const path = new URL(release.bundle.url).pathname;
    const etag = `"${release.bundle.sha256}"`;

    const head = await request(app).head(path).expect(200);
    expect(head.headers["content-length"]).toBe(String(release.bundle.sizeBytes));
    expect(head.headers.etag).toBe(etag);
    expect(head.body).toEqual({});

    const notModified = await request(app)
      .get(path)
      .set("if-none-match", `W/${etag}`)
      .expect(304);
    expect(notModified.headers.etag).toBe(etag);
    expect(notModified.text).toBe("");

    const range = await request(app)
      .get(path)
      .set("range", "bytes=4-19")
      .buffer(true)
      .parse(binaryParser)
      .expect(206);
    expect(range.headers["content-range"]).toBe(`bytes 4-19/${release.bundle.sizeBytes}`);
    expect(range.headers["content-length"]).toBe("16");
    expect(range.body).toEqual(TEST_GAME_ARCHIVE_BYTES.subarray(4, 20));
  });

  it("returns 404 for unpublished paths and absent stored artifacts", async () => {
    const release = testGameRelease();
    const harness = createTestHarness();
    const path = new URL(release.bundle.url).pathname;

    await request(createHttpApplication(harness.dependencies))
      .get(path.replace(release.bundle.fileName, "missing.zip"))
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe("package_artifact_not_found"));

    const appWithoutArtifact = createHttpApplication({
      ...harness.dependencies,
      packageArtifacts: new InMemoryPackageArtifactStore([]),
    });
    await request(appWithoutArtifact)
      .get(path)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe("package_artifact_not_found"));
  });

  it("refuses bytes that drift from immutable catalog metadata", async () => {
    const release = testGameRelease();
    const corrupted = Uint8Array.from(TEST_GAME_ARCHIVE_BYTES);
    corrupted[100] = (corrupted[100] ?? 0) ^ 0xff;
    const harness = createTestHarness(undefined, {
      artifacts: [{ key: TEST_GAME_ARTIFACT_KEY, bytes: corrupted }],
    });

    await request(createHttpApplication(harness.dependencies))
      .get(new URL(release.bundle.url).pathname)
      .expect(500)
      .expect(({ body }) => expect(body.error.code).toBe("package_artifact_integrity_error"));
  });
});
