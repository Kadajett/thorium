import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Pool } from "pg";
import { FileSystemPackageArtifactStore } from "./adapters/filesystem-package-artifact-store.js";
import { InMemoryGameCatalogRepository } from "./adapters/in-memory-game-catalog.js";
import { InMemoryGameSessionRegistry } from "./adapters/in-memory-game-session-registry.js";
import { PostgresGameCatalogRepository } from "./adapters/postgres/postgres-game-catalog-repository.js";
import { PostgresGameSessionRegistry } from "./adapters/postgres/postgres-game-session-registry.js";
import { PostgresPublisherRepository } from "./adapters/postgres/postgres-publisher-repository.js";
import { runPostgresMigrations } from "./adapters/postgres/postgres-migrations.js";
import { FileSystemPackageArtifactPublicationStore } from
  "./adapters/filesystem-package-artifact-publication-store.js";
import { createSampleGames } from "./catalog/sample-games.js";
import type { PlatformEnvironment } from "./config.js";
import {
  registerPlatformRoutes,
  type HttpDependencies,
} from "./http/routes.js";
import {
  configureColyseusCors,
  createBrowserOriginPolicy,
  createWebSocketOriginGuard,
} from "./http/browser-origin-policy.js";
import { createGameSessionRoom } from "./rooms/game-session-room.js";
import { HmacAccountTokenAdapter } from "./security/account-token-adapter.js";
import { SessionTicketService } from "./security/session-ticket-service.js";
import { SharedGameHostAuthority } from "./security/shared-game-host-authority.js";
import { PublisherAccessService } from "./security/publisher-access-service.js";
import { GameReleasePublisher } from "./publication/game-release-publisher.js";
import { PublisherPublicationService } from
  "./publication/publisher-publication-service.js";

export interface PlatformDependencies extends HttpDependencies {
  readonly beforeListen?: () => Promise<void>;
  readonly close?: () => Promise<void>;
}

export interface PlatformServerOptions {
  readonly browserAllowedOrigins?: readonly string[];
}

export function createPlatformDependencies(
  environment: PlatformEnvironment,
): PlatformDependencies {
  const pool = environment.DATABASE_URL === undefined
    ? undefined
    : new Pool({ connectionString: environment.DATABASE_URL });
  const postgresCatalog = pool === undefined
    ? undefined
    : new PostgresGameCatalogRepository(pool);
  const catalog = postgresCatalog
    ?? new InMemoryGameCatalogRepository(createSampleGames(environment.PUBLIC_BASE_URL));
  const packageArtifacts = new FileSystemPackageArtifactStore(environment.PACKAGE_ARTIFACT_DIRECTORY);
  const accountIdentity = new HmacAccountTokenAdapter(environment.ACCOUNT_TOKEN_SECRET);
  const gameSessions = pool === undefined
    ? new InMemoryGameSessionRegistry()
    : new PostgresGameSessionRegistry(pool);
  const sessionTickets = new SessionTicketService({
    secret: environment.SESSION_TICKET_SECRET,
    endpoint: environment.PUBLIC_BASE_URL,
    ttlSeconds: environment.SESSION_TICKET_TTL_SECONDS,
  });
  const gameHost = environment.GAME_HOST_PUBLIC_ENDPOINT === undefined
    ? undefined
    : new SharedGameHostAuthority({
      endpoint: environment.GAME_HOST_PUBLIC_ENDPOINT,
      admissionPrivateKeyFile: environment.GAME_HOST_ADMISSION_PRIVATE_KEY_FILE!,
      serviceTokenFile: environment.GAME_HOST_SERVICE_TOKEN_FILE!,
      scopeSecret: environment.SESSION_TICKET_SECRET,
    });
  const publisherRepository = pool === undefined
    ? undefined
    : new PostgresPublisherRepository(pool);
  const publisher = publisherRepository === undefined || postgresCatalog === undefined
    ? undefined
    : {
      access: new PublisherAccessService(publisherRepository),
      publication: new PublisherPublicationService({
        authorization: publisherRepository,
        publisher: new GameReleasePublisher({
          artifacts: new FileSystemPackageArtifactPublicationStore(
            environment.PACKAGE_ARTIFACT_DIRECTORY,
          ),
          releases: postgresCatalog,
          publicBaseUrl: environment.PUBLIC_BASE_URL,
        }),
      }),
    };
  return {
    catalog,
    packageArtifacts,
    accountIdentity,
    sessionTickets,
    gameSessions,
    ...(gameHost === undefined ? {} : { gameHost }),
    ...(publisher === undefined ? {} : { publisher }),
    beforeListen: async () => {
      await gameHost?.ready();
      if (pool !== undefined) await runPostgresMigrations(pool);
    },
    ...(pool === undefined
      ? {}
      : {
        isReady: async () => {
          await pool.query("SELECT 1");
          return true;
        },
        close: () => pool.end(),
      }),
  };
}

export function createPlatformServer(
  dependencies: PlatformDependencies,
  options: PlatformServerOptions = {},
) {
  const GameSessionRoom = createGameSessionRoom(
    dependencies.sessionTickets,
    dependencies.gameSessions,
  );
  const browserOrigins = createBrowserOriginPolicy(options.browserAllowedOrigins ?? []);
  configureColyseusCors(browserOrigins);
  const server = defineServer({
    rooms: {
      game_session: defineRoom(GameSessionRoom).filterBy(["gameSessionId"]),
    },
    express: (app) => {
      registerPlatformRoutes(app, dependencies);
    },
    transport: new WebSocketTransport({
      beforeUpgrade: createWebSocketOriginGuard(browserOrigins),
      // A canonical Base64 encoding of the 32 KiB game payload plus its
      // Colyseus envelope is below this transport ceiling.
      maxPayload: 48 * 1_024,
    }),
    ...(dependencies.beforeListen === undefined
      ? {}
      : { beforeListen: dependencies.beforeListen }),
    greet: false,
  });
  if (dependencies.close !== undefined) {
    server.onShutdown(dependencies.close);
  }
  return server;
}
