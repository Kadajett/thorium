import type { GameRelease } from "../domain/game-package.js";
import type { ExactGameRelease } from "../session-registry/game-session-registry.js";

export interface PublishedCatalogEntry {
  readonly release: GameRelease;
  readonly publishedAtEpochMs: number;
}

export function compareCatalogText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function matchesReleaseIdentity(
  release: GameRelease,
  packageId: string,
  version?: string,
): boolean {
  return release.packageId === packageId && (version === undefined || release.version === version);
}

function comparePackageReleases(left: PublishedCatalogEntry, right: PublishedCatalogEntry): number {
  return (
    compareCatalogText(left.release.packageId, right.release.packageId) ||
    right.publishedAtEpochMs - left.publishedAtEpochMs ||
    compareCatalogText(right.release.version, left.release.version)
  );
}

function firstPerPackage(
  entry: PublishedCatalogEntry,
  index: number,
  records: readonly PublishedCatalogEntry[],
): boolean {
  return records[index - 1]?.release.packageId !== entry.release.packageId;
}

export function currentGameReleases(
  releases: readonly PublishedCatalogEntry[],
): readonly GameRelease[] {
  const ordered: readonly PublishedCatalogEntry[] = [...releases].sort(comparePackageReleases);
  return ordered.filter(firstPerPackage).map((entry) => entry.release);
}

export function matchesCatalogQuery(release: GameRelease, query: string): boolean {
  const searchable: readonly string[] = [
    release.packageId,
    release.displayName,
    release.summary,
    ...release.tags,
  ];
  return searchable.join("\n").toLowerCase().includes(query.trim().toLowerCase());
}

export function gameUpdateRequired(
  requested: ExactGameRelease,
  current: ExactGameRelease,
): boolean {
  return (
    requested.packageId !== current.packageId ||
    requested.version !== current.version ||
    requested.contentDigest !== current.contentDigest
  );
}

export function exactGameRelease(release: ExactGameRelease): ExactGameRelease {
  return {
    packageId: release.packageId,
    version: release.version,
    contentDigest: release.contentDigest,
  };
}
