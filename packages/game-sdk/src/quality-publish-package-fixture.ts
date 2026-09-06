import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
export const TOKEN = `thp_${"A".repeat(43)}`;
export const PLATFORM_URL = "https://platform.example";
const temporaryDirectories: string[] = [];
export const validManifest = {
  schema: 1,
  packageId: "dev.yougotserved.publish-test",
  version: "1.2.3",
  displayName: "Publish Test",
  summary: "A tiny publisher test package.",
  description: "Exercises the public publisher client with real package files.",
  runtime: {
    kind: "web-v1",
    sdkCompatibility: "^0.1.0",
    entrypoints: {
      main: { path: "main/index.html", purpose: "primary-gameplay" },
      companion: { path: "companion/index.html", purpose: "companion-controls" },
    },
    files: ["game.js", "main/index.html", "companion/index.html"],
  },
  displays: {
    requiredSurfaces: ["main", "companion"],
    supportsSingleSurfaceFallback: false,
    main: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
    companion: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
  },
  players: {
    minSlots: 1,
    maxSlots: 2,
    maxLocalSlots: 2,
    sameAccountMultipleSlots: true,
  },
  multiplayer: {
    online: false,
    roomName: "game_session",
    protocol: "thorium-game-channel-v1",
  },
  controls: [{ id: "confirm", label: "Confirm", kind: "button" }],
  capabilities: ["same-device-peer"],
  budgets: {
    maxPackageBytes: 1_048_576,
    maxFileCount: 8,
    maxLocalPeerMessageBytes: 4_096,
  },
} as const;

export async function cleanupPublishFixtures(): Promise<void> {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}
interface FixtureOptions {
  readonly requiresOnline?: boolean;
  readonly packageId?: string;
}
export interface PublishFixture {
  readonly root: string;
  readonly manifestPath: string;
}
function fixtureManifest(options: FixtureOptions) {
  const requiresOnline = options.requiresOnline === true;
  return {
    ...validManifest,
    ...(options.packageId === undefined ? {} : { packageId: options.packageId }),
    multiplayer: requiresOnline
      ? { ...validManifest.multiplayer, online: true, requiresOnline: true }
      : validManifest.multiplayer,
    capabilities: requiresOnline
      ? ["same-device-peer", "colyseus-session"]
      : validManifest.capabilities,
  };
}
async function writePackageFiles(root: string): Promise<void> {
  await Promise.all(
    ["main", "companion"].map((name) => mkdir(path.join(root, name), { recursive: true })),
  );
  await Promise.all([
    writeFile(path.join(root, "main/index.html"), "<!doctype html><main>Main</main>\n"),
    writeFile(path.join(root, "companion/index.html"), "<!doctype html><button>Confirm</button>\n"),
    writeFile(path.join(root, "game.js"), "globalThis.publishTest = true;\n"),
  ]);
}
export async function createFixture(options: FixtureOptions = {}): Promise<PublishFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "thorium-publish-test-"));
  temporaryDirectories.push(root);
  await writePackageFiles(root);
  const manifestPath = path.join(root, "thorium.json");
  await writeFile(manifestPath, JSON.stringify(fixtureManifest(options)));
  return { root, manifestPath };
}
