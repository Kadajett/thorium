import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSystemPackageArtifactStore } from "../src/adapters/filesystem-package-artifact-store.js";
import { TAP_RACE_ARTIFACT_KEY } from "../src/catalog/sample-games.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    await rm(directory, { recursive: true, force: true });
  }));
});

describe("FileSystemPackageArtifactStore", () => {
  it("verifies an immutable artifact once and reuses the cached snapshot", async () => {
    const root = await temporaryDirectory("thorium-artifacts-");
    const artifactDirectory = join(root, TAP_RACE_ARTIFACT_KEY.packageId, TAP_RACE_ARTIFACT_KEY.version);
    const artifactPath = join(artifactDirectory, TAP_RACE_ARTIFACT_KEY.fileName);
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, "first immutable bytes");
    const store = new FileSystemPackageArtifactStore(root);

    const first = await store.read(TAP_RACE_ARTIFACT_KEY);
    await writeFile(artifactPath, "changed bytes that must not replace the published snapshot");
    const second = await store.read(TAP_RACE_ARTIFACT_KEY);

    expect(second).toBe(first);
    expect(first).toMatchObject({
      sizeBytes: 21,
      sha256: createHash("sha256").update("first immutable bytes").digest("hex"),
    });
  });

  it("rejects a symlink that resolves outside the configured artifact root", async () => {
    const root = await temporaryDirectory("thorium-artifacts-");
    const outside = await temporaryDirectory("thorium-outside-");
    const artifactDirectory = join(root, TAP_RACE_ARTIFACT_KEY.packageId, TAP_RACE_ARTIFACT_KEY.version);
    const outsidePath = join(outside, "outside.zip");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(outsidePath, "not inside the package store");
    await symlink(outsidePath, join(artifactDirectory, TAP_RACE_ARTIFACT_KEY.fileName));
    const store = new FileSystemPackageArtifactStore(root);

    await expect(store.read(TAP_RACE_ARTIFACT_KEY)).rejects.toThrow("package_artifact_outside_root");
  });
});
