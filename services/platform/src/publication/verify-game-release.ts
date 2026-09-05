import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { z } from "zod";
import type { GameRelease } from "../domain/game-package.js";

const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const PACKAGE_ID = z.string().max(128).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
const VERSION = z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const PACKAGE_PATH = z.string().max(1_024).refine((value) => {
  const segments = value.split("/");
  return value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !/[\0-\x1f]/.test(value)
    && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}, "must be a safe relative package path");
const SurfaceRole = z.enum(["main", "companion"]);
const Capability = z.enum(["same-device-peer", "colyseus-session"]);
const ControlId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const ControllerButtonInput = z.enum([
  "south",
  "east",
  "west",
  "north",
  "dpad-up",
  "dpad-down",
  "dpad-left",
  "dpad-right",
  "left-shoulder",
  "right-shoulder",
  "left-stick",
  "right-stick",
  "start",
  "select",
]);
const ControllerAxisInput = z.enum([
  "left-x",
  "left-y",
  "right-x",
  "right-y",
  "left-trigger",
  "right-trigger",
]);

const ControllerBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("button"),
    input: ControllerButtonInput,
    control: ControlId,
  }),
  z.strictObject({
    kind: z.literal("axis"),
    input: ControllerAxisInput,
    control: ControlId,
  }),
  z.strictObject({
    kind: z.literal("axis-button"),
    input: ControllerAxisInput,
    direction: z.union([z.literal(-1), z.literal(1)]),
    control: ControlId,
  }),
]);

const ControllerBindingsSchema = z.strictObject({
  schema: z.literal(1),
  bindings: z.array(ControllerBindingSchema).min(1).max(64),
});

const ScreenSchema = z.strictObject({
  logicalWidth: z.number().int().min(160).max(4_096),
  logicalHeight: z.number().int().min(160).max(4_096),
  maximumDevicePixelRatio: z.number().min(1).max(3),
});

const ManifestSchema = z.strictObject({
  $schema: z.string().optional(),
  schema: z.literal(1),
  packageId: PACKAGE_ID,
  version: VERSION,
  displayName: z.string().trim().min(1).max(80),
  summary: z.string().min(1).max(140),
  description: z.string().min(1).max(1_000),
  runtime: z.strictObject({
    kind: z.literal("web-v1"),
    sdkCompatibility: z.string().regex(/^\^?\d+\.\d+\.\d+$/),
    entrypoints: z.strictObject({
      main: z.strictObject({
        path: PACKAGE_PATH,
        purpose: z.literal("primary-gameplay"),
      }),
      companion: z.strictObject({
        path: PACKAGE_PATH,
        purpose: z.literal("companion-controls"),
      }),
    }),
    files: z.array(PACKAGE_PATH).min(1).max(2_048),
  }),
  displays: z.strictObject({
    requiredSurfaces: z.array(SurfaceRole).min(1).max(2),
    supportsSingleSurfaceFallback: z.boolean(),
    main: ScreenSchema,
    companion: ScreenSchema,
  }),
  players: z.strictObject({
    minSlots: z.number().int().min(1).max(16),
    maxSlots: z.number().int().min(1).max(16),
    maxLocalSlots: z.number().int().min(1).max(16),
    sameAccountMultipleSlots: z.boolean(),
    defaultLocalSeatPlan: z.strictObject({
      main: z.array(z.number().int().min(0).max(15)).max(16),
      companion: z.array(z.number().int().min(0).max(15)).max(16),
    }).optional(),
  }),
  multiplayer: z.strictObject({
    online: z.boolean(),
    requiresOnline: z.boolean().optional(),
    roomName: z.literal("game_session"),
    protocol: z.literal("thorium-game-channel-v1"),
  }),
  controls: z.array(z.strictObject({
    id: ControlId,
    label: z.string().min(1).max(80),
    kind: z.enum(["button", "axis"]),
  })).min(1).max(128),
  controllerBindings: ControllerBindingsSchema.optional(),
  capabilities: z.array(Capability).max(2),
  budgets: z.strictObject({
    maxPackageBytes: z.number().int().min(1).max(134_217_728),
    maxFileCount: z.number().int().min(1).max(2_048),
    maxLocalPeerMessageBytes: z.number().int().min(1).max(262_144),
  }),
}).superRefine((manifest, context) => {
  const uniqueFiles = new Set(manifest.runtime.files);
  if (uniqueFiles.size !== manifest.runtime.files.length) {
    context.addIssue({ code: "custom", path: ["runtime", "files"], message: "files must be unique" });
  }
  if (uniqueFiles.has("thorium.json")) {
    context.addIssue({ code: "custom", path: ["runtime", "files"], message: "thorium.json is reserved" });
  }
  for (const role of ["main", "companion"] as const) {
    if (!uniqueFiles.has(manifest.runtime.entrypoints[role].path)) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "entrypoints", role, "path"],
        message: "entrypoint must be declared in runtime.files",
      });
    }
  }
  if (new Set(manifest.displays.requiredSurfaces).size !== manifest.displays.requiredSurfaces.length) {
    context.addIssue({ code: "custom", path: ["displays", "requiredSurfaces"], message: "roles must be unique" });
  }
  if (manifest.players.minSlots > manifest.players.maxSlots) {
    context.addIssue({ code: "custom", path: ["players"], message: "minSlots must not exceed maxSlots" });
  }
  if (manifest.players.maxLocalSlots > manifest.players.maxSlots) {
    context.addIssue({ code: "custom", path: ["players"], message: "maxLocalSlots must not exceed maxSlots" });
  }
  if (manifest.players.maxLocalSlots > 1 && !manifest.players.sameAccountMultipleSlots) {
    context.addIssue({ code: "custom", path: ["players"], message: "multiple local slots require sameAccountMultipleSlots" });
  }
  const seatPlan = manifest.players.defaultLocalSeatPlan;
  if (seatPlan !== undefined) {
    const slots = [...seatPlan.main, ...seatPlan.companion];
    if (new Set(slots).size !== slots.length || slots.length < manifest.players.minSlots || slots.length > manifest.players.maxLocalSlots) {
      context.addIssue({ code: "custom", path: ["players", "defaultLocalSeatPlan"], message: "seat plan must contain unique slots within local player limits" });
    }
  }
  if (manifest.multiplayer.requiresOnline && !manifest.multiplayer.online) {
    context.addIssue({ code: "custom", path: ["multiplayer", "requiresOnline"], message: "requiresOnline requires online support" });
  }
  if (new Set(manifest.controls.map((control) => control.id)).size !== manifest.controls.length) {
    context.addIssue({ code: "custom", path: ["controls"], message: "control ids must be unique" });
  }
  const controllerBindings = manifest.controllerBindings;
  if (controllerBindings !== undefined) {
    const controlsById = new Map(manifest.controls.map((control) => [control.id, control]));
    const sourceKeys = new Set<string>();
    const axisModes = new Map<string, "axis" | "axis-button">();
    for (const [index, binding] of controllerBindings.bindings.entries()) {
      const sourceKey = binding.kind === "axis-button"
        ? `${binding.kind}\0${binding.input}\0${binding.direction}`
        : `${binding.kind}\0${binding.input}`;
      if (sourceKeys.has(sourceKey)) {
        context.addIssue({
          code: "custom",
          path: ["controllerBindings", "bindings", index],
          message: "controller binding sources must be unique",
        });
      }
      sourceKeys.add(sourceKey);

      if (binding.kind !== "button") {
        const priorMode = axisModes.get(binding.input);
        if (priorMode !== undefined && priorMode !== binding.kind) {
          context.addIssue({
            code: "custom",
            path: ["controllerBindings", "bindings", index, "input"],
            message: "an axis input cannot mix axis and axis-button bindings",
          });
        } else {
          axisModes.set(binding.input, binding.kind);
        }
      }

      const control = controlsById.get(binding.control);
      const expectedKind = binding.kind === "axis" ? "axis" : "button";
      if (control === undefined) {
        context.addIssue({
          code: "custom",
          path: ["controllerBindings", "bindings", index, "control"],
          message: "controller binding must reference a declared control",
        });
      } else if (control.kind !== expectedKind) {
        context.addIssue({
          code: "custom",
          path: ["controllerBindings", "bindings", index, "control"],
          message: `${binding.kind} binding must reference a ${expectedKind} control`,
        });
      }
    }
  }
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
    context.addIssue({ code: "custom", path: ["capabilities"], message: "capabilities must be unique" });
  }
  if (manifest.multiplayer.online && !manifest.capabilities.includes("colyseus-session")) {
    context.addIssue({ code: "custom", path: ["capabilities"], message: "online games require colyseus-session" });
  }
  if (manifest.runtime.files.length + 1 > manifest.budgets.maxFileCount) {
    context.addIssue({ code: "custom", path: ["budgets", "maxFileCount"], message: "file budget is too small" });
  }
});

const DescriptorFileSchema = z.strictObject({
  path: PACKAGE_PATH,
  sha256: SHA256,
  size: z.number().int().min(0).max(134_217_728),
});

const DescriptorSchema = z.strictObject({
  descriptorSchema: z.literal(1),
  game: z.strictObject({
    packageId: PACKAGE_ID,
    version: VERSION,
    displayName: z.string().trim().min(1).max(80),
  }),
  manifestSha256: SHA256,
  execution: z.strictObject({
    kind: z.literal("web-v1"),
    main: PACKAGE_PATH,
    companion: PACKAGE_PATH,
    files: z.array(DescriptorFileSchema).min(1).max(2_048),
  }),
  capabilities: z.array(Capability).max(2),
  bundle: z.strictObject({
    fileName: z.string().max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/),
    sha256: SHA256,
    sizeBytes: z.number().int().min(1).max(134_217_728),
  }),
  deployable: z.literal(true),
}).superRefine((descriptor, context) => {
  const filePaths = descriptor.execution.files.map((file) => file.path);
  if (new Set(filePaths).size !== filePaths.length) {
    context.addIssue({ code: "custom", path: ["execution", "files"], message: "file paths must be unique" });
  }
  if (filePaths.some((path, index) => index > 0 && path <= (filePaths[index - 1] ?? ""))) {
    context.addIssue({ code: "custom", path: ["execution", "files"], message: "files must be sorted" });
  }
  const capabilities = [...descriptor.capabilities].sort();
  if (capabilities.some((capability, index) => capability !== descriptor.capabilities[index])) {
    context.addIssue({ code: "custom", path: ["capabilities"], message: "capabilities must be sorted" });
  }
});

export type VerifiedDeployDescriptor = z.infer<typeof DescriptorSchema>;
type VerifiedManifest = z.infer<typeof ManifestSchema>;

const StoredReleaseSchema = ManifestSchema.safeExtend({
  tags: z.array(z.string().min(1).max(64)).max(32),
  publishedAt: z.string().datetime({ offset: true }),
  contentDigest: SHA256,
  bundle: z.strictObject({
    fileName: z.string().max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/),
    url: z.url(),
    sha256: SHA256,
    sizeBytes: z.number().int().min(1).max(134_217_728),
    manifestSha256: SHA256,
    files: z.array(DescriptorFileSchema).min(1).max(2_048),
  }),
});

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_canonical_json");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = normalize(child);
    }
    return output;
  }
  throw new Error("unsupported_canonical_json_value");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface ZipEntry {
  readonly name: string;
  readonly compression: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumSize = 22;
  const earliest = Math.max(0, archive.length - minimumSize - 65_535);
  for (let offset = archive.length - minimumSize; offset >= earliest; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x0605_4b50) return offset;
  }
  throw new Error("zip_end_record_missing");
}

function assertSafeEntryName(name: string): void {
  if (name === "thorium.json") return;
  if (!PACKAGE_PATH.safeParse(name).success || name.endsWith("/")) {
    throw new Error("unsafe_zip_entry_name");
  }
}

function readZip(archive: Uint8Array): ReadonlyMap<string, Uint8Array> {
  const bytes = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  const end = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(end + 4);
  const centralDisk = bytes.readUInt16LE(end + 6);
  const diskEntries = bytes.readUInt16LE(end + 8);
  const entryCount = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralStart = bytes.readUInt32LE(end + 16);
  const commentLength = bytes.readUInt16LE(end + 20);
  if (
    disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount
    || entryCount === 0xffff || centralSize === 0xffff_ffff || centralStart === 0xffff_ffff
    || entryCount > 2_048 || end + 22 + commentLength !== bytes.length
    || centralStart + centralSize !== end
  ) throw new Error("unsupported_zip_structure");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  let centralOffset = centralStart;
  for (let index = 0; index < entryCount; index += 1) {
    if (centralOffset + 46 > end || bytes.readUInt32LE(centralOffset) !== 0x0201_4b50) {
      throw new Error("invalid_zip_central_entry");
    }
    const flags = bytes.readUInt16LE(centralOffset + 8);
    const compression = bytes.readUInt16LE(centralOffset + 10);
    const compressedSize = bytes.readUInt32LE(centralOffset + 20);
    const uncompressedSize = bytes.readUInt32LE(centralOffset + 24);
    const nameLength = bytes.readUInt16LE(centralOffset + 28);
    const extraLength = bytes.readUInt16LE(centralOffset + 30);
    const entryCommentLength = bytes.readUInt16LE(centralOffset + 32);
    const diskStart = bytes.readUInt16LE(centralOffset + 34);
    const externalAttributes = bytes.readUInt32LE(centralOffset + 38);
    const localOffset = bytes.readUInt32LE(centralOffset + 42);
    const nextOffset = centralOffset + 46 + nameLength + extraLength + entryCommentLength;
    if (
      nextOffset > end || (flags & 1) !== 0 || ![0, 8].includes(compression)
      || diskStart !== 0 || compressedSize === 0xffff_ffff
      || uncompressedSize === 0xffff_ffff || localOffset === 0xffff_ffff
      || ((externalAttributes >>> 16) & 0o170000) === 0o120000
    ) throw new Error("unsupported_zip_entry");
    const name = decoder.decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLength));
    assertSafeEntryName(name);
    entries.push({ name, compression, compressedSize, uncompressedSize, localOffset });
    centralOffset = nextOffset;
  }
  if (centralOffset !== end) throw new Error("invalid_zip_central_size");

  const extracted = new Map<string, Uint8Array>();
  let totalSize = 0;
  for (const entry of entries) {
    if (extracted.has(entry.name) || entry.localOffset + 30 > centralStart) {
      throw new Error("invalid_or_duplicate_zip_entry");
    }
    if (bytes.readUInt32LE(entry.localOffset) !== 0x0403_4b50) {
      throw new Error("invalid_zip_local_entry");
    }
    const localFlags = bytes.readUInt16LE(entry.localOffset + 6);
    const localCompression = bytes.readUInt16LE(entry.localOffset + 8);
    const localNameLength = bytes.readUInt16LE(entry.localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(entry.localOffset + 28);
    const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if ((localFlags & 1) !== 0 || localCompression !== entry.compression || dataEnd > centralStart) {
      throw new Error("invalid_zip_local_entry");
    }
    const localName = decoder.decode(
      bytes.subarray(entry.localOffset + 30, entry.localOffset + 30 + localNameLength),
    );
    if (localName !== entry.name) throw new Error("zip_entry_name_mismatch");
    const compressed = bytes.subarray(dataStart, dataEnd);
    const value = entry.compression === 0
      ? Uint8Array.from(compressed)
      : inflateRawSync(compressed, { maxOutputLength: 134_217_728 });
    if (value.byteLength !== entry.uncompressedSize) throw new Error("zip_entry_size_mismatch");
    totalSize += value.byteLength;
    if (totalSize > 134_217_728) throw new Error("zip_uncompressed_size_exceeded");
    extracted.set(entry.name, value);
  }
  return extracted;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function verifyPublishedGameRelease(input: {
  readonly descriptor: unknown;
  readonly archive: { readonly fileName: string; readonly bytes: Uint8Array };
  readonly publicBaseUrl: string;
  readonly publishedAt: string;
}): { readonly descriptor: VerifiedDeployDescriptor; readonly release: GameRelease } {
  const descriptor = DescriptorSchema.parse(input.descriptor);
  if (
    input.archive.fileName !== descriptor.bundle.fileName
    || input.archive.bytes.byteLength !== descriptor.bundle.sizeBytes
    || sha256(input.archive.bytes) !== descriptor.bundle.sha256
  ) throw new Error("archive_envelope_mismatch");

  const entries = readZip(input.archive.bytes);
  const manifestBytes = entries.get("thorium.json");
  if (manifestBytes === undefined) throw new Error("manifest_missing_from_archive");
  const manifest = ManifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)));
  if (sha256(canonicalJson(manifest)) !== descriptor.manifestSha256) {
    throw new Error("manifest_digest_mismatch");
  }

  const descriptorPaths = descriptor.execution.files.map((file) => file.path);
  const expectedEntries = [...descriptorPaths, "thorium.json"].sort();
  if (!arraysEqual([...entries.keys()].sort(), expectedEntries)) throw new Error("archive_entries_mismatch");
  for (const file of descriptor.execution.files) {
    const value = entries.get(file.path);
    if (value === undefined || value.byteLength !== file.size || sha256(value) !== file.sha256) {
      throw new Error("archive_file_integrity_mismatch");
    }
  }

  if (
    manifest.packageId !== descriptor.game.packageId
    || manifest.version !== descriptor.game.version
    || manifest.displayName !== descriptor.game.displayName
    || manifest.runtime.kind !== descriptor.execution.kind
    || manifest.runtime.entrypoints.main.path !== descriptor.execution.main
    || manifest.runtime.entrypoints.companion.path !== descriptor.execution.companion
    || !arraysEqual([...manifest.runtime.files].sort(), descriptorPaths)
    || !arraysEqual([...manifest.capabilities].sort(), descriptor.capabilities)
  ) throw new Error("descriptor_manifest_mismatch");

  const base = new URL(input.publicBaseUrl.endsWith("/") ? input.publicBaseUrl : `${input.publicBaseUrl}/`);
  const bundleUrl = new URL(
    `v1/packages/${encodeURIComponent(manifest.packageId)}/${encodeURIComponent(manifest.version)}/${encodeURIComponent(descriptor.bundle.fileName)}`,
    base,
  ).toString();
  const { controllerBindings, ...manifestFields } = manifest;
  const release: GameRelease = {
    ...manifestFields,
    ...(controllerBindings === undefined ? {} : { controllerBindings }),
    players: {
      minSlots: manifest.players.minSlots,
      maxSlots: manifest.players.maxSlots,
      maxLocalSlots: manifest.players.maxLocalSlots,
      sameAccountMultipleSlots: manifest.players.sameAccountMultipleSlots,
      ...(manifest.players.defaultLocalSeatPlan === undefined ? {} : { defaultLocalSeatPlan: manifest.players.defaultLocalSeatPlan }),
    },
    multiplayer: {
      online: manifest.multiplayer.online,
      roomName: manifest.multiplayer.roomName,
      protocol: manifest.multiplayer.protocol,
      ...(manifest.multiplayer.requiresOnline === undefined ? {} : { requiresOnline: manifest.multiplayer.requiresOnline }),
    },
    tags: [],
    publishedAt: input.publishedAt,
    contentDigest: sha256(canonicalJson(descriptor)),
    bundle: {
      ...descriptor.bundle,
      url: bundleUrl,
      manifestSha256: descriptor.manifestSha256,
      files: descriptor.execution.files,
    },
  };
  return { descriptor, release };
}

export function parseStoredGameRelease(input: unknown): GameRelease {
  return StoredReleaseSchema.parse(input) as GameRelease;
}
