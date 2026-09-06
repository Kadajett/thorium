import { readFileSync } from "node:fs";
import type { ExactGameRelease, GameHostRegistryPort } from "@thorium/game-host-api";
import {
  admittedRegistryFence,
  assertRegistryRelease,
  assertRegistrySuccess,
  registryActive,
  registryAdmissionBody,
  registryServiceToken,
} from "./core/registry-policy.js";
import { createRegistryRequest, type RegistryRequest } from "./registry-http.js";

export interface PlatformRegistryOptions {
  readonly endpoint: string;
  readonly serviceTokenFile: string;
  readonly fetch?: typeof fetch;
}
export interface PlatformRegistryPort {
  readonly scoped: (release: ExactGameRelease) => GameHostRegistryPort;
}

function scopedRegistry(release: ExactGameRelease, request: RegistryRequest): GameHostRegistryPort {
  return {
    admit: async (admission, roomInstanceId) => {
      const fence = admittedRegistryFence(release, admission, roomInstanceId);
      assertRegistrySuccess(await request("admit", registryAdmissionBody(fence, admission)));
      return fence;
    },
    isActive: async (fence) => {
      assertRegistryRelease(release, fence.release);
      return registryActive(await request("fence", fence));
    },
    finish: async (fence, reason) => {
      assertRegistryRelease(release, fence.release);
      assertRegistrySuccess(await request("finish", { ...fence, reason }));
    },
  };
}

/** File/HTTP effects are owned here; scope and response policy are pure. */
export function createPlatformRegistryClient(
  options: PlatformRegistryOptions,
): PlatformRegistryPort {
  const request = createRegistryRequest({
    endpoint: options.endpoint,
    serviceToken: registryServiceToken(readFileSync(options.serviceTokenFile, "utf8")),
    fetch: options.fetch ?? fetch,
  });
  return { scoped: (release) => scopedRegistry(Object.freeze({ ...release }), request) };
}

/** Compatibility constructor delegates to the factory without duplicating policy. */
export class PlatformRegistryClient implements PlatformRegistryPort {
  readonly #port: PlatformRegistryPort;
  constructor(options: PlatformRegistryOptions) {
    this.#port = createPlatformRegistryClient(options);
  }
  scoped(release: ExactGameRelease): GameHostRegistryPort {
    return this.#port.scoped(release);
  }
}
