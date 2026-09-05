import { describe, expect, it } from "vitest";
import type { GameRelease } from "../src/domain/game-package.js";
import type {
  GameReleasePublicationRepository,
  GameReleasePublicationRepositoryResult,
} from "../src/ports/game-release-publication-repository.js";
import type {
  PackageArtifactPublication,
  PackageArtifactPublicationStore,
} from "../src/ports/package-artifact-publication-store.js";
import { GameReleasePublisher } from "../src/publication/game-release-publisher.js";
import { createTestGamePackageFixture } from "./test-game-package-fixture.js";

class MemoryReleaseRepository implements GameReleasePublicationRepository {
  readonly releases = new Map<string, GameRelease>();

  async publish(release: GameRelease): Promise<GameReleasePublicationRepositoryResult> {
    const key = `${release.packageId}\0${release.version}`;
    const existing = this.releases.get(key);
    if (existing !== undefined) {
      return existing.contentDigest === release.contentDigest
        ? { status: "already-published", release: structuredClone(existing) }
        : { status: "conflict" };
    }
    this.releases.set(key, structuredClone(release));
    return { status: "published", release: structuredClone(release) };
  }
}

class MemoryArtifactPublicationStore implements PackageArtifactPublicationStore {
  readonly artifacts = new Map<string, PackageArtifactPublication>();

  async publish(artifact: PackageArtifactPublication) {
    const key = `${artifact.key.packageId}\0${artifact.key.version}\0${artifact.key.fileName}`;
    const existing = this.artifacts.get(key);
    if (existing !== undefined) {
      return existing.sha256 === artifact.sha256 && existing.sizeBytes === artifact.sizeBytes
        ? "already-published" as const
        : "conflict" as const;
    }
    this.artifacts.set(key, { ...artifact, bytes: Uint8Array.from(artifact.bytes) });
    return "published" as const;
  }
}

describe("GameReleasePublisher", () => {
  it("publishes a verified descriptor and ZIP as one immutable catalog release", async () => {
    const releases = new MemoryReleaseRepository();
    const artifacts = new MemoryArtifactPublicationStore();
    const publisher = new GameReleasePublisher({
      artifacts,
      releases,
      publicBaseUrl: "https://games.yougotserved.dev",
      now: () => new Date("2026-09-04T20:00:00.000Z"),
    });

    const fixture = createTestGamePackageFixture("https://games.yougotserved.dev");
    const result = await publisher.publish({
      descriptor: fixture.descriptor,
      archive: {
        fileName: fixture.artifact.key.fileName,
        bytes: fixture.artifact.bytes,
      },
    });

    expect(result.status).toBe("published");
    expect(result.release).toMatchObject({
      packageId: "dev.yougotserved.platform-fixture",
      version: "1.2.3",
      displayName: "Platform Fixture",
      publishedAt: "2026-09-04T20:00:00.000Z",
      contentDigest: fixture.release.contentDigest,
      bundle: {
        fileName: "dev.yougotserved.platform-fixture-1.2.3.zip",
        sha256: fixture.release.bundle.sha256,
        sizeBytes: fixture.release.bundle.sizeBytes,
        manifestSha256: fixture.release.bundle.manifestSha256,
      },
    });
    expect(result.release.bundle.url).toBe(
      "https://games.yougotserved.dev/v1/packages/dev.yougotserved.platform-fixture/1.2.3/dev.yougotserved.platform-fixture-1.2.3.zip",
    );
    expect(releases.releases).toHaveLength(1);
    expect(artifacts.artifacts).toHaveLength(1);
  });
});
