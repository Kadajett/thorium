import { randomBytes } from "node:crypto";
import { request as nodeRequest } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlatformServer } from "../src/platform.js";
import { createTestHarness } from "./test-harness.js";

const ALLOWED_ORIGIN = "https://appassets.androidplatform.net";
const UNTRUSTED_ORIGIN = "https://untrusted.example";

function websocketUpgradeStatus(port: number, origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const upgrade = nodeRequest({
      hostname: "127.0.0.1",
      port,
      path: "/not-a-room/not-a-session",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "Sec-WebSocket-Version": "13",
        ...(origin === undefined ? {} : { Origin: origin }),
      },
    });
    upgrade.once("response", (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    upgrade.once("upgrade", (_response, socket) => {
      socket.destroy();
      resolve(101);
    });
    upgrade.once("error", reject);
    upgrade.end();
  });
}

describe("browser origin policy", () => {
  const gameServer = createPlatformServer(createTestHarness().dependencies, {
    browserAllowedOrigins: [ALLOWED_ORIGIN],
  });
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    await gameServer.listen(0, "127.0.0.1");
    const address = gameServer.transport.server?.address() as AddressInfo | null | undefined;
    if (address === undefined || address === null) throw new Error("test server did not bind a TCP port");
    port = address.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await gameServer.gracefullyShutdown(false);
  });

  it("grants credentialed CORS only to an exact allowed origin", async () => {
    const allowed = await request(baseUrl)
      .get("/health")
      .set("origin", ALLOWED_ORIGIN)
      .expect(200);
    expect(allowed.headers).toMatchObject({
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-credentials": "true",
      vary: "Origin",
    });
    expect(allowed.headers["access-control-allow-origin"]).not.toBe("*");

    const untrusted = await request(baseUrl)
      .get("/health")
      .set("origin", UNTRUSTED_ORIGIN)
      .expect(200);
    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();
    expect(untrusted.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(untrusted.headers.vary).toBe("Origin");
  });

  it("answers allowed preflight requests without granting untrusted origins", async () => {
    const allowed = await request(baseUrl)
      .options("/v1/game-sessions")
      .set("origin", ALLOWED_ORIGIN)
      .set("access-control-request-method", "POST")
      .set("access-control-request-headers", "authorization,content-type")
      .expect(204);
    expect(allowed.headers).toMatchObject({
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
      "access-control-max-age": "600",
      vary: "Origin",
    });

    const untrusted = await request(baseUrl)
      .options("/v1/game-sessions")
      .set("origin", UNTRUSTED_ORIGIN)
      .set("access-control-request-method", "POST")
      .expect(204);
    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();
    expect(untrusted.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("keeps no-Origin native traffic working and rejects untrusted browser upgrades", async () => {
    const nativeHttp = await request(baseUrl).get("/health").expect(200);
    expect(nativeHttp.headers["access-control-allow-origin"]).toBeUndefined();
    expect(nativeHttp.headers["access-control-allow-credentials"]).toBeUndefined();

    await expect(websocketUpgradeStatus(port)).resolves.toBe(101);
    await expect(websocketUpgradeStatus(port, ALLOWED_ORIGIN)).resolves.toBe(101);
    await expect(websocketUpgradeStatus(port, UNTRUSTED_ORIGIN)).resolves.toBe(403);
  });
});
