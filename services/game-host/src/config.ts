import { z } from "zod";

const ExactHttpsEndpoint = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.username === "" && url.password === ""
    && url.search === "" && url.hash === "";
}, "must be an HTTPS endpoint without credentials, query, or fragment");

const BrowserOrigins = z.string().transform((raw, context) => {
  const origins = new Set<string>();
  for (const candidate of raw.split(",").map((value) => value.trim()).filter(Boolean)) {
    try {
      const url = new URL(candidate);
      if (
        !["http:", "https:"].includes(url.protocol) || url.origin !== candidate
        || url.username !== "" || url.password !== ""
      ) throw new Error("invalid_origin");
      origins.add(url.origin);
    } catch {
      context.addIssue({ code: "custom", message: `invalid browser origin: ${candidate}` });
    }
  }
  return [...origins];
});

const Environment = z.strictObject({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST_ADDRESS: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(2_568),
  PUBLIC_ENDPOINT: ExactHttpsEndpoint,
  BASE_PATH: z.string().regex(/^\/[a-z0-9/-]*[a-z0-9]$/).default("/play"),
  MODULE_DIRECTORY: z.string().min(1).default("./server-modules"),
  STATE_DIRECTORY: z.string().min(1).default("./game-state"),
  NONCE_DATABASE_FILE: z.string().min(1).default("./game-state/host-nonces.sqlite"),
  PLATFORM_ADMISSION_PUBLIC_KEY_FILE: z.string().min(1),
  MODULE_SIGNING_PUBLIC_KEY_FILE: z.string().min(1),
  TRANSFER_SIGNING_SECRET_FILE: z.string().min(1),
  PLATFORM_ENDPOINT: z.string().url(),
  PLATFORM_SERVICE_TOKEN_FILE: z.string().min(1),
  BROWSER_ALLOWED_ORIGINS: BrowserOrigins,
});

export type GameHostConfig = z.infer<typeof Environment>;

export function loadConfig(environment: NodeJS.ProcessEnv): GameHostConfig {
  const config = Environment.parse(environment);
  if (!config.PUBLIC_ENDPOINT.endsWith(config.BASE_PATH)) {
    throw new Error("PUBLIC_ENDPOINT must end with BASE_PATH");
  }
  if (config.NODE_ENV === "production" && !config.PLATFORM_ENDPOINT.startsWith("http://thorium-platform.")) {
    throw new Error("Production PLATFORM_ENDPOINT must use the in-cluster Thorium service");
  }
  return config;
}
