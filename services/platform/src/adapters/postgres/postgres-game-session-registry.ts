import { createHash, randomUUID } from "node:crypto";
import type {
  ActivateGameSession,
  ActivateGameSessionResult,
  AdmitGameSessionSurface,
  AdmitGameSessionSurfaceResult,
  ExactGameRelease,
  FinishGameSession,
  FinishGameSessionResult,
  GameSessionActivation,
  GameSessionRegistry,
  GameSessionSurfaceGrant,
  GameSessionRoomFence,
} from "../../session-registry/game-session-registry.js";

/** The subset of node-postgres' QueryResult used by this adapter. */
export interface PostgresQueryResult<Row extends Record<string, unknown>> {
  readonly rows: Row[];
  readonly rowCount: number | null;
}

/**
 * A structural PoolClient interface keeps node-postgres out of the registry's
 * core interface while still accepting a pg PoolClient in production.
 */
export interface PostgresPoolClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  release(): void;
}

/** The subset of node-postgres' Pool used by this adapter. */
export interface PostgresPool {
  connect(): Promise<PostgresPoolClient>;
}

export interface PostgresGameSessionRegistryOptions {
  readonly id?: () => string;
}

type SessionStatus = "active" | "finished" | "superseded";

interface AccountStateRow extends Record<string, unknown> {
  readonly generation: string | number;
}

interface SessionIdentityRow extends Record<string, unknown> {
  readonly game_session_id: string;
}

interface SessionRow extends SessionIdentityRow {
  readonly account_id: string;
  readonly generation: string | number;
  readonly request_fingerprint: string;
  readonly package_id: string;
  readonly package_version: string;
  readonly package_digest: string;
  readonly status: SessionStatus;
  readonly supersedes_game_session_id: string | null;
  readonly room_instance_id: string | null;
}

interface SurfaceRow extends Record<string, unknown> {
  readonly capability_id: string;
  readonly surface_id: string;
  readonly role: "main" | "companion";
  readonly admitted_at: Date | string | null;
}

interface SurfaceWithSlotsRow extends SurfaceRow {
  readonly player_slots: unknown;
}

interface PlayerSlotRow extends Record<string, unknown> {
  readonly player_slot: string | number;
}

interface ActiveFenceRow extends Record<string, unknown> {
  readonly active: boolean;
}

interface NormalizedSurface {
  readonly surfaceId: string;
  readonly role: "main" | "companion";
  readonly playerSlots: readonly number[];
}

interface NormalizedActivation {
  readonly requestId: string;
  readonly accountId: string;
  readonly release: ExactGameRelease;
  readonly surfaces: readonly NormalizedSurface[];
}

const surfaceIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roleOrder: Readonly<Record<NormalizedSurface["role"], number>> = {
  main: 0,
  companion: 1,
};

/**
 * PostgreSQL-backed registry for the durable, account-scoped Game Session
 * lifecycle. The database transaction, not a process-local cache, owns the
 * one-active-session invariant and generation fence.
 */
export class PostgresGameSessionRegistry implements GameSessionRegistry {
  readonly #pool: PostgresPool;
  readonly #id: () => string;

  constructor(
    pool: PostgresPool,
    options: PostgresGameSessionRegistryOptions = {},
  ) {
    this.#pool = pool;
    this.#id = options.id ?? randomUUID;
  }

  async activate(input: ActivateGameSession): Promise<ActivateGameSessionResult> {
    const normalized = normalizeActivation(input);
    if (normalized === null) {
      return activationConflict(
        "INVALID_ACTIVATION",
        "The Game Session activation is invalid.",
      );
    }
    const fingerprint = activationFingerprint(normalized);

    return this.#transaction(async (client) => {
      await client.query(
        `INSERT INTO thorium_game_session_accounts (account_id, generation)
         VALUES ($1, 0)
         ON CONFLICT (account_id) DO NOTHING`,
        [normalized.accountId],
      );
      const accountState = await client.query<AccountStateRow>(
        `SELECT generation
           FROM thorium_game_session_accounts
          WHERE account_id = $1
          FOR UPDATE`,
        [normalized.accountId],
      );
      const currentGeneration = generationOf(requiredRow(accountState, "account state"));

      const priorRequest = await client.query<SessionRow>(
        `SELECT game_session_id::text,
                account_id,
                generation,
                request_fingerprint,
                package_id,
                package_version,
                package_digest,
                status,
                supersedes_game_session_id::text,
                room_instance_id
           FROM thorium_game_sessions
          WHERE account_id = $1 AND request_id = $2`,
        [normalized.accountId, normalized.requestId],
      );
      const existing = priorRequest.rows[0];
      if (existing !== undefined) {
        if (existing.request_fingerprint !== fingerprint) {
          return activationConflict(
            "REQUEST_ID_REUSED",
            "The activation request ID was already used with another payload.",
          );
        }
        if (existing.status !== "active") {
          return activationConflict(
            "REQUEST_NO_LONGER_ACTIVE",
            "The activation created by this request is no longer active.",
          );
        }
        return {
          ok: true,
          replayed: true,
          activation: await this.#activation(client, existing),
        };
      }

      const activeResult = await client.query<SessionIdentityRow>(
        `SELECT game_session_id::text
           FROM thorium_game_sessions
          WHERE account_id = $1 AND status = 'active'
          FOR UPDATE`,
        [normalized.accountId],
      );
      const supersededGameSessionId = activeResult.rows[0]?.game_session_id;
      const generation = currentGeneration + 1;
      if (!Number.isSafeInteger(generation)) {
        throw new Error("Game Session generation exceeds JavaScript's safe integer range");
      }

      const gameSessionId = this.#id();
      const grants: readonly GameSessionSurfaceGrant[] = normalized.surfaces.map(
        (surface) => ({ ...surface, capabilityId: this.#id() }),
      );
      if (
        !uuidPattern.test(gameSessionId)
        || grants.some((grant) => !uuidPattern.test(grant.capabilityId))
        || new Set([gameSessionId, ...grants.map((grant) => grant.capabilityId)]).size
          !== grants.length + 1
      ) {
        throw new Error("The Game Session ID source returned an invalid or duplicate UUID.");
      }

      if (supersededGameSessionId !== undefined) {
        const superseded = await client.query(
          `UPDATE thorium_game_sessions
              SET status = 'superseded', finished_at = clock_timestamp()
            WHERE game_session_id = $1 AND account_id = $2 AND status = 'active'`,
          [supersededGameSessionId, normalized.accountId],
        );
        if (superseded.rowCount !== 1) {
          throw new Error("Active Game Session changed while its account was locked");
        }
      }

      await client.query(
        `UPDATE thorium_game_session_accounts
            SET generation = $2
          WHERE account_id = $1`,
        [normalized.accountId, generation],
      );
      await client.query(
        `INSERT INTO thorium_game_sessions (
           game_session_id,
           account_id,
           generation,
           request_id,
           request_fingerprint,
           package_id,
           package_version,
           package_digest,
           status,
           supersedes_game_session_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)`,
        [
          gameSessionId,
          normalized.accountId,
          generation,
          normalized.requestId,
          fingerprint,
          normalized.release.packageId,
          normalized.release.version,
          normalized.release.contentDigest,
          supersededGameSessionId ?? null,
        ],
      );
      for (const grant of grants) {
        await client.query(
          `INSERT INTO thorium_game_session_surfaces (
             game_session_id, capability_id, surface_id, role
           ) VALUES ($1, $2, $3, $4)`,
          [
            gameSessionId,
            grant.capabilityId,
            grant.surfaceId,
            grant.role,
          ],
        );
        for (const playerSlot of grant.playerSlots) {
          await client.query(
            `INSERT INTO thorium_game_session_player_slots (
               game_session_id, surface_id, player_slot
             ) VALUES ($1, $2, $3)`,
            [gameSessionId, grant.surfaceId, playerSlot],
          );
        }
      }

      const activation: GameSessionActivation = {
        gameSessionId,
        generation,
        release: normalized.release,
        surfaces: grants,
        ...(supersededGameSessionId === undefined
          ? {}
          : { supersededGameSessionId }),
      };
      return { ok: true, replayed: false, activation };
    });
  }

  async admit(
    input: AdmitGameSessionSurface,
  ): Promise<AdmitGameSessionSurfaceResult> {
    return this.#transaction(async (client) => {
      const sessionResult = await client.query<SessionRow>(
        `SELECT game_session_id::text,
                account_id,
                generation,
                request_fingerprint,
                package_id,
                package_version,
                package_digest,
                status,
                supersedes_game_session_id::text,
                room_instance_id
           FROM thorium_game_sessions
          WHERE game_session_id = $1
          FOR UPDATE`,
        [input.gameSessionId],
      );
      const session = sessionResult.rows[0];
      if (
        session === undefined
        || session.status !== "active"
      ) {
        return admissionConflict(
          "SESSION_NOT_ACTIVE",
          "The requested Game Session is not active.",
        );
      }
      if (generationOf(session) !== input.generation) {
        return admissionConflict(
          "GENERATION_MISMATCH",
          "The Game Session generation fence does not match.",
        );
      }
      if (!sameRelease(rowRelease(session), input.release)) {
        return admissionConflict(
          "RELEASE_SCOPE_MISMATCH",
          "The surface capability does not match the exact Game Release.",
        );
      }
      if (
        !boundedString(input.roomInstanceId, 128)
        || (session.room_instance_id !== null
          && session.room_instance_id !== input.roomInstanceId)
      ) {
        return admissionConflict(
          "ROOM_FENCE_MISMATCH",
          "The Game Session is bound to another Colyseus room.",
        );
      }

      const surfaceResult = await client.query<SurfaceRow>(
        `SELECT capability_id::text,
                surface_id,
                role,
                admitted_at
           FROM thorium_game_session_surfaces
          WHERE game_session_id = $1 AND surface_id = $2
          FOR UPDATE`,
        [input.gameSessionId, input.surfaceId],
      );
      const surface = surfaceResult.rows[0];
      const requestedSlots = normalizePlayerSlots(input.playerSlots);
      const slotResult = surface === undefined
        ? { rows: [] }
        : await client.query<PlayerSlotRow>(
          `SELECT player_slot
             FROM thorium_game_session_player_slots
            WHERE game_session_id = $1 AND surface_id = $2
            ORDER BY player_slot`,
          [input.gameSessionId, input.surfaceId],
        );
      const grantedSlots = slotResult.rows.map((row) => Number(row.player_slot));
      if (
        surface === undefined
        || requestedSlots === null
        || surface.capability_id !== input.capabilityId
        || surface.role !== input.role
        || !sameNumbers(grantedSlots, requestedSlots)
      ) {
        return admissionConflict(
          "SURFACE_SCOPE_MISMATCH",
          "The surface admission does not match its activation grant.",
        );
      }
      if (surface.admitted_at !== null) {
        return admissionConflict(
          "CAPABILITY_REPLAYED",
          "The surface capability has already been admitted.",
        );
      }

      const bound = await client.query(
        `UPDATE thorium_game_sessions
            SET room_instance_id = COALESCE(room_instance_id, $2)
          WHERE game_session_id = $1
            AND status = 'active'
            AND (room_instance_id IS NULL OR room_instance_id = $2)`,
        [input.gameSessionId, input.roomInstanceId],
      );
      if (bound.rowCount !== 1) {
        return admissionConflict(
          "ROOM_FENCE_MISMATCH",
          "The Game Session is bound to another Colyseus room.",
        );
      }

      const admitted = await client.query(
        `UPDATE thorium_game_session_surfaces
            SET admitted_at = clock_timestamp()
          WHERE game_session_id = $1
            AND surface_id = $2
            AND admitted_at IS NULL`,
        [input.gameSessionId, input.surfaceId],
      );
      if (admitted.rowCount !== 1) {
        return admissionConflict(
          "CAPABILITY_REPLAYED",
          "The surface capability has already been admitted.",
        );
      }

      return {
        ok: true,
        admission: {
          gameSessionId: input.gameSessionId,
          generation: input.generation,
          surfaceId: surface.surface_id,
          role: surface.role,
          playerSlots: requestedSlots,
        },
      };
    });
  }

  async finish(input: FinishGameSession): Promise<FinishGameSessionResult> {
    return this.#transaction(async (client) => {
      const sessionResult = await client.query<SessionRow>(
        `SELECT game_session_id::text,
                account_id,
                generation,
                request_fingerprint,
                package_id,
                package_version,
                package_digest,
                status,
                supersedes_game_session_id::text,
                room_instance_id
           FROM thorium_game_sessions
          WHERE game_session_id = $1
          FOR UPDATE`,
        [input.gameSessionId],
      );
      const session = sessionResult.rows[0];
      if (session === undefined) {
        return finishConflict("SESSION_NOT_FOUND", "The Game Session does not exist.");
      }
      if (generationOf(session) !== input.generation) {
        return finishConflict(
          "GENERATION_MISMATCH",
          "The Game Session generation fence does not match.",
        );
      }
      if (session.status === "superseded") {
        return finishConflict(
          "SESSION_SUPERSEDED",
          "A newer Game Session superseded this generation.",
        );
      }
      if (session.room_instance_id !== input.roomInstanceId) {
        return finishConflict(
          "ROOM_FENCE_MISMATCH",
          "Only the bound Colyseus room may finish this Game Session.",
        );
      }
      if (session.status === "finished") {
        return { ok: true, status: "already-finished" };
      }

      const finished = await client.query(
        `UPDATE thorium_game_sessions
            SET status = 'finished',
                finish_reason = $3,
                finished_at = clock_timestamp()
          WHERE game_session_id = $1
            AND generation = $2
            AND status = 'active'`,
        [input.gameSessionId, input.generation, input.reason],
      );
      if (finished.rowCount !== 1) {
        throw new Error("Game Session changed while its row was locked");
      }
      return { ok: true, status: "finished" };
    });
  }

  async isActive(input: GameSessionRoomFence): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      const result = await client.query<ActiveFenceRow>(
        `SELECT EXISTS (
           SELECT 1
             FROM thorium_game_sessions
            WHERE game_session_id = $1
              AND generation = $2
              AND status = 'active'
              AND room_instance_id = $3
         ) AS active`,
        [input.gameSessionId, input.generation, input.roomInstanceId],
      );
      return result.rows[0]?.active === true;
    } finally {
      client.release();
    }
  }

  async #activation(
    client: PostgresPoolClient,
    session: SessionRow,
  ): Promise<GameSessionActivation> {
    const surfaceResult = await client.query<SurfaceWithSlotsRow>(
      `SELECT capability_id::text,
              surfaces.surface_id,
              surfaces.role,
              COALESCE(
                array_agg(slots.player_slot ORDER BY slots.player_slot)
                  FILTER (WHERE slots.player_slot IS NOT NULL),
                ARRAY[]::smallint[]
              ) AS player_slots,
              surfaces.admitted_at
         FROM thorium_game_session_surfaces AS surfaces
         LEFT JOIN thorium_game_session_player_slots AS slots
           ON slots.game_session_id = surfaces.game_session_id
          AND slots.surface_id = surfaces.surface_id
        WHERE surfaces.game_session_id = $1
        GROUP BY surfaces.game_session_id,
                 surfaces.capability_id,
                 surfaces.surface_id,
                 surfaces.role,
                 surfaces.admitted_at
        ORDER BY CASE surfaces.role WHEN 'main' THEN 0 ELSE 1 END,
                 surfaces.surface_id`,
      [session.game_session_id],
    );
    const surfaces: readonly GameSessionSurfaceGrant[] = surfaceResult.rows.map(
      (surface) => ({
        capabilityId: surface.capability_id,
        surfaceId: surface.surface_id,
        role: surface.role,
        playerSlots: playerSlotsOf(surface),
      }),
    );
    return {
      gameSessionId: session.game_session_id,
      generation: generationOf(session),
      release: rowRelease(session),
      surfaces,
      ...(session.supersedes_game_session_id === null
        ? {}
        : { supersededGameSessionId: session.supersedes_game_session_id }),
    };
  }

  async #transaction<Result>(
    execute: (client: PostgresPoolClient) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await execute(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the transaction's original error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function normalizeActivation(input: ActivateGameSession): NormalizedActivation | null {
  if (
    !boundedString(input.requestId, 128)
    || !boundedString(input.accountId, 128)
    || !validRelease(input.release)
    || !Array.isArray(input.surfaces)
    || input.surfaces.length < 1
    || input.surfaces.length > 2
  ) {
    return null;
  }

  const surfaceIds = new Set<string>();
  const roles = new Set<string>();
  const leasedSlots = new Set<number>();
  const surfaces: NormalizedSurface[] = [];
  for (const surface of input.surfaces) {
    if (typeof surface !== "object" || surface === null) {
      return null;
    }
    const playerSlots = normalizePlayerSlots(surface.playerSlots);
    if (
      typeof surface.surfaceId !== "string"
      || !surfaceIdPattern.test(surface.surfaceId)
      || (surface.role !== "main" && surface.role !== "companion")
      || playerSlots === null
      || surfaceIds.has(surface.surfaceId)
      || roles.has(surface.role)
      || playerSlots.some((slot) => leasedSlots.has(slot))
    ) {
      return null;
    }
    surfaceIds.add(surface.surfaceId);
    roles.add(surface.role);
    playerSlots.forEach((slot) => leasedSlots.add(slot));
    surfaces.push({
      surfaceId: surface.surfaceId,
      role: surface.role,
      playerSlots,
    });
  }
  if (leasedSlots.size === 0) {
    return null;
  }

  surfaces.sort((left, right) =>
    roleOrder[left.role] - roleOrder[right.role]
    || left.surfaceId.localeCompare(right.surfaceId));
  return {
    requestId: input.requestId,
    accountId: input.accountId,
    release: {
      packageId: input.release.packageId,
      version: input.release.version,
      contentDigest: input.release.contentDigest,
    },
    surfaces,
  };
}

function normalizePlayerSlots(slots: readonly number[]): readonly number[] | null {
  if (
    !Array.isArray(slots)
    || slots.length > 16
    || slots.some((slot) => !Number.isInteger(slot) || slot < 0 || slot > 15)
    || new Set(slots).size !== slots.length
  ) {
    return null;
  }
  return [...slots].sort((left, right) => left - right);
}

function validRelease(release: ExactGameRelease): boolean {
  return typeof release === "object"
    && release !== null
    && typeof release.packageId === "string"
    && release.packageId.length <= 128
    && /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(release.packageId)
    && typeof release.version === "string"
    && release.version.length <= 64
    && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(release.version)
    && typeof release.contentDigest === "string"
    && /^[a-f0-9]{64}$/.test(release.contentDigest);
}

function activationFingerprint(input: NormalizedActivation): string {
  return createHash("sha256").update(JSON.stringify({
    release: input.release,
    surfaces: input.surfaces,
  })).digest("hex");
}

function rowRelease(session: SessionRow): ExactGameRelease {
  return {
    packageId: session.package_id,
    version: session.package_version,
    contentDigest: session.package_digest,
  };
}

function sameRelease(left: ExactGameRelease, right: ExactGameRelease): boolean {
  return validRelease(left)
    && validRelease(right)
    && left.packageId === right.packageId
    && left.version === right.version
    && left.contentDigest === right.contentDigest;
}

function playerSlotsOf(surface: SurfaceWithSlotsRow): readonly number[] {
  if (!Array.isArray(surface.player_slots)) {
    throw new Error("PostgreSQL returned an invalid Player Slot array");
  }
  const slots = normalizePlayerSlots(surface.player_slots as unknown[] as number[]);
  if (slots === null) {
    throw new Error("PostgreSQL returned invalid Player Slots");
  }
  return slots;
}

function generationOf(row: { readonly generation: string | number }): number {
  const generation = typeof row.generation === "string"
    ? Number(row.generation)
    : row.generation;
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("PostgreSQL returned an invalid Game Session generation");
  }
  return generation;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requiredRow<Row extends Record<string, unknown>>(
  result: PostgresQueryResult<Row>,
  label: string,
): Row {
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`PostgreSQL did not return the ${label}`);
  }
  return row;
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function activationConflict(
  code: "INVALID_ACTIVATION" | "REQUEST_ID_REUSED" | "REQUEST_NO_LONGER_ACTIVE",
  message: string,
): ActivateGameSessionResult {
  return { ok: false, conflict: { code, message } };
}

function admissionConflict(
  code:
    | "SESSION_NOT_ACTIVE"
    | "GENERATION_MISMATCH"
    | "RELEASE_SCOPE_MISMATCH"
    | "SURFACE_SCOPE_MISMATCH"
    | "ROOM_FENCE_MISMATCH"
    | "CAPABILITY_REPLAYED",
  message: string,
): AdmitGameSessionSurfaceResult {
  return { ok: false, conflict: { code, message } };
}

function finishConflict(
  code:
    | "SESSION_NOT_FOUND"
    | "GENERATION_MISMATCH"
    | "ROOM_FENCE_MISMATCH"
    | "SESSION_SUPERSEDED",
  message: string,
): FinishGameSessionResult {
  return { ok: false, conflict: { code, message } };
}
