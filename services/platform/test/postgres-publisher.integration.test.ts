import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresGameCatalogRepository } from
  "../src/adapters/postgres/postgres-game-catalog-repository.js";
import { runPostgresMigrations } from "../src/adapters/postgres/postgres-migrations.js";
import { PostgresPublisherRepository } from
  "../src/adapters/postgres/postgres-publisher-repository.js";
import { PublisherAccessService } from "../src/security/publisher-access-service.js";
import { createTestGamePackageFixture } from "./test-game-package-fixture.js";

const databaseUrl = process.env.THORIUM_TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl === undefined || databaseUrl.length === 0
  ? describe.skip
  : describe;

function quoteSchema(name: string): string {
  if (!/^thorium_publisher_test_[a-f0-9]{32}$/.test(name)) throw new Error("unsafe test schema");
  return `"${name}"`;
}

describeWithPostgres("PostgreSQL self-service publisher", () => {
  const schemaName = `thorium_publisher_test_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = quoteSchema(schemaName);
  let controlPool: Pool | undefined;
  let publisherPool: Pool | undefined;
  let repository: PostgresPublisherRepository;
  let access: PublisherAccessService;

  beforeAll(async () => {
    controlPool = new Pool({ connectionString: databaseUrl, max: 2 });
    await controlPool.query(`CREATE SCHEMA ${quotedSchema}`);
    publisherPool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      options: `-c search_path=${schemaName},public`,
    });
    await runPostgresMigrations(publisherPool);
    repository = new PostgresPublisherRepository(publisherPool);
    access = new PublisherAccessService(repository);
  }, 30_000);

  afterAll(async () => {
    await publisherPool?.end();
    try {
      await controlPool?.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
    } finally {
      await controlPool?.end();
    }
  }, 30_000);

  it("stores hashes only and atomically rotates the sole publish token", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `publisher.${suffix}`;
    const password = "correct horse battery staple";
    const first = await access.exchange(username, password);
    const principal = await access.authenticate(first.token);
    const second = await access.exchange(username, password);

    await expect(access.authenticate(first.token)).rejects.toThrow("invalid_publish_token");
    await expect(access.authenticate(second.token)).resolves.toEqual(principal);
    const stored = await publisherPool!.query<{
      readonly password_hash: Buffer;
      readonly publish_token_digest: Buffer;
    }>(
      `SELECT password_hash, publish_token_digest
         FROM thorium_publishers
        WHERE username = $1`,
      [username],
    );
    expect(stored.rows[0]?.password_hash.toString("utf8")).not.toBe(password);
    expect(stored.rows[0]?.publish_token_digest.toString("utf8")).not.toBe(second.token);
  });

  it("atomically gives a new package ID to only one concurrent publisher", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const [firstToken, secondToken] = await Promise.all([
      access.exchange(`first.${suffix}`, "a first sufficiently long password"),
      access.exchange(`second.${suffix}`, "a second sufficiently long password"),
    ]);
    const [first, second] = await Promise.all([
      access.authenticate(firstToken.token),
      access.authenticate(secondToken.token),
    ]);
    const packageId = `dev.test.${suffix}`;
    const results = await Promise.all([
      repository.authorizeRelease({
        publisherId: first.publisherId,
        packageId,
        version: "1.0.0",
        contentDigest: "a".repeat(64),
        sizeBytes: 1_024,
      }),
      repository.authorizeRelease({
        publisherId: second.publisherId,
        packageId,
        version: "1.0.0",
        contentDigest: "b".repeat(64),
        sizeBytes: 1_024,
      }),
    ]);
    expect(results.sort()).toEqual(["authorized", "package-owner-conflict"]);
  });

  it("reserves operator packages and enforces the persistent five-package quota", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const issued = await access.exchange(
      `quota.${suffix}`,
      "one deliberately sufficiently long password",
    );
    const principal = await access.authenticate(issued.token);
    const catalog = new PostgresGameCatalogRepository(publisherPool!);
    const fixture = createTestGamePackageFixture("https://games.yougotserved.dev");
    await catalog.publish(fixture.release);
    await expect(repository.authorizeRelease({
      publisherId: principal.publisherId,
      packageId: fixture.release.packageId,
      version: "9.9.9",
      contentDigest: "c".repeat(64),
      sizeBytes: 1_024,
    })).resolves.toBe("package-owner-conflict");

    for (let index = 0; index < 5; index += 1) {
      await expect(repository.authorizeRelease({
        publisherId: principal.publisherId,
        packageId: `dev.quota${index}.${suffix}`,
        version: "1.0.0",
        contentDigest: String(index).repeat(64),
        sizeBytes: 1_024,
      })).resolves.toBe("authorized");
    }
    await expect(repository.authorizeRelease({
      publisherId: principal.publisherId,
      packageId: `dev.quota5.${suffix}`,
      version: "1.0.0",
      contentDigest: "f".repeat(64),
      sizeBytes: 1_024,
    })).resolves.toBe("package-quota-exceeded");
  });
});
