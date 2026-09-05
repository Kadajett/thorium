import { createHash } from "node:crypto";
import type { InMemoryPackageArtifact } from "../src/adapters/in-memory-package-artifact-store.js";
import type { GamePackageFile, GameRelease } from "../src/domain/game-package.js";

export const TEST_GAME_ARTIFACT_KEY = {
  packageId: "dev.yougotserved.platform-fixture",
  version: "1.2.3",
  fileName: "dev.yougotserved.platform-fixture-1.2.3.zip",
} as const;

const TEST_RUNTIME_FILES = [
  {
    path: "companion/index.html",
    bytes: Buffer.from("<!doctype html><button id=control>Fixture control</button>\n"),
  },
  {
    path: "dist/game.js",
    bytes: Buffer.from(
      "globalThis.thoriumFixture={start(){return 'deterministic-platform-test-game'}};\n",
    ),
  },
  {
    path: "main/index.html",
    bytes: Buffer.from("<!doctype html><main id=game>Platform fixture</main>\n"),
  },
] as const;

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Test fixture JSON must contain finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === "object") {
    const normalized: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) normalized[key] = normalizeJson(child);
    }
    return normalized;
  }
  throw new TypeError(`Test fixture JSON cannot contain ${typeof value}`);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** Creates the small, deterministic, uncompressed ZIP used only by platform tests. */
function createStoredZip(entries: readonly { readonly path: string; readonly bytes: Uint8Array }[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const bytes = Buffer.from(entry.bytes);
    const checksum = crc32(bytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x0403_4b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(bytes.byteLength, 18);
    localHeader.writeUInt32LE(bytes.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    const localRecord = Buffer.concat([localHeader, name, bytes]);
    localRecords.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x0201_4b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(bytes.byteLength, 20);
    centralHeader.writeUInt32LE(bytes.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(Buffer.concat([centralHeader, name]));
    localOffset += localRecord.byteLength;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x0605_4b50, 0);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.byteLength, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

const manifest = {
  schema: 1,
  packageId: TEST_GAME_ARTIFACT_KEY.packageId,
  version: TEST_GAME_ARTIFACT_KEY.version,
  displayName: "Platform Fixture",
  summary: "A deterministic package used by platform tests.",
  description: "Exercises catalog, package delivery, and session behavior without a published game artifact.",
  runtime: {
    kind: "web-v1",
    sdkCompatibility: "^0.1.0",
    entrypoints: {
      main: { path: "main/index.html", purpose: "primary-gameplay" },
      companion: { path: "companion/index.html", purpose: "companion-controls" },
    },
    files: TEST_RUNTIME_FILES.map((file) => file.path),
  },
  displays: {
    requiredSurfaces: ["main", "companion"],
    supportsSingleSurfaceFallback: false,
    main: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
    companion: { logicalWidth: 960, logicalHeight: 540, maximumDevicePixelRatio: 2 },
  },
  players: {
    minSlots: 2,
    maxSlots: 4,
    maxLocalSlots: 2,
    sameAccountMultipleSlots: true,
  },
  multiplayer: {
    online: true,
    roomName: "game_session",
    protocol: "thorium-game-channel-v1",
  },
  controls: [{ id: "fixture-control", label: "Fixture control", kind: "button" }],
  capabilities: ["same-device-peer", "colyseus-session"],
  budgets: {
    maxPackageBytes: 1_048_576,
    maxFileCount: 8,
    maxLocalPeerMessageBytes: 4_096,
  },
} as const;

const manifestBytes = Buffer.from(canonicalJson(manifest));
const packageFiles: readonly GamePackageFile[] = TEST_RUNTIME_FILES.map((file) => ({
  path: file.path,
  sha256: sha256(file.bytes),
  size: file.bytes.byteLength,
}));
export const TEST_GAME_ARCHIVE_BYTES = createStoredZip([
  ...TEST_RUNTIME_FILES,
  { path: "thorium.json", bytes: manifestBytes },
]);

const manifestSha256 = sha256(manifestBytes);
const archiveSha256 = sha256(TEST_GAME_ARCHIVE_BYTES);
export const TEST_GAME_DEPLOY_DESCRIPTOR = {
  descriptorSchema: 1,
  bundle: {
    fileName: TEST_GAME_ARTIFACT_KEY.fileName,
    sha256: archiveSha256,
    sizeBytes: TEST_GAME_ARCHIVE_BYTES.byteLength,
  },
  game: {
    packageId: manifest.packageId,
    version: manifest.version,
    displayName: manifest.displayName,
  },
  manifestSha256,
  execution: {
    kind: manifest.runtime.kind,
    main: manifest.runtime.entrypoints.main.path,
    companion: manifest.runtime.entrypoints.companion.path,
    files: packageFiles,
  },
  capabilities: [...manifest.capabilities].sort(),
  deployable: true,
} as const;
const contentDigest = sha256(canonicalJson(TEST_GAME_DEPLOY_DESCRIPTOR));

function publicPackageUrl(publicBaseUrl: string): string {
  const base = publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`;
  return new URL(
    `v1/packages/${TEST_GAME_ARTIFACT_KEY.packageId}/${TEST_GAME_ARTIFACT_KEY.version}/${TEST_GAME_ARTIFACT_KEY.fileName}`,
    base,
  ).toString();
}

export function createTestGamePackageFixture(publicBaseUrl: string): {
  readonly release: GameRelease;
  readonly artifact: InMemoryPackageArtifact;
  readonly descriptor: typeof TEST_GAME_DEPLOY_DESCRIPTOR;
} {
  return {
    release: {
      ...manifest,
      tags: ["test-fixture"],
      publishedAt: "2026-01-02T03:04:05.000Z",
      contentDigest,
      bundle: {
        fileName: TEST_GAME_ARTIFACT_KEY.fileName,
        url: publicPackageUrl(publicBaseUrl),
        sha256: archiveSha256,
        sizeBytes: TEST_GAME_ARCHIVE_BYTES.byteLength,
        manifestSha256,
        files: packageFiles,
      },
    },
    artifact: {
      key: TEST_GAME_ARTIFACT_KEY,
      bytes: TEST_GAME_ARCHIVE_BYTES,
    },
    descriptor: TEST_GAME_DEPLOY_DESCRIPTOR,
  };
}

export function createRequiresOnlineTestGamePackageFixture(publicBaseUrl: string) {
  const onlineManifest = {
    ...manifest,
    multiplayer: {
      ...manifest.multiplayer,
      requiresOnline: true,
    },
  } as const;
  const onlineManifestBytes = Buffer.from(canonicalJson(onlineManifest));
  const archiveBytes = createStoredZip([
    ...TEST_RUNTIME_FILES,
    { path: "thorium.json", bytes: onlineManifestBytes },
  ]);
  const descriptor = {
    ...TEST_GAME_DEPLOY_DESCRIPTOR,
    manifestSha256: sha256(onlineManifestBytes),
    bundle: {
      ...TEST_GAME_DEPLOY_DESCRIPTOR.bundle,
      sha256: sha256(archiveBytes),
      sizeBytes: archiveBytes.byteLength,
    },
  } as const;
  const release: GameRelease = {
    ...onlineManifest,
    tags: ["test-fixture"],
    publishedAt: "2026-01-02T03:04:05.000Z",
    contentDigest: sha256(canonicalJson(descriptor)),
    bundle: {
      fileName: descriptor.bundle.fileName,
      url: publicPackageUrl(publicBaseUrl),
      sha256: descriptor.bundle.sha256,
      sizeBytes: descriptor.bundle.sizeBytes,
      manifestSha256: descriptor.manifestSha256,
      files: packageFiles,
    },
  };
  return {
    release,
    descriptor,
    artifact: {
      key: TEST_GAME_ARTIFACT_KEY,
      bytes: archiveBytes,
    },
  };
}

export function createTestGames(publicBaseUrl: string): readonly GameRelease[] {
  return [createTestGamePackageFixture(publicBaseUrl).release];
}
