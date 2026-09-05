import { createHmac, createSecretKey, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type {
  AccountSession,
  DeviceAccountIdentityPort,
  IssuedAccountAuthorization,
} from "../ports/account-identity.js";

const ACCOUNT_TOKEN_ISSUER = "thorium-identity";
const ACCOUNT_TOKEN_AUDIENCE = "thorium-platform";

const AccountTokenClaimsSchema = z.object({
  sub: z.string().min(1).max(128),
  accountSessionId: z.string().min(1).max(128),
  exp: z.number().int().positive(),
});

export class HmacAccountTokenAdapter implements DeviceAccountIdentityPort {
  readonly #key: ReturnType<typeof createSecretKey>;
  readonly #secret: string;
  readonly #now: () => Date;

  constructor(secret: string, now: () => Date = () => new Date()) {
    this.#secret = secret;
    this.#key = createSecretKey(Buffer.from(secret, "utf8"));
    this.#now = now;
  }

  async verifyAccountToken(token: string): Promise<AccountSession> {
    const { payload } = await jwtVerify(token, this.#key, {
      algorithms: ["HS256"],
      issuer: ACCOUNT_TOKEN_ISSUER,
      audience: ACCOUNT_TOKEN_AUDIENCE,
      currentDate: this.#now(),
    });
    const claims = AccountTokenClaimsSchema.parse(payload);
    return {
      accountId: claims.sub,
      accountSessionId: claims.accountSessionId,
      expiresAt: new Date(claims.exp * 1_000),
    };
  }

  async issueForTesting(
    accountId: string,
    accountSessionId: string,
    lifetimeSeconds = 3_600,
  ): Promise<string> {
    return (await this.#issue(accountId, accountSessionId, lifetimeSeconds)).token;
  }

  async issueForDeviceCredential(credential: string): Promise<IssuedAccountAuthorization> {
    if (!isCanonicalDeviceCredential(credential)) {
      throw new Error("invalid_device_credential");
    }
    const accountId = `device_${createHmac("sha256", this.#secret)
      .update("thorium-device-account\0")
      .update(credential)
      .digest("base64url")}`;
    return this.#issue(accountId, randomUUID(), 24 * 60 * 60);
  }

  async #issue(
    accountId: string,
    accountSessionId: string,
    lifetimeSeconds: number,
  ): Promise<IssuedAccountAuthorization> {
    const nowSeconds = Math.floor(this.#now().getTime() / 1_000);
    const expiresAt = new Date((nowSeconds + lifetimeSeconds) * 1_000);
    const token = await new SignJWT({ accountSessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ACCOUNT_TOKEN_ISSUER)
      .setAudience(ACCOUNT_TOKEN_AUDIENCE)
      .setSubject(accountId)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + lifetimeSeconds)
      .sign(this.#key);
    return { token, expiresAt };
  }
}

function isCanonicalDeviceCredential(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.byteLength === 32 && bytes.toString("base64url") === value;
}
