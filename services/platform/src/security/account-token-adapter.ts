import { createSecretKey } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type {
  AccountIdentityPort,
  AccountSession,
} from "../ports/account-identity.js";

const ACCOUNT_TOKEN_ISSUER = "thorium-identity";
const ACCOUNT_TOKEN_AUDIENCE = "thorium-platform";

const AccountTokenClaimsSchema = z.object({
  sub: z.string().min(1).max(128),
  accountSessionId: z.string().min(1).max(128),
  exp: z.number().int().positive(),
});

export class HmacAccountTokenAdapter implements AccountIdentityPort {
  readonly #key: ReturnType<typeof createSecretKey>;
  readonly #now: () => Date;

  constructor(secret: string, now: () => Date = () => new Date()) {
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
    const nowSeconds = Math.floor(this.#now().getTime() / 1_000);
    return new SignJWT({ accountSessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(ACCOUNT_TOKEN_ISSUER)
      .setAudience(ACCOUNT_TOKEN_AUDIENCE)
      .setSubject(accountId)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + lifetimeSeconds)
      .sign(this.#key);
  }
}
