import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createSampleGames } from "../src/catalog/sample-games.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface TapRaceManifest {
  readonly schema: 1;
  readonly packageId: string;
  readonly version: string;
  readonly displayName: string;
  readonly summary: string;
  readonly description: string;
  readonly runtime: {
    readonly kind: "web-v1";
    readonly sdkCompatibility: string;
    readonly entrypoints: {
      readonly main: { readonly path: string; readonly purpose: "primary-gameplay" };
      readonly companion: { readonly path: string; readonly purpose: "companion-controls" };
    };
    readonly files: readonly string[];
  };
  readonly displays: {
    readonly requiredSurfaces: readonly ("main" | "companion")[];
    readonly supportsSingleSurfaceFallback: boolean;
    readonly main: { readonly logicalWidth: number; readonly logicalHeight: number; readonly maximumDevicePixelRatio: number };
    readonly companion: { readonly logicalWidth: number; readonly logicalHeight: number; readonly maximumDevicePixelRatio: number };
  };
  readonly players: {
    readonly minSlots: number;
    readonly maxSlots: number;
    readonly maxLocalSlots: number;
    readonly sameAccountMultipleSlots: boolean;
  };
  readonly multiplayer: {
    readonly online: boolean;
    readonly roomName: "game_session";
    readonly protocol: "thorium-game-channel-v1";
  };
  readonly controls: readonly { readonly id: string; readonly label: string; readonly kind: "button" | "axis" }[];
  readonly capabilities: readonly ("same-device-peer" | "colyseus-session")[];
  readonly budgets: {
    readonly maxPackageBytes: number;
    readonly maxFileCount: number;
    readonly maxLocalPeerMessageBytes: number;
  };
}

interface TapRaceDescriptor {
  readonly descriptorSchema: 1;
  readonly bundle: {
    readonly fileName: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  };
  readonly game: {
    readonly packageId: string;
    readonly version: string;
    readonly displayName: string;
  };
  readonly manifestSha256: string;
  readonly execution: {
    readonly kind: "web-v1";
    readonly main: string;
    readonly companion: string;
    readonly files: readonly { readonly path: string; readonly sha256: string; readonly size: number }[];
  };
  readonly capabilities: readonly string[];
  readonly deployable: true;
}

function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = normalize(child);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
}

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, "utf8")) as T;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumRecordSize = 22;
  const maximumCommentSize = 65_535;
  const earliestOffset = Math.max(0, archive.length - minimumRecordSize - maximumCommentSize);
  for (let offset = archive.length - minimumRecordSize; offset >= earliestOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x0605_4b50) return offset;
  }
  throw new Error("ZIP end-of-central-directory record is missing");
}

/** Reads the small, non-ZIP64 deterministic package emitted by the SDK without a server dependency. */
function readZipEntries(archive: Buffer): ReadonlyMap<string, Buffer> {
  const endOffset = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  let centralOffset = archive.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x0201_4b50) {
      throw new Error(`Invalid ZIP central-directory entry ${index}`);
    }
    const compressionMethod = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");

    if (archive.readUInt32LE(localOffset) !== 0x0403_4b50) {
      throw new Error(`Invalid ZIP local header for ${name}`);
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const bytes = compressionMethod === 0
      ? Buffer.from(compressed)
      : compressionMethod === 8
        ? inflateRawSync(compressed)
        : undefined;
    if (bytes === undefined) throw new Error(`Unsupported ZIP compression method ${compressionMethod}`);
    if (bytes.byteLength !== uncompressedSize) throw new Error(`Invalid uncompressed size for ${name}`);
    if (entries.has(name)) throw new Error(`Duplicate ZIP entry ${name}`);
    entries.set(name, bytes);

    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

describe("Tap Race catalog package drift", () => {
  it("keeps the catalog release aligned with the canonical manifest and deploy descriptor", async () => {
    const packageRoot = new URL(
      "../../../games/tap-race/android-assets/games/dev.yougotserved.tap-race/",
      import.meta.url,
    );
    const manifest = await readJson<TapRaceManifest>(new URL("thorium.json", packageRoot));
    const descriptor = await readJson<TapRaceDescriptor>(
      new URL("../../../games/tap-race/deploy-descriptor.json", import.meta.url),
    );
    const release = createSampleGames("https://platform.test")[0];
    if (release === undefined) throw new Error("Tap Race catalog release is missing");

    const {
      tags: _tags,
      publishedAt: _publishedAt,
      contentDigest: _contentDigest,
      bundle: _bundle,
      ...releaseManifest
    } = release;
    expect(releaseManifest).toEqual(manifest);

    expect(descriptor.game).toEqual({
      packageId: manifest.packageId,
      version: manifest.version,
      displayName: manifest.displayName,
    });
    expect(descriptor.manifestSha256).toBe(sha256(JSON.stringify(normalize(manifest))));
    expect(descriptor.execution).toMatchObject({
      kind: manifest.runtime.kind,
      main: manifest.runtime.entrypoints.main.path,
      companion: manifest.runtime.entrypoints.companion.path,
    });
    expect(descriptor.capabilities).toEqual([...manifest.capabilities].sort());

    expect(release.contentDigest).toBe(sha256(JSON.stringify(normalize(descriptor))));
    expect(release.bundle).toMatchObject({
      ...descriptor.bundle,
      manifestSha256: descriptor.manifestSha256,
      files: descriptor.execution.files,
    });
    expect(new URL(release.bundle.url).pathname.endsWith(`/${descriptor.bundle.fileName}`)).toBe(true);

    const archive = await readFile(
      new URL(`../../../games/tap-race/artifacts/${descriptor.bundle.fileName}`, import.meta.url),
    );
    expect(archive.byteLength).toBe(descriptor.bundle.sizeBytes);
    expect(sha256(archive)).toBe(descriptor.bundle.sha256);

    const zipEntries = readZipEntries(archive);
    expect([...zipEntries.keys()]).toEqual([
      ...descriptor.execution.files.map((file) => file.path),
      "thorium.json",
    ]);
    for (const file of descriptor.execution.files) {
      const entry = zipEntries.get(file.path);
      expect(entry, `${file.path} ZIP entry`).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.byteLength, `${file.path} size`).toBe(file.size);
      expect(sha256(entry), `${file.path} digest`).toBe(file.sha256);
    }

    const archivedManifest = zipEntries.get("thorium.json");
    expect(archivedManifest, "thorium.json ZIP entry").toBeDefined();
    if (archivedManifest === undefined) return;
    expect(JSON.parse(archivedManifest.toString("utf8"))).toEqual(manifest);
    expect(sha256(JSON.stringify(normalize(JSON.parse(archivedManifest.toString("utf8"))))))
      .toBe(descriptor.manifestSha256);
  });
});
