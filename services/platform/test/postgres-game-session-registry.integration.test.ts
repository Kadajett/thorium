import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { PostgresGameSessionRegistry } from "../src/adapters/postgres/postgres-game-session-registry.js";
import { runPostgresMigrations } from "../src/adapters/postgres/postgres-migrations.js";
import type {
  ActivateGameSession,
  AdmitGameSessionSurface,
  GameSessionActivation,
} from "../src/session-registry/game-session-registry.js";

const databaseUrl = process.env.THORIUM_TEST_DATABASE_URL?.trim();
const describeWithPostgres = databaseUrl === undefined || databaseUrl.length === 0
  ? describe.skip
  : describe;
const migrationName = "0001_game_session_registry.sql";
const release = {
  packageId: "dev.yougotserved.tap-race",
  version: "0.1.0",
  contentDigest: "a".repeat(64),
} as const;
const surfaces = [
  { surfaceId: "upper", role: "main", playerSlots: [0] },
  { surfaceId: "lower", role: "companion", playerSlots: [1, 2] },
] as const;

interface SessionStateRecord {
  readonly generation: string | number;
  readonly status: string;
}

interface CountRecord {
  readonly count: string | number;
}

interface MigrationDigestRecord {
  readonly sha256: string;
}

interface FailedMigrationRelations {
  readonly accounts_exists: boolean;
  readonly blocker_exists: boolean;
  readonly ledger_exists: boolean;
}

function activationOf(
  result: Awaited<ReturnType<PostgresGameSessionRegistry["activate"]>>,
): GameSessionActivation {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.conflict.code);
  return result.activation;
}

function activationRequest(
  accountId: string,
  requestId = randomUUID(),
  overrides: Partial<ActivateGameSession> = {},
): ActivateGameSession {
  return {
    accountId,
    requestId,
    release,
    surfaces,
    ...overrides,
  };
}

function admission(
  activation: GameSessionActivation,
  surfaceIndex: number,
  roomInstanceId: string,
): AdmitGameSessionSurface {
  const grant = activation.surfaces[surfaceIndex];
  if (grant === undefined) throw new Error(`missing surface grant ${surfaceIndex}`);
  return {
    ...grant,
    gameSessionId: activation.gameSessionId,
    generation: activation.generation,
    roomInstanceId,
    release: activation.release,
  };
}

function quotedTestSchema(schemaName: string): string {
  if (!/^thorium_registry_test_[a-f0-9]{32}$/.test(schemaName)) {
    throw new Error("refusing to use an unsafe PostgreSQL test schema name");
  }
  return `"${schemaName}"`;
}

describeWithPostgres("PostgreSQL GameSessionRegistry integration", () => {
  const schemaName = `thorium_registry_test_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = quotedTestSchema(schemaName);
  let controlPool: Pool | undefined;
  let registryPool: Pool | undefined;
  let registry: PostgresGameSessionRegistry;
  let schemaCreated = false;

  beforeAll(async () => {
    controlPool = new Pool({ connectionString: databaseUrl, max: 2 });
    await controlPool.query(`CREATE SCHEMA ${quotedSchema}`);
    schemaCreated = true;
    registryPool = new Pool({
      connectionString: databaseUrl,
      max: 8,
      options: `-c search_path=${schemaName},public`,
    });
    await runPostgresMigrations(registryPool);
    await runPostgresMigrations(registryPool);
    registry = new PostgresGameSessionRegistry(registryPool);
  }, 30_000);

  beforeEach(async () => {
    await registryPool?.query(`
      TRUNCATE TABLE
        thorium_game_session_player_slots,
        thorium_game_session_surfaces,
        thorium_game_sessions,
        thorium_game_session_accounts
      CASCADE
    `);
  });

  afterAll(async () => {
    try {
      await registryPool?.end();
    } finally {
      try {
        if (schemaCreated) {
          await controlPool?.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
        }
      } finally {
        await controlPool?.end();
      }
    }
  }, 30_000);

  it("applies the versioned migration once and verifies its checksum on replay", async () => {
    if (registryPool === undefined) throw new Error("PostgreSQL test pool was not created");
    await expect(runPostgresMigrations(registryPool)).resolves.toBeUndefined();
    const ledger = await registryPool.query<CountRecord>(
      `SELECT count(*)::integer AS count
         FROM thorium_schema_migrations
        WHERE file_name = $1`,
      [migrationName],
    );
    expect(Number(ledger.rows[0]?.count)).toBe(1);
  });

  it("rejects checksum drift without rewriting the applied migration ledger", async () => {
    if (registryPool === undefined) throw new Error("PostgreSQL test pool was not created");
    const applied = await registryPool.query<MigrationDigestRecord>(
      `SELECT sha256
         FROM thorium_schema_migrations
        WHERE file_name = $1`,
      [migrationName],
    );
    const originalSha256 = applied.rows[0]?.sha256;
    if (originalSha256 === undefined) throw new Error("applied migration missing from ledger");
    const driftedSha256 = "0".repeat(64);

    await registryPool.query(
      `UPDATE thorium_schema_migrations
          SET sha256 = $2
        WHERE file_name = $1`,
      [migrationName, driftedSha256],
    );
    try {
      await expect(runPostgresMigrations(registryPool)).rejects.toThrow(
        `Applied PostgreSQL migration changed: ${migrationName}`,
      );
      const unchanged = await registryPool.query<MigrationDigestRecord>(
        `SELECT sha256
           FROM thorium_schema_migrations
          WHERE file_name = $1`,
        [migrationName],
      );
      expect(unchanged.rows[0]?.sha256).toBe(driftedSha256);
    } finally {
      await registryPool.query(
        `UPDATE thorium_schema_migrations
            SET sha256 = $2
          WHERE file_name = $1`,
        [migrationName, originalSha256],
      );
    }
    await expect(runPostgresMigrations(registryPool)).resolves.toBeUndefined();
  });

  it("rolls back its ledger and earlier DDL when a migration statement fails", async () => {
    if (controlPool === undefined) throw new Error("PostgreSQL control pool was not created");
    const failureSchemaName = `thorium_registry_test_${randomUUID().replaceAll("-", "")}`;
    const quotedFailureSchema = quotedTestSchema(failureSchemaName);
    let failureSchemaCreated = false;
    let failurePool: Pool | undefined;
    try {
      await controlPool.query(`CREATE SCHEMA ${quotedFailureSchema}`);
      failureSchemaCreated = true;
      failurePool = new Pool({
        connectionString: databaseUrl,
        max: 2,
        options: `-c search_path=${failureSchemaName},public`,
      });
      await failurePool.query("CREATE TABLE thorium_game_sessions (blocker integer)");

      await expect(runPostgresMigrations(failurePool)).rejects.toThrow();
      const relations = await failurePool.query<FailedMigrationRelations>(`
        SELECT
          to_regclass($1) IS NOT NULL AS accounts_exists,
          to_regclass($2) IS NOT NULL AS blocker_exists,
          to_regclass($3) IS NOT NULL AS ledger_exists
      `, [
        `${failureSchemaName}.thorium_game_session_accounts`,
        `${failureSchemaName}.thorium_game_sessions`,
        `${failureSchemaName}.thorium_schema_migrations`,
      ]);
      expect(relations.rows[0]).toEqual({
        accounts_exists: false,
        blocker_exists: true,
        ledger_exists: false,
      });
    } finally {
      await failurePool?.end();
      if (failureSchemaCreated) {
        await controlPool.query(`DROP SCHEMA ${quotedFailureSchema} CASCADE`);
      }
    }
  });

  it("serializes concurrent activations into one active, monotonically fenced generation", async () => {
    const accountId = `account-${randomUUID()}`;
    const firstRequest = activationRequest(accountId);
    const secondRequest = activationRequest(accountId);
    const results = await Promise.all([
      registry.activate(firstRequest),
      registry.activate(secondRequest),
    ]);
    const activations = results.map(activationOf)
      .sort((left, right) => left.generation - right.generation);
    const first = activations[0];
    const active = activations[1];
    if (first === undefined || active === undefined) throw new Error("activations missing");

    expect(activations.map((activation) => activation.generation)).toEqual([1, 2]);
    expect(active.supersededGameSessionId).toBe(first.gameSessionId);
    if (registryPool === undefined) throw new Error("PostgreSQL test pool was not created");
    const stored = await registryPool.query<SessionStateRecord>(
      `SELECT generation, status
         FROM thorium_game_sessions
        WHERE account_id = $1
        ORDER BY generation`,
      [accountId],
    );
    expect(stored.rows.map((row) => ({
      generation: Number(row.generation),
      status: row.status,
    }))).toEqual([
      { generation: 1, status: "superseded" },
      { generation: 2, status: "active" },
    ]);

    const activeResultIndex = results.findIndex((result) =>
      result.ok && result.activation.gameSessionId === active.gameSessionId);
    expect(activeResultIndex).toBeGreaterThanOrEqual(0);
    const activeRequest = activeResultIndex === 0 ? firstRequest : secondRequest;
    await expect(registry.activate({
      ...activeRequest,
      surfaces: [...activeRequest.surfaces].reverse(),
    })).resolves.toEqual({ ok: true, replayed: true, activation: active });
  });

  it("atomically binds every surface to the first admitting Colyseus room", async () => {
    const activation = activationOf(await registry.activate(
      activationRequest(`account-${randomUUID()}`),
    ));
    const roomIds = ["room-a", "room-b"] as const;
    const outcomes = await Promise.all([
      registry.admit(admission(activation, 0, roomIds[0])),
      registry.admit(admission(activation, 1, roomIds[1])),
    ]);
    const winnerIndex = outcomes.findIndex((outcome) => outcome.ok);
    const loserIndex = outcomes.findIndex((outcome) => !outcome.ok);
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    expect(outcomes[loserIndex]).toMatchObject({
      ok: false,
      conflict: { code: "ROOM_FENCE_MISMATCH" },
    });

    const winningRoomId = roomIds[winnerIndex];
    const losingRoomId = roomIds[loserIndex];
    if (winningRoomId === undefined || losingRoomId === undefined) {
      throw new Error("room binding outcome missing");
    }
    await expect(registry.isActive({
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId: winningRoomId,
    })).resolves.toBe(true);
    await expect(registry.isActive({
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId: losingRoomId,
    })).resolves.toBe(false);
    await expect(registry.admit(
      admission(activation, loserIndex, winningRoomId),
    )).resolves.toMatchObject({ ok: true });
    await expect(registry.finish({
      gameSessionId: activation.gameSessionId,
      generation: activation.generation,
      roomInstanceId: losingRoomId,
      reason: "abandoned",
    })).resolves.toMatchObject({
      ok: false,
      conflict: { code: "ROOM_FENCE_MISMATCH" },
    });
  });

  it("allows exactly one concurrent admission of a surface capability", async () => {
    const activation = activationOf(await registry.activate(
      activationRequest(`account-${randomUUID()}`, randomUUID(), {
        surfaces: [surfaces[0]],
      }),
    ));
    const input = admission(activation, 0, "room-one-use");
    const outcomes = await Promise.all([
      registry.admit(input),
      registry.admit(input),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({
      ok: false,
      conflict: { code: "CAPABILITY_REPLAYED" },
    });
  });

  it("rejects a superseded room at every durable generation fence", async () => {
    const accountId = `account-${randomUUID()}`;
    const first = activationOf(await registry.activate(activationRequest(accountId)));
    await expect(registry.admit(admission(first, 0, "room-old")))
      .resolves.toMatchObject({ ok: true });
    await expect(registry.isActive({
      gameSessionId: first.gameSessionId,
      generation: first.generation,
      roomInstanceId: "room-old",
    })).resolves.toBe(true);

    const replacement = activationOf(await registry.activate(activationRequest(
      accountId,
      randomUUID(),
      {
        release: {
          ...release,
          version: "0.2.0",
          contentDigest: "b".repeat(64),
        },
      },
    )));
    expect(replacement).toMatchObject({
      generation: first.generation + 1,
      supersededGameSessionId: first.gameSessionId,
    });
    await expect(registry.isActive({
      gameSessionId: first.gameSessionId,
      generation: first.generation,
      roomInstanceId: "room-old",
    })).resolves.toBe(false);
    await expect(registry.admit(admission(first, 1, "room-old"))).resolves.toMatchObject({
      ok: false,
      conflict: { code: "SESSION_NOT_ACTIVE" },
    });
    await expect(registry.finish({
      gameSessionId: first.gameSessionId,
      generation: first.generation,
      roomInstanceId: "room-old",
      reason: "room-failed",
    })).resolves.toMatchObject({
      ok: false,
      conflict: { code: "SESSION_SUPERSEDED" },
    });
  });
});
