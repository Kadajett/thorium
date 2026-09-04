import type { GameRelease } from "../domain/game-package.js";

export const TAP_RACE_ARTIFACT_KEY = {
  packageId: "dev.yougotserved.tap-race",
  version: "0.1.0",
  fileName: "dev.yougotserved.tap-race-0.1.0.zip",
} as const;

function publicPackageUrl(publicBaseUrl: string): string {
  const base = publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`;
  const key = TAP_RACE_ARTIFACT_KEY;
  return new URL(
    `v1/packages/${encodeURIComponent(key.packageId)}/${encodeURIComponent(key.version)}/${encodeURIComponent(key.fileName)}`,
    base,
  ).toString();
}

export function createSampleGames(publicBaseUrl: string): readonly GameRelease[] {
  const release: GameRelease = {
    schema: 1,
    packageId: TAP_RACE_ARTIFACT_KEY.packageId,
    version: TAP_RACE_ARTIFACT_KEY.version,
    displayName: "Tap Race",
    summary: "Two local players race to fifty taps on Thor's two surfaces.",
    description: "The main surface shows the race while the companion surface provides one large semantic control per local Player Slot.",
    tags: ["arcade", "local-multiplayer", "tap", "dual-screen"],
    publishedAt: "2026-09-04T00:00:00.000Z",
    contentDigest: "1b1e9e2016b10b5759ba38febfa745a0f3f5bdaef21109d762674179773514d6",
    runtime: {
      kind: "web-v1",
      sdkCompatibility: "^0.1.0",
      entrypoints: {
        main: {
          path: "main/index.html",
          purpose: "primary-gameplay",
        },
        companion: {
          path: "companion/index.html",
          purpose: "companion-controls",
        },
      },
      files: ["main/index.html", "companion/index.html", "dist/game.js"],
    },
    bundle: {
      fileName: TAP_RACE_ARTIFACT_KEY.fileName,
      url: publicPackageUrl(publicBaseUrl),
      sha256: "d1b3e0453b427534b1b64c0a635d56d5d64f496f02ca4cc4971a38f2e2e6d3be",
      sizeBytes: 7_872,
      manifestSha256: "671d308bcbca5335733a8b8cea1e94e7162cd0ef393cec86a13f893183d1e69d",
      files: [
        {
          path: "companion/index.html",
          sha256: "a0cfcee7d0c709e448b8f623a501d54704ab8bf8b197f5c530a445757d7f8e55",
          size: 627,
        },
        {
          path: "dist/game.js",
          sha256: "47f946483e33595e1b314405af199667a6257d89dab14de1f827929fb36f7e59",
          size: 23_528,
        },
        {
          path: "main/index.html",
          sha256: "c7205203a1732f8815228a82ba014f2b4622c8540fdb2bc00e12a457c9516e97",
          size: 624,
        },
      ],
    },
    displays: {
      requiredSurfaces: ["main", "companion"],
      supportsSingleSurfaceFallback: false,
      main: {
        logicalWidth: 960,
        logicalHeight: 540,
        maximumDevicePixelRatio: 2,
      },
      companion: {
        logicalWidth: 960,
        logicalHeight: 540,
        maximumDevicePixelRatio: 2,
      },
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
    controls: [
      { id: "tap", label: "Tap", kind: "button" },
    ],
    capabilities: ["same-device-peer", "colyseus-session"],
    budgets: {
      maxPackageBytes: 1_048_576,
      maxFileCount: 8,
      maxLocalPeerMessageBytes: 4_096,
    },
  };
  return [release];
}
