import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemPackageArtifactPublicationStore } from
  "../src/adapters/filesystem-package-artifact-publication-store.js";
import { FileSystemPackageArtifactStore } from
  "../src/adapters/filesystem-package-artifact-store.js";
import {
  createTestGamePackageFixture,
  TEST_GAME_ARTIFACT_KEY,
} from "./test-game-package-fixture.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("FileSystemPackageArtifactPublicationStore", () => {
  it("atomically publishes immutable bytes for the read-only artifact adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "thorium-publication-"));
    temporaryDirectories.push(root);
    const fixture = createTestGamePackageFixture("https://games.yougotserved.dev");
    const writer = new FileSystemPackageArtifactPublicationStore(root);
    const publication = {
      key: fixture.artifact.key,
      bytes: fixture.artifact.bytes,
      sha256: fixture.release.bundle.sha256,
      sizeBytes: fixture.release.bundle.sizeBytes,
    };

    await expect(writer.publish(publication)).resolves.toBe("published");
    await expect(writer.publish(publication)).resolves.toBe("already-published");
    const conflictingBytes = Buffer.from("different immutable bytes");
    await expect(writer.publish({
      ...publication,
      bytes: conflictingBytes,
      sha256: createHash("sha256").update(conflictingBytes).digest("hex"),
      sizeBytes: conflictingBytes.byteLength,
    })).resolves.toBe("conflict");

    const stored = await new FileSystemPackageArtifactStore(root).read(TEST_GAME_ARTIFACT_KEY);
    expect(stored).toEqual({
      bytes: fixture.artifact.bytes,
      sha256: fixture.release.bundle.sha256,
      sizeBytes: fixture.release.bundle.sizeBytes,
    });
  });
});
