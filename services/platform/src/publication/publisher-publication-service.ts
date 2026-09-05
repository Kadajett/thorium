import type {
  PublisherReleaseAuthorizationRepository,
} from "../ports/publisher-repository.js";
import {
  GameReleasePublicationError,
  GameReleasePublisher,
} from "./game-release-publisher.js";

export class PublisherPackageOwnershipError extends Error {
  constructor() {
    super("package_id_not_owned");
  }
}

export class PublisherQuotaError extends Error {
  constructor(readonly code: "package_quota_exceeded" | "publisher_byte_quota_exceeded" | "global_byte_quota_exceeded") {
    super(code);
  }
}

export class PublisherServerModuleRequiredError extends Error {
  constructor() {
    super("server_module_required");
  }
}

/** Applies publisher namespace ownership before immutable artifact writes. */
export class PublisherPublicationService {
  readonly #authorization: PublisherReleaseAuthorizationRepository;
  readonly #publisher: GameReleasePublisher;

  constructor(dependencies: {
    readonly authorization: PublisherReleaseAuthorizationRepository;
    readonly publisher: GameReleasePublisher;
  }) {
    this.#authorization = dependencies.authorization;
    this.#publisher = dependencies.publisher;
  }

  canAcceptUpload(maximumRequestBytes: number): Promise<boolean> {
    return this.#authorization.canAcceptUpload(maximumRequestBytes);
  }

  publish(
    publisherId: string,
    input: {
      readonly descriptor: unknown;
      readonly archive: { readonly fileName: string; readonly bytes: Uint8Array };
    },
  ) {
    return this.#publisher.publish(input, {
      authorize: async (release) => {
        if (release.multiplayer.requiresOnline) {
          // Public packages are untrusted browser content. Game-specific host
          // modules remain a separate, operator-signed deployment lane.
          throw new PublisherServerModuleRequiredError();
        }
        const authorization = await this.#authorization.authorizeRelease({
          publisherId,
          packageId: release.packageId,
          version: release.version,
          contentDigest: release.contentDigest,
          sizeBytes: release.bundle.sizeBytes,
        });
        if (authorization === "package-owner-conflict") {
          throw new PublisherPackageOwnershipError();
        }
        if (authorization === "release-conflict") {
          throw new GameReleasePublicationError("release_conflict");
        }
        if (authorization === "package-quota-exceeded") {
          throw new PublisherQuotaError("package_quota_exceeded");
        }
        if (authorization === "publisher-byte-quota-exceeded") {
          throw new PublisherQuotaError("publisher_byte_quota_exceeded");
        }
        if (authorization === "global-byte-quota-exceeded") {
          throw new PublisherQuotaError("global_byte_quota_exceeded");
        }
      },
    });
  }
}
