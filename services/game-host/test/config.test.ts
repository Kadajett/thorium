import { Client, type SeatReservation } from "@colyseus/sdk";
import { describe, expect, it } from "vitest";
import { colyseusPublicAddress, loadConfig } from "../src/config.js";

class EndpointProbeClient extends Client {
  socketEndpoint(reservation: SeatReservation): string {
    return this.buildEndpoint(reservation);
  }
}

describe("game host config", () => {
  it("accepts normal runtime-owned process environment entries", () => {
    expect(loadConfig({
      NODE_ENV: "production",
      PATH: "/usr/bin",
      HOME: "/home/node",
      HOSTNAME: "host-pod",
      PUBLIC_ENDPOINT: "https://games.yougotserved.dev/play",
      PLATFORM_ENDPOINT: "http://thorium-platform.thorium.svc.cluster.local:2567",
      PLATFORM_ADMISSION_PUBLIC_KEY_FILE: "/run/secrets/platform.pem",
      MODULE_SIGNING_PUBLIC_KEY_FILE: "/run/secrets/modules.pem",
      TRANSFER_SIGNING_SECRET_FILE: "/run/secrets/transfer",
      PLATFORM_SERVICE_TOKEN_FILE: "/run/secrets/token",
      BROWSER_ALLOWED_ORIGINS: "https://appassets.androidplatform.net",
    })).toMatchObject({
      NODE_ENV: "production",
      BASE_PATH: "/play",
      PORT: 2_568,
      PUBLIC_ENDPOINT: "https://games.yougotserved.dev/play",
    });
  });

  it("advertises a scheme-free Colyseus socket address with the public path", () => {
    const publicAddress = colyseusPublicAddress("https://games.yougotserved.dev/play");
    expect(publicAddress).toBe("games.yougotserved.dev/play");

    const client = new EndpointProbeClient("https://games.yougotserved.dev/play");
    expect(client.socketEndpoint({
      name: "g_0123456789abcdef0123456789abcdef",
      publicAddress,
      processId: "process",
      roomId: "room",
      sessionId: "session",
    })).toBe("wss://games.yougotserved.dev/play/process/room?");
  });
});
