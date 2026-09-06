import { assertRegistryResponseSize } from "./core/registry-policy.js";

export type RegistryOperation = "admit" | "fence" | "finish";
export type RegistryRequest = (operation: RegistryOperation, body: unknown) => Promise<unknown>;
export interface RegistryHttpOptions {
  readonly endpoint: string;
  readonly serviceToken: string;
  readonly fetch: typeof fetch;
}

async function boundedRegistryText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("invalid_platform_registry_response");
  try {
    return await registryChunks(reader);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function registryChunks(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) return Buffer.concat(chunks, size).toString("utf8");
    size += next.value.byteLength;
    assertRegistryResponseSize(size);
    chunks.push(next.value);
  }
}

async function registryResponse(
  response: Response,
  operation: RegistryOperation,
): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`platform_registry_${operation}_rejected:${String(response.status)}`);
  }
  const raw = await boundedRegistryText(response);
  const result: unknown = JSON.parse(raw);
  return result;
}

export function createRegistryRequest(options: RegistryHttpOptions): RegistryRequest {
  const endpoint = options.endpoint.replace(/\/+$/, "");
  return async (operation, body) => {
    const response = await options.fetch(`${endpoint}/v1/game-host/${operation}`, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${options.serviceToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return registryResponse(response, operation);
  };
}
