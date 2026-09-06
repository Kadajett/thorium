import type { ExactGameRelease } from "@thorium/game-host-api";

export function moduleReleaseKey(release: ExactGameRelease): string {
  return `${release.packageId}@${release.version}#${release.contentDigest}`;
}
