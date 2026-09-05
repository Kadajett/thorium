import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createTestGamePackageFixture,
  TEST_GAME_ARCHIVE_BYTES,
  TEST_GAME_ARTIFACT_KEY,
} from "./test-game-package-fixture.js";

describe("self-contained platform game package fixture", () => {
  it("generates deterministic bytes and matching immutable release metadata", () => {
    const first = createTestGamePackageFixture("https://first.platform.test");
    const second = createTestGamePackageFixture("https://second.platform.test/");
    const archiveSha256 = createHash("sha256").update(TEST_GAME_ARCHIVE_BYTES).digest("hex");

    expect(first.artifact).toEqual(second.artifact);
    expect(first.artifact.key).toEqual(TEST_GAME_ARTIFACT_KEY);
    expect(TEST_GAME_ARCHIVE_BYTES.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(first.release.bundle).toMatchObject({
      fileName: TEST_GAME_ARTIFACT_KEY.fileName,
      sha256: archiveSha256,
      sizeBytes: TEST_GAME_ARCHIVE_BYTES.byteLength,
    });
    expect(new URL(first.release.bundle.url).origin).toBe("https://first.platform.test");
    expect(new URL(second.release.bundle.url).origin).toBe("https://second.platform.test");
    expect(new URL(first.release.bundle.url).pathname).toBe(
      `/v1/packages/${TEST_GAME_ARTIFACT_KEY.packageId}/${TEST_GAME_ARTIFACT_KEY.version}/${TEST_GAME_ARTIFACT_KEY.fileName}`,
    );
    expect(first.release.contentDigest).toBe(second.release.contentDigest);
  });
});
