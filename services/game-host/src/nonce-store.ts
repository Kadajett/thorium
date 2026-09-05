import { DatabaseSync } from "node:sqlite";

export interface NonceStore {
  consume(id: string, expiresAtEpochSeconds: number, nowEpochSeconds: number): void;
  close?(): void;
}

export class MemoryNonceStore implements NonceStore {
  readonly #entries = new Map<string, number>();

  consume(id: string, expiresAtEpochSeconds: number, nowEpochSeconds: number): void {
    for (const [nonce, expiry] of this.#entries) {
      if (expiry <= nowEpochSeconds) this.#entries.delete(nonce);
    }
    if (
      expiresAtEpochSeconds <= nowEpochSeconds || this.#entries.has(id)
      || this.#entries.size >= 100_000
    ) throw new Error("capability_expired_replayed_or_at_capacity");
    this.#entries.set(id, expiresAtEpochSeconds);
  }
}

export class SqliteNonceStore implements NonceStore {
  readonly #database: DatabaseSync;

  constructor(file: string) {
    this.#database = new DatabaseSync(file);
    this.#database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS host_admission_nonce (
        id TEXT PRIMARY KEY,
        expires INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS host_admission_nonce_expiry
        ON host_admission_nonce(expires)
    `);
  }

  consume(id: string, expiresAtEpochSeconds: number, nowEpochSeconds: number): void {
    if (expiresAtEpochSeconds <= nowEpochSeconds) {
      throw new Error("capability_expired_replayed_or_at_capacity");
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database.prepare("DELETE FROM host_admission_nonce WHERE expires <= ?")
        .run(nowEpochSeconds);
      const row = this.#database.prepare("SELECT COUNT(*) AS count FROM host_admission_nonce")
        .get() as { count: number };
      if (row.count >= 100_000) throw new Error("admission_capacity");
      this.#database.prepare("INSERT INTO host_admission_nonce(id, expires) VALUES (?, ?)")
        .run(id, expiresAtEpochSeconds);
      this.#database.exec("COMMIT");
    } catch {
      this.#database.exec("ROLLBACK");
      throw new Error("capability_expired_replayed_or_at_capacity");
    }
  }

  close(): void {
    this.#database.close();
  }
}
