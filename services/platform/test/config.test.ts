import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../src/config.js";

const SECRETS = {
  ACCOUNT_TOKEN_SECRET: "test-account-token-secret-at-least-32-characters",
  SESSION_TICKET_SECRET: "test-session-ticket-secret-at-least-32-characters",
};
const PRODUCTION_DATABASE_URL = "postgresql://thorium:secret@database.example/thorium";

describe("platform configuration", () => {
  it("normalizes the public base URL", () => {
    const environment = loadEnvironment({
      ...SECRETS,
      NODE_ENV: "test",
      PUBLIC_BASE_URL: "http://localhost:9000/thorium///",
    });

    expect(environment.PUBLIC_BASE_URL).toBe("http://localhost:9000/thorium");
    expect(environment.BROWSER_ALLOWED_ORIGINS).toEqual([]);
  });

  it("normalizes and deduplicates an explicit browser-origin allowlist", () => {
    const environment = loadEnvironment({
      ...SECRETS,
      NODE_ENV: "production",
      DATABASE_URL: PRODUCTION_DATABASE_URL,
      PUBLIC_BASE_URL: "https://platform.example",
      BROWSER_ALLOWED_ORIGINS: "https://appassets.androidplatform.net/, https://preview.example:8443,https://preview.example:8443",
    });

    expect(environment.BROWSER_ALLOWED_ORIGINS).toEqual([
      "https://appassets.androidplatform.net",
      "https://preview.example:8443",
    ]);
  });

  it("rejects wildcards and URLs that are not exact HTTP origins", () => {
    for (const invalid of ["*", "null", "file:///game", "https://example.com/path"]) {
      expect(() => loadEnvironment({
        ...SECRETS,
        NODE_ENV: "production",
        DATABASE_URL: PRODUCTION_DATABASE_URL,
        PUBLIC_BASE_URL: "https://platform.example",
        BROWSER_ALLOWED_ORIGINS: invalid,
      }), invalid).toThrow(/invalid origin/);
    }
  });

  it("requires an absolute HTTPS package origin in production", () => {
    expect(() => loadEnvironment({
      ...SECRETS,
      NODE_ENV: "production",
      DATABASE_URL: PRODUCTION_DATABASE_URL,
      PUBLIC_BASE_URL: "http://platform.example",
    })).toThrow(/HTTPS/);

    expect(loadEnvironment({
      ...SECRETS,
      NODE_ENV: "production",
      DATABASE_URL: PRODUCTION_DATABASE_URL,
      PUBLIC_BASE_URL: "https://platform.example",
    }).PUBLIC_BASE_URL).toBe("https://platform.example");
  });

  it("requires a PostgreSQL registry in production", () => {
    expect(() => loadEnvironment({
      ...SECRETS,
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://platform.example",
    })).toThrow(/DATABASE_URL/);
    expect(() => loadEnvironment({
      ...SECRETS,
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://platform.example",
      DATABASE_URL: "https://database.example/thorium",
    })).toThrow(/PostgreSQL/);
  });

  it("accepts only an all-or-none shared game host configuration", () => {
    expect(() => loadEnvironment({
      ...SECRETS,
      NODE_ENV: "test",
      GAME_HOST_PUBLIC_ENDPOINT: "https://games.yougotserved.dev/play",
    })).toThrow(/must be configured together/);

    const environment = loadEnvironment({
      ...SECRETS,
      NODE_ENV: "test",
      GAME_HOST_PUBLIC_ENDPOINT: "https://games.yougotserved.dev/play",
      GAME_HOST_ADMISSION_PRIVATE_KEY_FILE: "/run/thorium/platform-admission-private.pem",
      GAME_HOST_SERVICE_TOKEN_FILE: "/run/thorium/game-host-service-token",
    });
    expect(environment.GAME_HOST_PUBLIC_ENDPOINT).toBe(
      "https://games.yougotserved.dev/play",
    );
  });
});
