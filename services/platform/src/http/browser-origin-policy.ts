import {
  matchMaker,
  type BeforeUpgradeHandler,
} from "@colyseus/core";

const ALLOWED_HEADERS = "Authorization, Content-Type";
const ALLOWED_METHODS = "GET, HEAD, POST, OPTIONS";
const PREFLIGHT_MAX_AGE_SECONDS = 600;

export interface BrowserOriginPolicy {
  readonly allows: (origin: string) => boolean;
  readonly corsHeaders: (origin: string | null) => Readonly<Record<string, string>>;
}

export function createBrowserOriginPolicy(
  allowedOrigins: readonly string[],
): BrowserOriginPolicy {
  const allowed = new Set(allowedOrigins);
  const allows = (origin: string): boolean => allowed.has(origin);

  return {
    allows,
    corsHeaders(origin) {
      const varyingHeaders = { Vary: "Origin" };
      if (origin === null || !allows(origin)) return varyingHeaders;
      return {
        ...varyingHeaders,
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": ALLOWED_HEADERS,
        "Access-Control-Allow-Methods": ALLOWED_METHODS,
        "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_SECONDS),
      };
    },
  };
}

/** Installs the customization hook documented by Colyseus' matchmaker controller. */
export function configureColyseusCors(policy: BrowserOriginPolicy): void {
  const defaults = matchMaker.controller.DEFAULT_CORS_HEADERS as Record<string, string>;
  for (const header of Object.keys(defaults)) delete defaults[header];
  matchMaker.controller.getCorsHeaders = (headers) => ({
    ...policy.corsHeaders(headers.get("origin")),
  });
}

export function createWebSocketOriginGuard(
  policy: BrowserOriginPolicy,
): BeforeUpgradeHandler {
  return (request) => {
    const origin = request.headers.get("origin");
    // Native Android/SDK clients do not send Origin and remain unaffected.
    if (origin !== null && !policy.allows(origin)) {
      return new Response(null, { status: 403 });
    }
    return undefined;
  };
}
