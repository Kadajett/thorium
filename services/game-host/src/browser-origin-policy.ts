import { matchMaker, type BeforeUpgradeHandler } from "@colyseus/core";

const ALLOWED_HEADERS = "Authorization, Content-Type";
const ALLOWED_METHODS = "GET, HEAD, POST, OPTIONS";

export interface BrowserOriginPolicy {
  readonly allows: (origin: string) => boolean;
  readonly headers: (origin: string | null) => Readonly<Record<string, string>>;
}

export function createBrowserOriginPolicy(origins: readonly string[]): BrowserOriginPolicy {
  const allowed = new Set(origins);
  return {
    allows: (origin) => allowed.has(origin),
    headers: (origin) => origin !== null && allowed.has(origin)
      ? {
          Vary: "Origin",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": ALLOWED_HEADERS,
          "Access-Control-Allow-Methods": ALLOWED_METHODS,
          "Access-Control-Max-Age": "600",
        }
      : { Vary: "Origin" },
  };
}

export function configureColyseusCors(policy: BrowserOriginPolicy): void {
  const defaults = matchMaker.controller.DEFAULT_CORS_HEADERS as Record<string, string>;
  for (const key of Object.keys(defaults)) delete defaults[key];
  matchMaker.controller.getCorsHeaders = (headers) => ({ ...policy.headers(headers.get("origin")) });
}

export function createUpgradeGuard(
  policy: BrowserOriginPolicy,
  basePath: string,
): BeforeUpgradeHandler {
  return (request) => {
    const origin = request.headers.get("origin");
    const path = new URL(request.url).pathname;
    if (!path.startsWith(`${basePath}/`) || (origin !== null && !policy.allows(origin))) {
      return new Response(null, { status: 403 });
    }
    return undefined;
  };
}
