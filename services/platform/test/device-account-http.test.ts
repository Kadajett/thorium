import request from "supertest";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { createHttpApplication } from "../src/http/routes.js";
import { createTestHarness } from "./test-harness.js";

const CREDENTIAL = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("device account HTTP session", () => {
  it("returns only a short-lived bearer token and expiry for a stable install credential", async () => {
    const harness = createTestHarness();
    const app = createHttpApplication(harness.dependencies);

    const first = await request(app).post("/v1/device-sessions").send({ credential: CREDENTIAL });
    const second = await request(app).post("/v1/device-sessions").send({ credential: CREDENTIAL });

    expect(first.status).toBe(201);
    expect(Object.keys(first.body).sort()).toEqual(["expiresAt", "token"]);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(decodeJwt(second.body.token).sub).toBe(decodeJwt(first.body.token).sub);
    expect(decodeJwt(second.body.token).accountSessionId)
      .not.toBe(decodeJwt(first.body.token).accountSessionId);
  });

  it("rejects guessable, malformed, and expanded request bodies", async () => {
    const app = createHttpApplication(createTestHarness().dependencies);
    for (const body of [
      { credential: "guessable" },
      { credential: CREDENTIAL, accountId: "chosen-by-client" },
      { credential: `${"A".repeat(42)}B` },
    ]) {
      const response = await request(app).post("/v1/device-sessions").send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("invalid_device_credential");
    }
  });
});
