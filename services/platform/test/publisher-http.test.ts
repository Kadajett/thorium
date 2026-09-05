import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { InMemoryPublisherRepository } from
  "../src/adapters/in-memory-publisher-repository.js";
import type { GameRelease } from "../src/domain/game-package.js";
import { createHttpApplication } from "../src/http/routes.js";
import {
  PublicationConcurrencyGate,
  PublisherRequestLimiter,
  type PublisherHttpDependencies,
} from "../src/http/publisher-routes.js";
import type {
  GameReleasePublicationRepository,
  GameReleasePublicationRepositoryResult,
} from "../src/ports/game-release-publication-repository.js";
import type {
  PackageArtifact,
  PackageArtifactKey,
  PackageArtifactStore,
} from "../src/ports/package-artifact-store.js";
import type {
  PackageArtifactPublication,
  PackageArtifactPublicationResult,
  PackageArtifactPublicationStore,
} from "../src/ports/package-artifact-publication-store.js";
import { GameReleasePublisher } from "../src/publication/game-release-publisher.js";
import { PublisherPublicationService } from
  "../src/publication/publisher-publication-service.js";
import { PublisherAccessService } from "../src/security/publisher-access-service.js";
import {
  createTestGamePackageFixture,
  createRequiresOnlineTestGamePackageFixture,
  TEST_GAME_ARCHIVE_BYTES,
  TEST_GAME_DEPLOY_DESCRIPTOR,
} from "./test-game-package-fixture.js";
import { createTestHarness } from "./test-harness.js";

const PUBLIC_BASE_URL = "https://games.yougotserved.dev";

class MemoryCatalog
implements GameReleasePublicationRepository {
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

class MemoryArtifacts
implements PackageArtifactStore, PackageArtifactPublicationStore {
  readonly artifacts = new Map<string, PackageArtifact>();

  async publish(
    artifact: PackageArtifactPublication,
  ): Promise<PackageArtifactPublicationResult> {
    const key = this.key(artifact.key);
    const existing = this.artifacts.get(key);
    if (existing !== undefined) {
      return existing.sha256 === artifact.sha256 && existing.sizeBytes === artifact.sizeBytes
        ? "already-published"
        : "conflict";
    }
    this.artifacts.set(key, {
      bytes: Uint8Array.from(artifact.bytes),
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    });
    return "published";
  }

  async read(key: PackageArtifactKey): Promise<PackageArtifact | undefined> {
    return this.artifacts.get(this.key(key));
  }

  private key(key: PackageArtifactKey): string {
    return `${key.packageId}\0${key.version}\0${key.fileName}`;
  }
}

function createPublisherTestApplication(
  reservedPackageIds: readonly string[] = [],
  limits?: PublisherHttpDependencies["limits"],
) {
  const harness = createTestHarness();
  const publishers = new InMemoryPublisherRepository(reservedPackageIds);
  const access = new PublisherAccessService(publishers);
  const releases = new MemoryCatalog();
  const artifacts = new MemoryArtifacts();
  const publication = new PublisherPublicationService({
    authorization: publishers,
    publisher: new GameReleasePublisher({
      artifacts,
      releases,
      publicBaseUrl: PUBLIC_BASE_URL,
      now: () => new Date("2026-09-04T20:00:00.000Z"),
    }),
  });
  const app = createHttpApplication({
    ...harness.dependencies,
    publisher: { access, publication, ...(limits === undefined ? {} : { limits }) },
  });
  return { app, access, artifacts, publishers, releases };
}

async function exchangeToken(
  app: ReturnType<typeof createPublisherTestApplication>["app"],
  username = "friend.dev",
  password = "correct horse battery staple",
) {
  return request(app)
    .post("/v1/publishers/token")
    .auth(username, password, { type: "basic" });
}

describe("self-service publisher HTTP API", () => {
  it("claims a username on first exchange and rotates its opaque publish token on login", async () => {
    const { app, access, publishers } = createPublisherTestApplication();

    const first = await exchangeToken(app, "Friend.Dev");
    expect(first.status).toBe(201);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body).toMatchObject({
      tokenType: "Bearer",
      scope: "game:publish",
    });
    expect(first.body.token).toMatch(/^thp_[A-Za-z0-9_-]{43}$/);
    await expect(access.authenticate(first.body.token)).resolves.toMatchObject({
      username: "friend.dev",
    });

    const second = await exchangeToken(app, "friend.dev");
    expect(second.status).toBe(201);
    expect(second.body.token).not.toBe(first.body.token);
    await expect(access.authenticate(first.body.token)).rejects.toThrow("invalid_publish_token");
    await expect(access.authenticate(second.body.token)).resolves.toMatchObject({
      username: "friend.dev",
    });
    expect(publishers.containsRawCredential("correct horse battery staple")).toBe(false);
    expect(publishers.containsRawCredential(first.body.token)).toBe(false);
    expect(publishers.containsRawCredential(second.body.token)).toBe(false);
  });

  it("returns one generic auth failure for wrong, malformed, and invalid credentials", async () => {
    const { app } = createPublisherTestApplication();
    await exchangeToken(app);

    const responses = await Promise.all([
      exchangeToken(app, "friend.dev", "this password is definitely wrong"),
      request(app).post("/v1/publishers/token").set("Authorization", "Basic !!!"),
      exchangeToken(app, "x", "short"),
      request(app).post("/v1/publishers/token"),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.error).toEqual({
        code: "invalid_publisher_credentials",
        message: "The publisher credentials are invalid.",
      });
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("publishes one verified immutable package with only the scoped bearer token", async () => {
    const { app, artifacts, releases } = createPublisherTestApplication();
    const token = (await exchangeToken(app)).body.token as string;

    const published = await request(app)
      .post("/v1/publisher/releases")
      .set("Authorization", `Bearer ${token}`)
      .field("descriptor", JSON.stringify(TEST_GAME_DEPLOY_DESCRIPTOR))
      .attach("archive", TEST_GAME_ARCHIVE_BYTES, {
        filename: TEST_GAME_DEPLOY_DESCRIPTOR.bundle.fileName,
        contentType: "application/zip",
      });

    expect(published.status).toBe(201);
    expect(published.headers["cache-control"]).toBe("no-store");
    expect(published.body).toMatchObject({
      status: "published",
      release: {
        packageId: TEST_GAME_DEPLOY_DESCRIPTOR.game.packageId,
        version: TEST_GAME_DEPLOY_DESCRIPTOR.game.version,
      },
    });
    expect(releases.releases).toHaveLength(1);
    expect(artifacts.artifacts).toHaveLength(1);

    const replayed = await request(app)
      .post("/v1/publisher/releases")
      .set("Authorization", `Bearer ${token}`)
      .field("descriptor", JSON.stringify(TEST_GAME_DEPLOY_DESCRIPTOR))
      .attach("archive", TEST_GAME_ARCHIVE_BYTES, {
        filename: TEST_GAME_DEPLOY_DESCRIPTOR.bundle.fileName,
        contentType: "application/zip",
      });
    expect(replayed.status).toBe(200);
    expect(replayed.body.status).toBe("already-published");
    expect(releases.releases).toHaveLength(1);
    expect(artifacts.artifacts).toHaveLength(1);
  });

  it("does not let another publisher publish into a claimed or operator-reserved package ID", async () => {
    const first = createPublisherTestApplication();
    const firstToken = (await exchangeToken(first.app, "first.dev")).body.token as string;
    const publish = (app: typeof first.app, token: string) => request(app)
      .post("/v1/publisher/releases")
      .set("Authorization", `Bearer ${token}`)
      .field("descriptor", JSON.stringify(TEST_GAME_DEPLOY_DESCRIPTOR))
      .attach("archive", TEST_GAME_ARCHIVE_BYTES, {
        filename: TEST_GAME_DEPLOY_DESCRIPTOR.bundle.fileName,
        contentType: "application/zip",
      });
    expect((await publish(first.app, firstToken)).status).toBe(201);
    const secondToken = (await exchangeToken(
      first.app,
      "second.dev",
      "a different sufficiently long password",
    )).body.token as string;
    const denied = await publish(first.app, secondToken);
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe("package_id_not_owned");

    const reserved = createPublisherTestApplication([
      TEST_GAME_DEPLOY_DESCRIPTOR.game.packageId,
    ]);
    const reservedToken = (await exchangeToken(reserved.app)).body.token as string;
    expect((await publish(reserved.app, reservedToken)).status).toBe(409);
  });

  it("authenticates before accepting an archive and validates every multipart input", async () => {
    const { app, publishers } = createPublisherTestApplication();
    const unauthenticated = await request(app)
      .post("/v1/publisher/releases")
      .field("descriptor", JSON.stringify(TEST_GAME_DEPLOY_DESCRIPTOR))
      .attach("archive", TEST_GAME_ARCHIVE_BYTES, {
        filename: TEST_GAME_DEPLOY_DESCRIPTOR.bundle.fileName,
      });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe("invalid_publish_token");

    const token = (await exchangeToken(app)).body.token as string;
    const invalid = await request(app)
      .post("/v1/publisher/releases")
      .set("Authorization", `Bearer ${token}`)
      .field("descriptor", JSON.stringify({ nope: true }))
      .attach("archive", Buffer.from("not a zip"), { filename: "invalid.zip" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("invalid_release");
    expect(publishers.hasPackageOwners()).toBe(false);
  });

  it("rejects oversized multipart archives before verification", async () => {
    const { app } = createPublisherTestApplication([], {
      archiveBytes: TEST_GAME_ARCHIVE_BYTES.byteLength - 1,
    });
    const token = (await exchangeToken(app)).body.token as string;
    const response = await request(app)
      .post("/v1/publisher/releases")
      .set("Authorization", `Bearer ${token}`)
      .field("descriptor", JSON.stringify(TEST_GAME_DEPLOY_DESCRIPTOR))
      .attach("archive", TEST_GAME_ARCHIVE_BYTES, {
        filename: TEST_GAME_DEPLOY_DESCRIPTOR.bundle.fileName,
      });
    expect(response.status).toBe(413);
    expect(["archive_too_large", "release_upload_too_large"])
      .toContain(response.body.error.code);
  });

  it("accepts a quoted multipart boundary and rejects wrong methods and media types", async () => {
    const { app } = createPublisherTestApplication();
    const token = (await exchangeToken(app)).body.token as string;
    const boundary = "thorium-test-boundary";
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="descriptor"\r\n\r\n${JSON.stringify(TEST_GAME_DEPLOY_DESCRIPTOR)}\r\n`
        + `--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="${TEST_GAME_DEPLOY_DESCRIPTOR.bundle.fileName}"\r\n`
        + "Content-Type: application/zip\r\n\r\n",
      ),
      TEST_GAME_ARCHIVE_BYTES,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const quoted = await request(app)
      .post("/v1/publisher/releases")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", `multipart/form-data; boundary="${boundary}"`)
      .send(multipart);
    expect(quoted.status).toBe(201);

    expect((await request(app).get("/v1/publishers/token")).status).toBe(404);
    expect((await request(app).put("/v1/publisher/releases")).status).toBe(404);
    const wrongMedia = await request(app)
      .post("/v1/publisher/releases")
      .set("Authorization", `Bearer ${token}`)
      .send({ descriptor: TEST_GAME_DEPLOY_DESCRIPTOR });
    expect(wrongMedia.status).toBe(415);
    expect(wrongMedia.body.error.code).toBe("multipart_required");
  });

  it("does not accept public packages that require an executable server module", async () => {
    const { app, publishers } = createPublisherTestApplication();
    const token = (await exchangeToken(app)).body.token as string;
    const fixture = createRequiresOnlineTestGamePackageFixture(PUBLIC_BASE_URL);
    const response = await request(app)
      .post("/v1/publisher/releases")
      .set("Authorization", `Bearer ${token}`)
      .field("descriptor", JSON.stringify(fixture.descriptor))
      .attach("archive", fixture.artifact.bytes, {
        filename: fixture.descriptor.bundle.fileName,
      });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("server_module_required");
    expect(publishers.hasPackageOwners()).toBe(false);
  });

  it("never treats a normal account bearer as a publishing capability", async () => {
    const { app } = createPublisherTestApplication();
    const accountToken = await createTestHarness().accountIdentity.issueForTesting(
      "account-one",
      "session-one",
    );
    const response = await request(app)
      .post("/v1/publisher/releases")
      .set("Authorization", `Bearer ${accountToken}`);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("invalid_publish_token");
  });

  it("rate-limits Basic exchange by bounded Cloudflare client IP and publish by publisher", async () => {
    const { app } = createPublisherTestApplication([], {
      exchangeAttempts: 1,
      publishAttempts: 10,
      publisherPublishAttempts: 1,
    });
    const first = await request(app)
      .post("/v1/publishers/token")
      .set("CF-Connecting-IP", "192.0.2.10")
      .auth("friend.dev", "correct horse battery staple", { type: "basic" });
    expect(first.status).toBe(201);
    const blockedExchange = await request(app)
      .post("/v1/publishers/token")
      .set("CF-Connecting-IP", "192.0.2.10")
      .auth("friend.dev", "correct horse battery staple", { type: "basic" });
    expect(blockedExchange.status).toBe(429);
    expect(blockedExchange.headers["retry-after"]).toBeDefined();

    const wrongMedia = () => request(app)
      .post("/v1/publisher/releases")
      .set("CF-Connecting-IP", "192.0.2.20")
      .set("Authorization", `Bearer ${first.body.token as string}`)
      .send({});
    expect((await wrongMedia()).status).toBe(415);
    const blockedPublisher = await wrongMedia();
    expect(blockedPublisher.status).toBe(429);
    expect(blockedPublisher.body.error.code).toBe("publisher_rate_limited");
  });
});

describe("publisher request limiter", () => {
  it("bounds peer keys and opportunistically evicts expired buckets", () => {
    const limiter = new PublisherRequestLimiter({
      windowMs: 1_000,
      exchangeAttempts: 1,
      publishAttempts: 1,
      maximumKeys: 2,
    });
    expect(limiter.attempt("exchange", "192.0.2.1", 1)).toBeUndefined();
    expect(limiter.attempt("exchange", "192.0.2.2", 1)).toBeUndefined();
    expect(limiter.attempt("exchange", "192.0.2.3", 2)).toBe(1);
    expect(limiter.attempt("exchange", "192.0.2.3", 1_002)).toBeUndefined();
  });

  it("caps process-wide publication concurrency until a slot is released", () => {
    const gate = new PublicationConcurrencyGate(2);
    const releaseFirst = gate.acquire();
    const releaseSecond = gate.acquire();
    expect(releaseFirst).toBeTypeOf("function");
    expect(releaseSecond).toBeTypeOf("function");
    expect(gate.acquire()).toBeUndefined();
    releaseFirst?.();
    expect(gate.acquire()).toBeTypeOf("function");
  });
});

describe("publisher release reservations", () => {
  it("enforces the persistent package-owner count and keeps exact retries idempotent", async () => {
    const repository = new InMemoryPublisherRepository();
    const access = new PublisherAccessService(repository);
    const issued = await access.exchange("quota.owner", "a sufficiently long quota password");
    const principal = await access.authenticate(issued.token);
    for (let index = 0; index < 5; index += 1) {
      const input = {
        publisherId: principal.publisherId,
        packageId: `dev.quota.game${index}`,
        version: "1.0.0",
        contentDigest: String(index).repeat(64),
        sizeBytes: 1_024,
      };
      await expect(repository.authorizeRelease(input)).resolves.toBe("authorized");
      await expect(repository.authorizeRelease(input)).resolves.toBe("authorized");
    }
    await expect(repository.authorizeRelease({
      publisherId: principal.publisherId,
      packageId: "dev.quota.game5",
      version: "1.0.0",
      contentDigest: "f".repeat(64),
      sizeBytes: 1_024,
    })).resolves.toBe("package-quota-exceeded");
  });
});

describe("publisher fixture sanity", () => {
  it("uses the exact archive digest declared by the deploy descriptor", () => {
    expect(createHash("sha256").update(TEST_GAME_ARCHIVE_BYTES).digest("hex"))
      .toBe(TEST_GAME_DEPLOY_DESCRIPTOR.bundle.sha256);
    expect(createTestGamePackageFixture(PUBLIC_BASE_URL).descriptor)
      .toEqual(TEST_GAME_DEPLOY_DESCRIPTOR);
  });
});
