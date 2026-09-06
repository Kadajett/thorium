import type { GameRelease } from "../src/domain/game-package.js";
import { createTestGamePackageFixture } from "./test-game-package-fixture.js";

export function catalogReleases(): readonly [GameRelease, GameRelease, GameRelease] {
  const fixture = createTestGamePackageFixture("https://platform.test").release;
  const older = {
    ...fixture,
    version: "9.0.0",
    summary: "Retired orchard",
    publishedAt: "2026-01-01T00:00:00.000Z",
  };
  const current = {
    ...fixture,
    version: "2.0.0",
    contentDigest: "b".repeat(64),
    summary: "Current meadow",
    publishedAt: "2026-02-01T00:00:00.000Z",
  };
  const other = {
    ...fixture,
    packageId: "dev.yougotserved.z-fixture",
    contentDigest: "c".repeat(64),
  };
  return [older, current, other];
}
