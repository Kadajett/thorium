import { timingSafeEqual } from "node:crypto";
import {
  MAX_GLOBAL_SELF_SERVICE_RELEASE_BYTES,
  MAX_PUBLISHER_PACKAGE_IDS,
  MAX_PUBLISHER_RELEASE_BYTES,
  type CreatePublisherCredentialResult,
  type PublisherCredential,
  type PublisherCredentialRepository,
  type PublisherReleaseAuthorizationRepository,
  type PublisherReleaseAuthorizationResult,
  type RotatePublisherTokenResult,
} from "../ports/publisher-repository.js";

function copyCredential(credential: PublisherCredential): PublisherCredential {
  return {
    ...credential,
    passwordSalt: Uint8Array.from(credential.passwordSalt),
    passwordHash: Uint8Array.from(credential.passwordHash),
    publishTokenDigest: Uint8Array.from(credential.publishTokenDigest),
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

/** Replaceable process-local adapter for tests and non-production development. */
export class InMemoryPublisherRepository
implements PublisherCredentialRepository, PublisherReleaseAuthorizationRepository {
  readonly #byUsername = new Map<string, PublisherCredential>();
  readonly #owners = new Map<string, string | null>();
  readonly #releases = new Map<string, {
    readonly publisherId: string;
    readonly contentDigest: string;
    readonly sizeBytes: number;
  }>();

  constructor(reservedPackageIds: readonly string[] = []) {
    for (const packageId of reservedPackageIds) this.#owners.set(packageId, null);
  }

  async findByUsername(username: string): Promise<PublisherCredential | undefined> {
    const credential = this.#byUsername.get(username);
    return credential === undefined ? undefined : copyCredential(credential);
  }

  async findByPublishTokenDigest(digest: Uint8Array): Promise<PublisherCredential | undefined> {
    const credential = [...this.#byUsername.values()].find((candidate) =>
      equalBytes(candidate.publishTokenDigest, digest));
    return credential === undefined ? undefined : copyCredential(credential);
  }

  async create(credential: PublisherCredential): Promise<CreatePublisherCredentialResult> {
    if (this.#byUsername.has(credential.username)) return "username-exists";
    if ([...this.#byUsername.values()].some((candidate) =>
      equalBytes(candidate.publishTokenDigest, credential.publishTokenDigest))) {
      return "token-conflict";
    }
    this.#byUsername.set(credential.username, copyCredential(credential));
    return "created";
  }

  async rotatePublishToken(
    publisherId: string,
    digest: Uint8Array,
  ): Promise<RotatePublisherTokenResult> {
    if ([...this.#byUsername.values()].some((candidate) =>
      candidate.publisherId !== publisherId
      && equalBytes(candidate.publishTokenDigest, digest))) return "token-conflict";
    const entry = [...this.#byUsername.entries()].find(([, candidate]) =>
      candidate.publisherId === publisherId);
    if (entry === undefined) return "publisher-missing";
    const [username, credential] = entry;
    this.#byUsername.set(username, copyCredential({
      ...credential,
      publishTokenDigest: digest,
    }));
    return "rotated";
  }

  async canAcceptUpload(maximumRequestBytes: number): Promise<boolean> {
    const used = [...this.#releases.values()]
      .reduce((total, release) => total + release.sizeBytes, 0);
    return used + maximumRequestBytes <= MAX_GLOBAL_SELF_SERVICE_RELEASE_BYTES;
  }

  async authorizeRelease(input: {
    readonly publisherId: string;
    readonly packageId: string;
    readonly version: string;
    readonly contentDigest: string;
    readonly sizeBytes: number;
  }): Promise<PublisherReleaseAuthorizationResult> {
    const owner = this.#owners.get(input.packageId);
    if (owner !== undefined && owner !== input.publisherId) return "package-owner-conflict";
    if (owner === undefined) {
      const ownedCount = [...this.#owners.values()].filter((value) =>
        value === input.publisherId).length;
      if (ownedCount >= MAX_PUBLISHER_PACKAGE_IDS) return "package-quota-exceeded";
    }

    const releaseKey = `${input.packageId}\0${input.version}`;
    const existing = this.#releases.get(releaseKey);
    if (existing !== undefined) {
      return existing.publisherId === input.publisherId
        && existing.contentDigest === input.contentDigest
        && existing.sizeBytes === input.sizeBytes
        ? "authorized"
        : "release-conflict";
    }
    const globalBytes = [...this.#releases.values()]
      .reduce((total, release) => total + release.sizeBytes, 0);
    if (globalBytes + input.sizeBytes > MAX_GLOBAL_SELF_SERVICE_RELEASE_BYTES) {
      return "global-byte-quota-exceeded";
    }
    const publisherBytes = [...this.#releases.values()]
      .filter((release) => release.publisherId === input.publisherId)
      .reduce((total, release) => total + release.sizeBytes, 0);
    if (publisherBytes + input.sizeBytes > MAX_PUBLISHER_RELEASE_BYTES) {
      return "publisher-byte-quota-exceeded";
    }
    if (owner === undefined) this.#owners.set(input.packageId, input.publisherId);
    this.#releases.set(releaseKey, {
      publisherId: input.publisherId,
      contentDigest: input.contentDigest,
      sizeBytes: input.sizeBytes,
    });
    return "authorized";
  }

  containsRawCredential(value: string): boolean {
    return [...this.#byUsername.values()].some((credential) =>
      Buffer.from(credential.passwordSalt).includes(value)
      || Buffer.from(credential.passwordHash).includes(value)
      || Buffer.from(credential.publishTokenDigest).includes(value));
  }

  hasPackageOwners(): boolean {
    return this.#owners.size > 0;
  }
}
