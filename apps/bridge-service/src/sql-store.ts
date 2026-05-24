import { PGlite } from '@electric-sql/pglite';
import {
  type BridgeStore,
  type BridgeStoreListInput,
  type BridgeStorePutResult,
  type BridgeStoreSnapshot,
  type PgliteBridgeStoreOptions,
  type StoredBridgeRecord,
  type StoredBridgeRecordDraft
} from './types.js';
import {
  DEFAULT_MAX_RECORDS,
  DEFAULT_TTL_MS,
  nextSequence,
  requireNonEmpty,
  requirePositiveInteger,
  requireSafeNonNegativeInteger,
  validateStoredBridgeRecord,
  validateStoredBridgeRecordDraft,
  withAllocatedSequence
} from './utils.js';

type BridgeRecordRow = Readonly<{
  idempotency_key: string;
  target: string;
  event_id: string;
  author: string;
  privacy: 'dm' | 'group' | 'public';
  sequence: number | string;
  accepted_at: string;
  expires_at: string;
  event_json: string | null;
}>;

type CountRow = Readonly<{ count: number | string }>;
type SequenceRow = Readonly<{ latest_sequence: number | string }>;

type BridgeSqlExecutor = Readonly<{
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}>;

const SEQUENCE_ROW_ID = 'bridge';

export class PgliteBridgeStore implements BridgeStore {
  readonly #db: PGlite;
  readonly #initialSequence: number;
  #initialized = false;
  #lock: Promise<void> = Promise.resolve();

  readonly kind = 'pglite' as const;
  readonly maxRecords: number;
  readonly ttlMs: number;

  constructor(options: PgliteBridgeStoreOptions = {}) {
    this.#db = options.dataDir === undefined ? new PGlite() : new PGlite(options.dataDir);
    this.maxRecords = requirePositiveInteger(options.maxRecords ?? DEFAULT_MAX_RECORDS, 'maxRecords');
    this.ttlMs = requirePositiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, 'ttlMs');
    this.#initialSequence = requireSafeNonNegativeInteger(
      options.initialSequence ?? Math.min(Date.now() * 1000, Number.MAX_SAFE_INTEGER - 1),
      'initialSequence'
    );
  }

  async get(idempotencyKey: string, nowMs: number): Promise<StoredBridgeRecord | undefined> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    return this.#withLock(async () => {
      await this.#init();
      await this.#pruneExpired(nowMs);
      return this.#getRecord(idempotencyKey);
    });
  }

  async putIfAbsent(record: StoredBridgeRecordDraft, nowMs: number): Promise<BridgeStorePutResult> {
    validateStoredBridgeRecordDraft(record);
    return this.#withLock(async () => {
      await this.#init();
      return this.#db.transaction(async (tx) => {
        await this.#pruneExpired(nowMs, tx);
        const existing = await this.#getRecord(record.idempotencyKey, tx);
        if (existing) return { status: 'existing', record: existing };

        await this.#evictToCapacity(tx);
        const sequence = await this.#reserveSequence(nowMs, tx);
        const stored = withAllocatedSequence(record, sequence);
        await tx.query(
          `INSERT INTO bridge_records (
             idempotency_key, target, event_id, author, privacy, sequence, accepted_at, expires_at, event_json
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
          [
            stored.idempotencyKey,
            stored.target,
            stored.eventId,
            stored.author,
            stored.privacy,
            stored.sequence,
            stored.acceptedAt,
            stored.expiresAt,
            JSON.stringify(stored.event)
          ]
        );
        return { status: 'inserted', record: stored };
      });
    });
  }

  async listAfter(input: BridgeStoreListInput, nowMs: number): Promise<readonly StoredBridgeRecord[]> {
    const target = requireNonEmpty(input.target, 'target');
    const afterSequence = requireSafeNonNegativeInteger(input.afterSequence, 'afterSequence');
    const limit = requirePositiveInteger(input.limit, 'limit');
    return this.#withLock(async () => {
      await this.#init();
      await this.#pruneExpired(nowMs);
      const result = await this.#db.query<BridgeRecordRow>(
        `SELECT idempotency_key, target, event_id, author, privacy, sequence, accepted_at, expires_at, event_json
         FROM bridge_records
         WHERE target = $1 AND sequence > $2 AND event_json IS NOT NULL
         ORDER BY sequence ASC
         LIMIT $3;`,
        [target, afterSequence, limit]
      );
      return result.rows.map(rowToRecord);
    });
  }

  async pruneExpired(nowMs: number): Promise<void> {
    await this.#withLock(async () => {
      await this.#init();
      await this.#pruneExpired(nowMs);
    });
  }

  async snapshot(nowMs: number): Promise<BridgeStoreSnapshot> {
    return this.#withLock(async () => {
      await this.#init();
      await this.#pruneExpired(nowMs);
      const countResult = await this.#db.query<CountRow>('SELECT COUNT(*) AS count FROM bridge_records;');
      const sequenceResult = await this.#db.query<SequenceRow>(
        'SELECT latest_sequence FROM bridge_sequence WHERE id = $1;',
        [SEQUENCE_ROW_ID]
      );
      return {
        storeKind: this.kind,
        acceptedCount: Number(countResult.rows[0]?.count ?? 0),
        maxRecords: this.maxRecords,
        ttlMs: this.ttlMs,
        latestSequence: requireSafeNonNegativeInteger(
          Number(sequenceResult.rows[0]?.latest_sequence ?? this.#initialSequence),
          'latestSequence'
        )
      };
    });
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(operation, operation);
    this.#lock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async #init(): Promise<void> {
    if (this.#initialized) return;
    await this.#db.query(`
      CREATE TABLE IF NOT EXISTS bridge_sequence (
        id TEXT PRIMARY KEY,
        latest_sequence BIGINT NOT NULL
      );
    `);
    await this.#db.query(`
      CREATE TABLE IF NOT EXISTS bridge_records (
        idempotency_key TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        event_id TEXT NOT NULL,
        author TEXT NOT NULL,
        privacy TEXT NOT NULL CHECK (privacy IN ('dm', 'group', 'public')),
        sequence BIGINT NOT NULL,
        accepted_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    await this.#db.query('ALTER TABLE bridge_records ADD COLUMN IF NOT EXISTS event_json TEXT;');
    await this.#db.query('CREATE INDEX IF NOT EXISTS bridge_records_expires_at_idx ON bridge_records (expires_at);');
    await this.#db.query('CREATE INDEX IF NOT EXISTS bridge_records_sequence_idx ON bridge_records (sequence);');
    await this.#db.query('CREATE INDEX IF NOT EXISTS bridge_records_target_sequence_idx ON bridge_records (target, sequence);');
    await this.#db.query(
      `INSERT INTO bridge_sequence (id, latest_sequence)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET
         latest_sequence = GREATEST(bridge_sequence.latest_sequence, excluded.latest_sequence);`,
      [SEQUENCE_ROW_ID, this.#initialSequence]
    );
    this.#initialized = true;
  }

  async #getRecord(
    idempotencyKey: string,
    executor: BridgeSqlExecutor = this.#db
  ): Promise<StoredBridgeRecord | undefined> {
    const result = await executor.query<BridgeRecordRow>(
      `SELECT idempotency_key, target, event_id, author, privacy, sequence, accepted_at, expires_at, event_json
       FROM bridge_records
       WHERE idempotency_key = $1
       LIMIT 1;`,
      [idempotencyKey]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : rowToRecord(row);
  }

  async #pruneExpired(nowMs: number, executor: BridgeSqlExecutor = this.#db): Promise<void> {
    await executor.query('DELETE FROM bridge_records WHERE expires_at <= $1;', [new Date(nowMs).toISOString()]);
  }

  async #evictToCapacity(executor: BridgeSqlExecutor = this.#db): Promise<void> {
    const countResult = await executor.query<CountRow>('SELECT COUNT(*) AS count FROM bridge_records;');
    const count = Number(countResult.rows[0]?.count ?? 0);
    const deleteCount = count - (this.maxRecords - 1);
    if (deleteCount <= 0) return;
    await executor.query(
      `DELETE FROM bridge_records
       WHERE idempotency_key IN (
         SELECT idempotency_key
         FROM bridge_records
         ORDER BY sequence ASC
         LIMIT $1
       );`,
      [deleteCount]
    );
  }

  async #reserveSequence(nowMs: number, executor: BridgeSqlExecutor = this.#db): Promise<number> {
    const currentResult = await executor.query<SequenceRow>(
      'SELECT latest_sequence FROM bridge_sequence WHERE id = $1;',
      [SEQUENCE_ROW_ID]
    );
    const current = requireSafeNonNegativeInteger(
      Number(currentResult.rows[0]?.latest_sequence ?? this.#initialSequence),
      'latestSequence'
    );
    const sequence = nextSequence(current, nowMs);
    await executor.query('UPDATE bridge_sequence SET latest_sequence = $2 WHERE id = $1;', [SEQUENCE_ROW_ID, sequence]);
    return sequence;
  }
}

function rowToRecord(row: BridgeRecordRow): StoredBridgeRecord {
  return validateStoredBridgeRecord({
    idempotencyKey: row.idempotency_key,
    target: row.target,
    eventId: row.event_id,
    author: row.author,
    privacy: row.privacy,
    sequence: requireSafeNonNegativeInteger(Number(row.sequence), 'record.sequence'),
    acceptedAt: row.accepted_at,
    expiresAt: row.expires_at,
    ...(row.event_json === null ? {} : { event: JSON.parse(row.event_json) as StoredBridgeRecord['event'] })
  });
}
