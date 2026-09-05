export interface PublisherCredential {
  readonly publisherId: string;
  readonly username: string;
  readonly passwordSalt: Uint8Array;
  readonly passwordHash: Uint8Array;
  readonly publishTokenDigest: Uint8Array;
}

export type CreatePublisherCredentialResult =
  | "created"
  | "username-exists"
  | "token-conflict";

export type RotatePublisherTokenResult = "rotated" | "publisher-missing" | "token-conflict";

/** Persists only salted password hashes and opaque-token digests. */
export interface PublisherCredentialRepository {
  findByUsername(username: string): Promise<PublisherCredential | undefined>;
  findByPublishTokenDigest(digest: Uint8Array): Promise<PublisherCredential | undefined>;
  create(credential: PublisherCredential): Promise<CreatePublisherCredentialResult>;
  rotatePublishToken(
    publisherId: string,
    digest: Uint8Array,
  ): Promise<RotatePublisherTokenResult>;
}

export const MAX_PUBLISHER_PACKAGE_IDS = 5;
export const MAX_PUBLISHER_RELEASE_BYTES = 1 * 1_024 * 1_024 * 1_024;
export const MAX_GLOBAL_SELF_SERVICE_RELEASE_BYTES = 10 * 1_024 * 1_024 * 1_024;

export type PublisherReleaseAuthorizationResult =
  | "authorized"
  | "package-owner-conflict"
  | "package-quota-exceeded"
  | "publisher-byte-quota-exceeded"
  | "global-byte-quota-exceeded"
  | "release-conflict";

/** Atomically owns package IDs and reserves bounded self-service release storage. */
export interface PublisherReleaseAuthorizationRepository {
  canAcceptUpload(maximumRequestBytes: number): Promise<boolean>;
  authorizeRelease(input: {
    readonly publisherId: string;
    readonly packageId: string;
    readonly version: string;
    readonly contentDigest: string;
    readonly sizeBytes: number;
  }): Promise<PublisherReleaseAuthorizationResult>;
}
