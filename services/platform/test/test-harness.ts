import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { InMemoryGameCatalogRepository } from "../src/adapters/in-memory-game-catalog.js";
import { InMemoryGameSessionRegistry } from "../src/adapters/in-memory-game-session-registry.js";
import {
  InMemoryPackageArtifactStore,
  type InMemoryPackageArtifact,
} from "../src/adapters/in-memory-package-artifact-store.js";
import {
  createSampleGames,
  TAP_RACE_ARTIFACT_KEY,
} from "../src/catalog/sample-games.js";
import type { PlatformDependencies } from "../src/platform.js";
import { HmacAccountTokenAdapter } from "../src/security/account-token-adapter.js";
import { SessionTicketService } from "../src/security/session-ticket-service.js";
import type { AccountSession } from "../src/ports/account-identity.js";
import type { GameRelease } from "../src/domain/game-package.js";
import type { RequestedGameSessionSurface } from "../src/session-registry/game-session-registry.js";

export const TEST_ACCOUNT_SECRET = "test-account-token-secret-at-least-32-characters";
export const TEST_SESSION_SECRET = "test-session-ticket-secret-at-least-32-characters";
export const TEST_PUBLIC_BASE_URL = "http://platform.test";
export const TEST_GAMES = createSampleGames(TEST_PUBLIC_BASE_URL);
export const TAP_RACE_ARCHIVE_BYTES = readFileSync(
  new URL(
    `../../../games/tap-race/artifacts/${TAP_RACE_ARTIFACT_KEY.fileName}`,
    import.meta.url,
  ),
);

export interface TestHarnessOptions {
  readonly artifacts?: readonly InMemoryPackageArtifact[];
  readonly publicBaseUrl?: string;
}

export function createTestHarness(
  now: () => Date = () => new Date(),
  options: TestHarnessOptions = {},
): {
  readonly dependencies: PlatformDependencies;
  readonly accountIdentity: HmacAccountTokenAdapter;
  readonly sessionTickets: SessionTicketService;
  readonly gameSessions: InMemoryGameSessionRegistry;
  readonly packageArtifacts: InMemoryPackageArtifactStore;
} {
  const catalog = new InMemoryGameCatalogRepository(
    createSampleGames(options.publicBaseUrl ?? TEST_PUBLIC_BASE_URL),
  );
  const packageArtifacts = new InMemoryPackageArtifactStore(options.artifacts ?? [{
    key: TAP_RACE_ARTIFACT_KEY,
    bytes: TAP_RACE_ARCHIVE_BYTES,
  }]);
  const accountIdentity = new HmacAccountTokenAdapter(TEST_ACCOUNT_SECRET, now);
  const gameSessions = new InMemoryGameSessionRegistry();
  const sessionTickets = new SessionTicketService({
    secret: TEST_SESSION_SECRET,
    endpoint: options.publicBaseUrl ?? TEST_PUBLIC_BASE_URL,
    ttlSeconds: 60,
    now,
  });
  return {
    dependencies: {
      catalog,
      packageArtifacts,
      accountIdentity,
      sessionTickets,
      gameSessions,
    },
    accountIdentity,
    sessionTickets,
    gameSessions,
    packageArtifacts,
  };
}

export async function issueTestGameSession(
  harness: ReturnType<typeof createTestHarness>,
  account: AccountSession,
  game: GameRelease,
  surfaces: readonly RequestedGameSessionSurface[],
  requestId = randomUUID(),
) {
  const activated = await harness.gameSessions.activate({
    requestId,
    accountId: account.accountId,
    release: {
      packageId: game.packageId,
      version: game.version,
      contentDigest: game.contentDigest,
    },
    surfaces,
  });
  if (!activated.ok) throw new Error(activated.conflict.code);
  return harness.sessionTickets.issueBundle(
    harness.sessionTickets.prepareIssue(account),
    activated.activation,
  );
}

export const TWO_SURFACE_LEASES = [
  {
    surfaceId: "upper",
    role: "main" as const,
    playerSlots: [0],
  },
  {
    surfaceId: "lower",
    role: "companion" as const,
    playerSlots: [1],
  },
] as const;
