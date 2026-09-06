import type {
  ActivateGameSessionResult,
  ExactGameRelease,
  RequestedGameSessionSurface,
} from "../session-registry/game-session-registry.js";

export interface NormalizedActivation {
  readonly requestId: string;
  readonly accountId: string;
  readonly release: ExactGameRelease;
  readonly surfaces: readonly RequestedGameSessionSurface[];
  readonly fingerprint: string;
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function packageId(value: unknown): value is string {
  return identity(value) && /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value);
}

function version(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
  );
}

export function validRelease(value: unknown): value is ExactGameRelease {
  return (
    record(value) &&
    packageId(value.packageId) &&
    version(value.version) &&
    typeof value.contentDigest === "string" &&
    /^[a-f0-9]{64}$/.test(value.contentDigest)
  );
}

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

function isSlot(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 15;
}

export function normalizePlayerSlots(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || value.length > 16 || !value.every(isSlot) || !unique(value))
    return null;
  return sortedSlots(value);
}

function sortedSlots(slots: readonly number[]): readonly number[] {
  return Array.from({ length: 16 }, (_, slot) => slot).filter((slot) => slots.includes(slot));
}

function surfaceIdentity(value: unknown): value is Readonly<{
  surfaceId: string;
  role: "main" | "companion";
  playerSlots?: unknown;
}> {
  return (
    record(value) &&
    typeof value.surfaceId === "string" &&
    /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.surfaceId) &&
    (value.role === "main" || value.role === "companion")
  );
}

function parseSurface(value: unknown): RequestedGameSessionSurface | null {
  if (!surfaceIdentity(value)) return null;
  return normalizeSurface(value);
}

function normalizeSurface(
  value: Readonly<{
    surfaceId: string;
    role: "main" | "companion";
    playerSlots?: unknown;
  }>,
): RequestedGameSessionSurface | null {
  const playerSlots = normalizePlayerSlots(value.playerSlots);
  return playerSlots === null
    ? null
    : { surfaceId: value.surfaceId, role: value.role, playerSlots };
}

function validSurfaceLeases(surfaces: readonly RequestedGameSessionSurface[]): boolean {
  const slots: readonly number[] = surfaces.flatMap((surface) => surface.playerSlots);
  return (
    unique(surfaces.map((surface) => surface.surfaceId)) &&
    unique(surfaces.map((surface) => surface.role)) &&
    slots.length > 0 &&
    unique(slots)
  );
}

function orderedSurfaces(
  surfaces: readonly RequestedGameSessionSurface[],
): readonly RequestedGameSessionSurface[] {
  return [
    ...surfaces.filter((surface) => surface.role === "main"),
    ...surfaces.filter((surface) => surface.role === "companion"),
  ];
}

function parseSurfaces(value: unknown): readonly RequestedGameSessionSurface[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  return normalizeSurfaces(value);
}

function normalizeSurfaces(
  value: readonly unknown[],
): readonly RequestedGameSessionSurface[] | null {
  const parsed: readonly (RequestedGameSessionSurface | null)[] = value.map(parseSurface);
  if (!parsed.every((surface) => surface !== null)) return null;
  return validSurfaceLeases(parsed) ? orderedSurfaces(parsed) : null;
}

function cloneRelease(release: ExactGameRelease): ExactGameRelease {
  return {
    packageId: release.packageId,
    version: release.version,
    contentDigest: release.contentDigest,
  };
}

function activationIdentity(value: unknown): value is Readonly<{
  requestId: string;
  accountId: string;
  release: ExactGameRelease;
  surfaces?: unknown;
}> {
  return (
    record(value) &&
    identity(value.requestId) &&
    identity(value.accountId) &&
    validRelease(value.release)
  );
}

function parseActivation(input: unknown): Omit<NormalizedActivation, "fingerprint"> | null {
  if (!activationIdentity(input)) return null;
  const surfaces = parseSurfaces(input.surfaces);
  if (surfaces === null) return null;
  return {
    requestId: input.requestId,
    accountId: input.accountId,
    surfaces,
    release: cloneRelease(input.release),
  };
}

export function normalizeActivation(
  input: unknown,
): NormalizedActivation | Extract<ActivateGameSessionResult, { ok: false }> {
  const parsed = parseActivation(input);
  if (parsed === null) {
    return {
      ok: false,
      conflict: { code: "INVALID_ACTIVATION", message: "The Game Session activation is invalid." },
    };
  }
  return {
    ...parsed,
    fingerprint: JSON.stringify({ release: parsed.release, surfaces: parsed.surfaces }),
  };
}
