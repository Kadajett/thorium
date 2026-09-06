import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExactGameRelease, SurfaceAdmission } from "@thorium/game-host-api";
import { PlatformRegistryClient } from "../src/registry-client.js";

const directories: string[] = [];
export const registryRelease: ExactGameRelease = Object.freeze({
  packageId: "dev.yougotserved.fixture",
  version: "0.1.0",
  contentDigest: "a".repeat(64),
});
export const registryAdmission: SurfaceAdmission = {
  accountScope: "opaque-scope",
  capabilityId: "capability-1",
  expiresAtEpochMs: 1000,
  gameSessionId: "session-1",
  generation: 2,
  release: registryRelease,
  surfaceId: "main",
  role: "main",
  playerSlots: [0],
};
export const registryFence = {
  gameSessionId: registryAdmission.gameSessionId,
  generation: registryAdmission.generation,
  roomInstanceId: "room-1",
  release: registryRelease,
};

export async function registryFixture(
  response: () => Response,
  token = "test-registry-token-".repeat(3),
) {
  const root = await mkdtemp(join(tmpdir(), "thorium-registry-test-"));
  directories.push(root);
  const serviceTokenFile = join(root, "token");
  await writeFile(serviceTokenFile, token);
  const requests: Request[] = [];
  const transport: typeof fetch = (input, init) => {
    requests.push(new Request(input, init));
    return Promise.resolve(response());
  };
  const client = new PlatformRegistryClient({
    endpoint: "https://platform.invalid/",
    serviceTokenFile,
    fetch: transport,
  });
  return { client, requests };
}

export async function cleanupRegistryFixtures(): Promise<void> {
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true });
}

export function oversizedRegistryStream() {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        if (pulls <= 6) controller.enqueue(new Uint8Array(8192));
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(stream), pulls: () => pulls, cancelled: () => cancelled };
}

export function registryJsonBytes(size: number): Response {
  const prefix = '{"ok":true,"padding":"';
  const suffix = '"}';
  return new Response(prefix + "x".repeat(size - prefix.length - suffix.length) + suffix);
}
