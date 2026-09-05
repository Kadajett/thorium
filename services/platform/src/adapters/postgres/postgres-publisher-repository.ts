import type { Pool } from "pg";
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
} from "../../ports/publisher-repository.js";

interface PublisherRow {
  readonly publisher_id: string;
  readonly username: string;
  readonly password_salt: Buffer;
  readonly password_hash: Buffer;
  readonly publish_token_digest: Buffer;
}

function credentialFromRow(row: PublisherRow): PublisherCredential {
  return {
    publisherId: row.publisher_id,
    username: row.username,
    passwordSalt: Uint8Array.from(row.password_salt),
    passwordHash: Uint8Array.from(row.password_hash),
    publishTokenDigest: Uint8Array.from(row.publish_token_digest),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "23505";
}

/** PostgreSQL credential and namespace ownership adapter for public publishing. */
export class PostgresPublisherRepository
implements PublisherCredentialRepository, PublisherReleaseAuthorizationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async findByUsername(username: string): Promise<PublisherCredential | undefined> {
    const result = await this.#pool.query<PublisherRow>(
      `SELECT publisher_id, username, password_salt, password_hash, publish_token_digest
         FROM thorium_publishers
        WHERE username = $1`,
      [username],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : credentialFromRow(row);
  }

  async findByPublishTokenDigest(
    digest: Uint8Array,
  ): Promise<PublisherCredential | undefined> {
    const result = await this.#pool.query<PublisherRow>(
      `SELECT publisher_id, username, password_salt, password_hash, publish_token_digest
         FROM thorium_publishers
        WHERE publish_token_digest = $1`,
      [Buffer.from(digest)],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : credentialFromRow(row);
  }

  async create(credential: PublisherCredential): Promise<CreatePublisherCredentialResult> {
    const result = await this.#pool.query<{ readonly publisher_id: string }>(
      `INSERT INTO thorium_publishers (
         publisher_id,
         username,
         password_scheme,
         password_salt,
         password_hash,
         publish_token_digest
       ) VALUES ($1, $2, 'scrypt-v1', $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING publisher_id`,
      [
        credential.publisherId,
        credential.username,
        Buffer.from(credential.passwordSalt),
        Buffer.from(credential.passwordHash),
        Buffer.from(credential.publishTokenDigest),
      ],
    );
    if (result.rows[0] !== undefined) return "created";
    const existing = await this.findByUsername(credential.username);
    return existing === undefined ? "token-conflict" : "username-exists";
  }

  async rotatePublishToken(
    publisherId: string,
    digest: Uint8Array,
  ): Promise<RotatePublisherTokenResult> {
    try {
      const result = await this.#pool.query(
        `UPDATE thorium_publishers
            SET publish_token_digest = $2,
                token_rotated_at = clock_timestamp()
          WHERE publisher_id = $1`,
        [publisherId, Buffer.from(digest)],
      );
      return result.rowCount === 1 ? "rotated" : "publisher-missing";
    } catch (error) {
      if (isUniqueViolation(error)) return "token-conflict";
      throw error;
    }
  }

  async canAcceptUpload(maximumRequestBytes: number): Promise<boolean> {
    const result = await this.#pool.query<{ readonly used_bytes: string }>(
      `SELECT COALESCE(sum(bundle_size_bytes), 0)::text AS used_bytes
         FROM thorium_self_service_release_reservations`,
    );
    return Number(result.rows[0]?.used_bytes ?? "0") + maximumRequestBytes
      <= MAX_GLOBAL_SELF_SERVICE_RELEASE_BYTES;
  }

  async authorizeRelease(input: {
    readonly publisherId: string;
    readonly packageId: string;
    readonly version: string;
    readonly contentDigest: string;
    readonly sizeBytes: number;
  }): Promise<PublisherReleaseAuthorizationResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      // One global lock makes quota checks and reservations exact. Publishing
      // is deliberately low-volume, so this is preferable to an oversubscription race.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('thorium-self-service-publication-budget'))",
      );

      const ownerResult = await client.query<{ readonly publisher_id: string | null }>(
        `SELECT publisher_id
           FROM thorium_game_package_owners
          WHERE package_id = $1`,
        [input.packageId],
      );
      const owner = ownerResult.rows[0];
      if (owner !== undefined && owner.publisher_id !== input.publisherId) {
        await client.query("ROLLBACK");
        return "package-owner-conflict";
      }
      if (owner === undefined) {
        const owned = await client.query<{ readonly count: string }>(
          `SELECT count(*)::text AS count
             FROM thorium_game_package_owners
            WHERE publisher_id = $1`,
          [input.publisherId],
        );
        if (Number(owned.rows[0]?.count ?? "0") >= MAX_PUBLISHER_PACKAGE_IDS) {
          await client.query("ROLLBACK");
          return "package-quota-exceeded";
        }
      }

      const existing = await client.query<{
        readonly publisher_id: string;
        readonly content_digest: string;
        readonly bundle_size_bytes: string;
      }>(
        `SELECT publisher_id, content_digest, bundle_size_bytes::text
           FROM thorium_self_service_release_reservations
          WHERE package_id = $1 AND package_version = $2`,
        [input.packageId, input.version],
      );
      const reservation = existing.rows[0];
      if (reservation !== undefined) {
        const matches = reservation.publisher_id === input.publisherId
          && reservation.content_digest === input.contentDigest
          && Number(reservation.bundle_size_bytes) === input.sizeBytes;
        await client.query(matches ? "COMMIT" : "ROLLBACK");
        return matches ? "authorized" : "release-conflict";
      }

      const bytes = await client.query<{
        readonly global_bytes: string;
        readonly publisher_bytes: string;
      }>(
        `SELECT
           COALESCE(sum(bundle_size_bytes), 0)::text AS global_bytes,
           COALESCE(sum(bundle_size_bytes) FILTER (WHERE publisher_id = $1), 0)::text
             AS publisher_bytes
         FROM thorium_self_service_release_reservations`,
        [input.publisherId],
      );
      const totals = bytes.rows[0];
      if (Number(totals?.global_bytes ?? "0") + input.sizeBytes
          > MAX_GLOBAL_SELF_SERVICE_RELEASE_BYTES) {
        await client.query("ROLLBACK");
        return "global-byte-quota-exceeded";
      }
      if (Number(totals?.publisher_bytes ?? "0") + input.sizeBytes
          > MAX_PUBLISHER_RELEASE_BYTES) {
        await client.query("ROLLBACK");
        return "publisher-byte-quota-exceeded";
      }

      if (owner === undefined) {
        const claimed = await client.query(
          `INSERT INTO thorium_game_package_owners (package_id, publisher_id)
           VALUES ($1, $2)
           ON CONFLICT (package_id) DO NOTHING`,
          [input.packageId, input.publisherId],
        );
        if (claimed.rowCount !== 1) {
          await client.query("ROLLBACK");
          return "package-owner-conflict";
        }
      }
      await client.query(
        `INSERT INTO thorium_self_service_release_reservations (
           package_id,
           package_version,
           content_digest,
           bundle_size_bytes,
           publisher_id
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          input.packageId,
          input.version,
          input.contentDigest,
          input.sizeBytes,
          input.publisherId,
        ],
      );
      await client.query("COMMIT");
      return "authorized";
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the authorization failure.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
