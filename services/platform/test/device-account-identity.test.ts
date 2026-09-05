import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { HmacAccountTokenAdapter } from "../src/security/account-token-adapter.js";

const SECRET = "device-account-test-secret-at-least-32-characters";
const CREDENTIAL = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("device account identity", () => {
  it("binds a stable opaque account to a high-entropy install credential", async () => {
    const now = new Date("2026-09-05T00:00:00.000Z");
    const identity = new HmacAccountTokenAdapter(SECRET, () => now);

    const first = await identity.issueForDeviceCredential(CREDENTIAL);
    const second = await identity.issueForDeviceCredential(CREDENTIAL);
    const firstClaims = decodeJwt(first.token);
    const secondClaims = decodeJwt(second.token);

    expect(firstClaims.sub).toMatch(/^device_[A-Za-z0-9_-]{43}$/);
    expect(secondClaims.sub).toBe(firstClaims.sub);
    expect(secondClaims.accountSessionId).not.toBe(firstClaims.accountSessionId);
    expect(first.expiresAt.toISOString()).toBe("2026-09-06T00:00:00.000Z");
    await expect(identity.verifyAccountToken(first.token)).resolves.toMatchObject({
      accountId: firstClaims.sub,
      accountSessionId: firstClaims.accountSessionId,
      expiresAt: first.expiresAt,
    });
  });

  it("rejects credentials that are short, malformed, or non-canonical", async () => {
    const identity = new HmacAccountTokenAdapter(SECRET);
    for (const credential of ["A".repeat(42), "!".repeat(43), `${"A".repeat(42)}B`]) {
      await expect(identity.issueForDeviceCredential(credential)).rejects.toThrow(
        "invalid_device_credential",
      );
    }
  });
});
