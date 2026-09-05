import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import type {
  PublisherCredential,
  PublisherCredentialRepository,
} from "../ports/publisher-repository.js";

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;
const TOKEN_BYTES = 32;
const TOKEN_PREFIX = "thp_";
const TOKEN_PATTERN = /^thp_[A-Za-z0-9_-]{43}$/;
const SCRYPT_OPTIONS = {
  N: 32_768,
  r: 8,
  p: 1,
  maxmem: 64 * 1_024 * 1_024,
} as const;

export interface PublisherPrincipal {
  readonly publisherId: string;
  readonly username: string;
}

export interface IssuedPublishToken {
  readonly token: string;
  readonly tokenType: "Bearer";
  readonly scope: "game:publish";
}

export class InvalidPublisherCredentialsError extends Error {
  constructor() {
    super("invalid_publisher_credentials");
  }
}

export class InvalidPublishTokenError extends Error {
  constructor() {
    super("invalid_publish_token");
  }
}

function normalizeUsername(username: string): string | undefined {
  const normalized = username.trim().toLowerCase();
  return USERNAME_PATTERN.test(normalized) ? normalized : undefined;
}

function isValidPassword(password: string): boolean {
  const bytes = Buffer.byteLength(password, "utf8");
  return [...password].length >= 12
    && bytes <= 256
    && !/[\0-\x1f\x7f]/.test(password);
}

async function derivePasswordHash(password: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, PASSWORD_HASH_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error !== null) reject(error);
      else resolve(key);
    });
  });
}

function createPublishToken(): { readonly raw: string; readonly digest: Buffer } {
  const raw = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { raw, digest: digestPublishToken(raw) };
}

function digestPublishToken(raw: string): Buffer {
  // A random 256-bit bearer capability does not need a slow password hash.
  // Hashing keeps the raw capability out of durable state.
  return createHash("sha256")
    .update("thorium-publish-token\0")
    .update(raw, "utf8")
    .digest();
}

function copyPrincipal(credential: PublisherCredential): PublisherPrincipal {
  return {
    publisherId: credential.publisherId,
    username: credential.username,
  };
}

/** First use creates a publisher; later valid Basic exchanges rotate its sole token. */
export class PublisherAccessService {
  readonly #repository: PublisherCredentialRepository;

  constructor(repository: PublisherCredentialRepository) {
    this.#repository = repository;
  }

  async exchange(usernameInput: string, password: string): Promise<IssuedPublishToken> {
    const username = normalizeUsername(usernameInput);
    if (username === undefined || !isValidPassword(password)) {
      // Keep malformed credentials on the same expensive, generic failure path
      // as a wrong password so the endpoint does not become a cheap oracle.
      await derivePasswordHash(password, Buffer.alloc(PASSWORD_SALT_BYTES));
      throw new InvalidPublisherCredentialsError();
    }

    let credential = await this.#repository.findByUsername(username);
    if (credential === undefined) {
      const passwordSalt = randomBytes(PASSWORD_SALT_BYTES);
      const passwordHash = await derivePasswordHash(password, passwordSalt);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const issued = createPublishToken();
        const created = await this.#repository.create({
          publisherId: randomUUID(),
          username,
          passwordSalt,
          passwordHash,
          publishTokenDigest: issued.digest,
        });
        if (created === "created") return this.issued(issued.raw);
        if (created === "username-exists") break;
      }
      credential = await this.#repository.findByUsername(username);
      if (credential === undefined) throw new InvalidPublisherCredentialsError();
    }

    const candidateHash = await derivePasswordHash(password, credential.passwordSalt);
    if (
      candidateHash.byteLength !== credential.passwordHash.byteLength
      || !timingSafeEqual(candidateHash, credential.passwordHash)
    ) throw new InvalidPublisherCredentialsError();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const issued = createPublishToken();
      const rotated = await this.#repository.rotatePublishToken(
        credential.publisherId,
        issued.digest,
      );
      if (rotated === "rotated") return this.issued(issued.raw);
      if (rotated === "publisher-missing") break;
    }
    throw new InvalidPublisherCredentialsError();
  }

  async authenticate(token: string): Promise<PublisherPrincipal> {
    if (!TOKEN_PATTERN.test(token)) throw new InvalidPublishTokenError();
    const bytes = Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url");
    if (bytes.byteLength !== TOKEN_BYTES || bytes.toString("base64url") !== token.slice(4)) {
      throw new InvalidPublishTokenError();
    }
    const credential = await this.#repository.findByPublishTokenDigest(digestPublishToken(token));
    if (credential === undefined) throw new InvalidPublishTokenError();
    return copyPrincipal(credential);
  }

  private issued(token: string): IssuedPublishToken {
    return { token, tokenType: "Bearer", scope: "game:publish" };
  }
}
