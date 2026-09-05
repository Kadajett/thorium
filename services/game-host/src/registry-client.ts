import { readFileSync } from "node:fs";
import { z } from "zod";
import type {
  ExactGameRelease,
  GameHostRegistryPort,
  GameSessionFinishReason,
  RegistryFence,
  SurfaceAdmission,
} from "@thorium/game-host-api";

const RegistryResult = z.strictObject({ ok: z.literal(true) }).passthrough();
const FenceResult = z.strictObject({ active: z.boolean() });

function sameRelease(left: ExactGameRelease, right: ExactGameRelease): boolean {
  return left.packageId === right.packageId && left.version === right.version
    && left.contentDigest === right.contentDigest;
}

export class PlatformRegistryClient {
  readonly #endpoint: string;
  readonly #serviceToken: string;
  readonly #fetch: typeof fetch;

  constructor(options: {
    readonly endpoint: string;
    readonly serviceTokenFile: string;
    readonly fetch?: typeof fetch;
  }) {
    this.#endpoint = options.endpoint.replace(/\/+$/, "");
    this.#serviceToken = readFileSync(options.serviceTokenFile, "utf8").trim();
    if (
      this.#serviceToken.length < 32 || this.#serviceToken.length > 4_096
      || /\s/.test(this.#serviceToken)
    ) throw new Error("invalid_game_host_service_token");
    this.#fetch = options.fetch ?? fetch;
  }

  scoped(release: ExactGameRelease): GameHostRegistryPort {
    return {
      admit: async (admission, roomInstanceId) => {
        if (!sameRelease(admission.release, release)) throw new Error("registry_release_mismatch");
        const fence: RegistryFence = {
          gameSessionId: admission.gameSessionId,
          generation: admission.generation,
          roomInstanceId,
          release,
        };
        await this.#request("admit", {
          ...fence,
          capabilityId: admission.capabilityId,
          surfaceId: admission.surfaceId,
          role: admission.role,
          playerSlots: admission.playerSlots,
        }, RegistryResult);
        return fence;
      },
      isActive: async (fence) => {
        if (!sameRelease(fence.release, release)) throw new Error("registry_release_mismatch");
        return (await this.#request("fence", fence, FenceResult)).active;
      },
      finish: async (fence, reason) => {
        if (!sameRelease(fence.release, release)) throw new Error("registry_release_mismatch");
        await this.#request("finish", { ...fence, reason }, RegistryResult);
      },
    };
  }

  async #request<T>(
    operation: "admit" | "fence" | "finish",
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await this.#fetch(`${this.#endpoint}/v1/game-host/${operation}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#serviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`platform_registry_${operation}_rejected:${response.status}`);
    if (Buffer.byteLength(raw) > 16_384) throw new Error("platform_registry_response_too_large");
    return schema.parse(JSON.parse(raw) as unknown);
  }
}
