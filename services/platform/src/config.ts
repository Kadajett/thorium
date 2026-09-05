import { z } from "zod";

const BrowserOriginsSchema = z.string().default("").transform((value, context) => {
  const origins: string[] = [];
  for (const candidate of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    try {
      const origin = new URL(candidate);
      if (
        (origin.protocol !== "https:" && origin.protocol !== "http:")
        || origin.username !== ""
        || origin.password !== ""
        || origin.pathname !== "/"
        || origin.search !== ""
        || origin.hash !== ""
      ) throw new Error("not_an_http_origin");
      origins.push(origin.origin);
    } catch {
      context.addIssue({
        code: "custom",
        message: `BROWSER_ALLOWED_ORIGINS contains an invalid origin: ${candidate}`,
      });
    }
  }
  return [...new Set(origins)];
});

const HttpsEndpointSchema = z.string().trim().url().refine((value) => {
  const endpoint = new URL(value);
  return endpoint.protocol === "https:" && endpoint.username === ""
    && endpoint.password === "" && endpoint.search === "" && endpoint.hash === "";
}, "must be an HTTPS endpoint without credentials, query, or fragment");

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(2_567),
  PUBLIC_BASE_URL: z.string().trim().url().default("http://localhost:2567")
    .transform((value) => value.replace(/\/+$/, "")),
  BROWSER_ALLOWED_ORIGINS: BrowserOriginsSchema,
  PACKAGE_ARTIFACT_DIRECTORY: z.string().trim().min(1).default("./artifacts"),
  DATABASE_URL: z.string().trim().min(1).optional(),
  ACCOUNT_TOKEN_SECRET: z.string().min(32),
  SESSION_TICKET_SECRET: z.string().min(32),
  SESSION_TICKET_TTL_SECONDS: z.coerce.number().int().min(15).max(120).default(60),
  GAME_HOST_PUBLIC_ENDPOINT: HttpsEndpointSchema.optional(),
  GAME_HOST_ADMISSION_PRIVATE_KEY_FILE: z.string().trim().min(1).optional(),
  GAME_HOST_SERVICE_TOKEN_FILE: z.string().trim().min(1).optional(),
}).superRefine((environment, context) => {
  const publicUrl = new URL(environment.PUBLIC_BASE_URL);
  if (environment.NODE_ENV === "production" && publicUrl.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      path: ["PUBLIC_BASE_URL"],
      message: "PUBLIC_BASE_URL must use HTTPS in production",
    });
  }
  if (environment.NODE_ENV === "production" && environment.DATABASE_URL === undefined) {
    context.addIssue({
      code: "custom",
      path: ["DATABASE_URL"],
      message: "DATABASE_URL is required in production",
    });
  }
  if (environment.DATABASE_URL !== undefined) {
    try {
      const databaseUrl = new URL(environment.DATABASE_URL);
      if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
        throw new Error("not_postgresql");
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "DATABASE_URL must be a valid PostgreSQL URL",
      });
    }
  }
  if (publicUrl.username !== "" || publicUrl.password !== "" || publicUrl.search !== "" || publicUrl.hash !== "") {
    context.addIssue({
      code: "custom",
      path: ["PUBLIC_BASE_URL"],
      message: "PUBLIC_BASE_URL must not contain credentials, a query, or a fragment",
    });
  }
  const gameHostValues = [
    environment.GAME_HOST_PUBLIC_ENDPOINT,
    environment.GAME_HOST_ADMISSION_PRIVATE_KEY_FILE,
    environment.GAME_HOST_SERVICE_TOKEN_FILE,
  ];
  if (gameHostValues.some((value) => value !== undefined)
      && gameHostValues.some((value) => value === undefined)) {
    context.addIssue({
      code: "custom",
      path: ["GAME_HOST_PUBLIC_ENDPOINT"],
      message: "GAME_HOST_PUBLIC_ENDPOINT, GAME_HOST_ADMISSION_PRIVATE_KEY_FILE, and GAME_HOST_SERVICE_TOKEN_FILE must be configured together",
    });
  }
});

export type PlatformEnvironment = z.infer<typeof EnvironmentSchema>;

export function loadEnvironment(environment: NodeJS.ProcessEnv): PlatformEnvironment {
  return EnvironmentSchema.parse(environment);
}
