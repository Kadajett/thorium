import type { ExactGameRelease, RegistryFence, SurfaceAdmission } from "@thorium/game-host-api";

export function assertRegistryRelease(expected: ExactGameRelease, actual: ExactGameRelease): void {
  if (
    expected.packageId !== actual.packageId ||
    expected.version !== actual.version ||
    expected.contentDigest !== actual.contentDigest
  ) {
    throw new Error("registry_release_mismatch");
  }
}

export function admittedRegistryFence(
  release: ExactGameRelease,
  admission: SurfaceAdmission,
  roomInstanceId: string,
): RegistryFence {
  assertRegistryRelease(release, admission.release);
  return {
    gameSessionId: admission.gameSessionId,
    generation: admission.generation,
    roomInstanceId,
    release,
  };
}

export function registryAdmissionBody(
  fence: RegistryFence,
  admission: SurfaceAdmission,
): RegistryFence & Pick<SurfaceAdmission, "capabilityId" | "surfaceId" | "role" | "playerSlots"> {
  return {
    ...fence,
    capabilityId: admission.capabilityId,
    surfaceId: admission.surfaceId,
    role: admission.role,
    playerSlots: admission.playerSlots,
  };
}

function registryRecord(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("invalid_platform_registry_response");
  }
  return input as Readonly<Record<string, unknown>>;
}

export function assertRegistrySuccess(input: unknown): void {
  if (registryRecord(input).ok !== true) throw new Error("invalid_platform_registry_response");
}

export function registryActive(input: unknown): boolean {
  const result = registryRecord(input);
  if (typeof result.active !== "boolean" || Object.keys(result).length !== 1) {
    throw new Error("invalid_platform_registry_response");
  }
  return result.active;
}

export function registryServiceToken(raw: string): string {
  const token = raw.trim();
  if (token.length < 32 || token.length > 4096 || /\s/.test(token)) {
    throw new Error("invalid_game_host_service_token");
  }
  return token;
}

export function assertRegistryResponseSize(size: number): void {
  if (size > 16384) throw new Error("platform_registry_response_too_large");
}
