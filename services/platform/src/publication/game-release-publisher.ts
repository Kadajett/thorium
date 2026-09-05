import type {
  GameReleasePublicationRepository,
} from "../ports/game-release-publication-repository.js";
import type {
  PackageArtifactPublicationStore,
} from "../ports/package-artifact-publication-store.js";
import { verifyPublishedGameRelease } from "./verify-game-release.js";

export interface GameReleasePublisherDependencies {
  readonly artifacts: PackageArtifactPublicationStore;
  readonly releases: GameReleasePublicationRepository;
  readonly publicBaseUrl: string;
  readonly now?: () => Date;
}

export class GameReleasePublicationError extends Error {
  constructor(readonly code: "invalid_release" | "artifact_conflict" | "release_conflict") {
    super(code);
  }
}

/** Verifies and publishes one immutable descriptor/archive pair. */
export class GameReleasePublisher {
  readonly #dependencies: GameReleasePublisherDependencies;

  constructor(dependencies: GameReleasePublisherDependencies) {
    this.#dependencies = dependencies;
  }

  async publish(input: {
    readonly descriptor: unknown;
    readonly archive: { readonly fileName: string; readonly bytes: Uint8Array };
  }) {
    let verified;
    try {
      verified = verifyPublishedGameRelease({
        ...input,
        publicBaseUrl: this.#dependencies.publicBaseUrl,
        publishedAt: (this.#dependencies.now?.() ?? new Date()).toISOString(),
      });
    } catch {
      throw new GameReleasePublicationError("invalid_release");
    }

    const artifactResult = await this.#dependencies.artifacts.publish({
      key: {
        packageId: verified.release.packageId,
        version: verified.release.version,
        fileName: verified.release.bundle.fileName,
      },
      bytes: input.archive.bytes,
      sha256: verified.release.bundle.sha256,
      sizeBytes: verified.release.bundle.sizeBytes,
    });
    if (artifactResult === "conflict") {
      throw new GameReleasePublicationError("artifact_conflict");
    }

    const releaseResult = await this.#dependencies.releases.publish(verified.release);
    if (releaseResult.status === "conflict") {
      throw new GameReleasePublicationError("release_conflict");
    }
    return releaseResult;
  }
}
