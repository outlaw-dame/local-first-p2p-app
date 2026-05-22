import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  type BridgeStore,
  type BridgeStorePutResult,
  type BridgeStoreSnapshot,
  type InMemoryBridgeStoreOptions,
  type JsonBridgeStoreState,
  type JsonFileBridgeStoreOptions,
  type MutableJsonBridgeStoreState,
  type StoredBridgeRecord,
  type StoredBridgeRecordDraft
} from './types.js';
import {
  DEFAULT_MAX_RECORDS,
  DEFAULT_TTL_MS,
  isNotFoundError,
  mutableState,
  nextSequence,
  nextSequenceForState,
  pruneExpiredRecords,
  requireNonEmpty,
  requirePositiveInteger,
  requireSafeNonNegativeInteger,
  validateJsonBridgeStoreState,
  validateStoredBridgeRecordDraft,
  withAllocatedSequence
} from './utils.js';

export class InMemoryBridgeStore implements BridgeStore {
  readonly #recordsByIdempotencyKey = new Map<string, StoredBridgeRecord>();
  #sequence: number;

  readonly kind = 'memory' as const;
  readonly maxRecords: number;
  readonly ttlMs: number;

  constructor(options: InMemoryBridgeStoreOptions = {}) {
    this.maxRecords = requirePositiveInteger(options.maxRecords ?? DEFAULT_MAX_RECORDS, 'maxRecords');
    this.ttlMs = requirePositiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, 'ttlMs');
    this.#sequence = requireSafeNonNegativeInteger(
      options.initialSequence ?? Math.min(Date.now() * 1000, Number.MAX_SAFE_INTEGER - 1),
      'initialSequence'
    );
  }

  async get(idempotencyKey: string, nowMs: number): Promise<StoredBridgeRecord | undefined> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    this.#evictExpired(nowMs);
    return this.#recordsByIdempotencyKey.get(idempotencyKey);
  }

  async putIfAbsent(record: StoredBridgeRecordDraft, nowMs: number): Promise<BridgeStorePutResult> {
    validateStoredBridgeRecordDraft(record);
    this.#evictExpired(nowMs);
    const existing = this.#recordsByIdempotencyKey.get(record.idempotencyKey);
    if (existing) return { status: 'existing', record: existing };
    this.#evictToCapacity();
    const stored = withAllocatedSequence(record, this.#nextSequence(nowMs));
    this.#recordsByIdempotencyKey.set(stored.idempotencyKey, stored);
    return { status: 'inserted', record: stored };
  }

  async pruneExpired(nowMs: number): Promise<void> {
    this.#evictExpired(nowMs);
  }

  async snapshot(nowMs: number): Promise<BridgeStoreSnapshot> {
    this.#evictExpired(nowMs);
    return {
      storeKind: this.kind,
      acceptedCount: this.#recordsByIdempotencyKey.size,
      maxRecords: this.maxRecords,
      ttlMs: this.ttlMs,
      latestSequence: this.#sequence
    };
  }

  #nextSequence(nowMs: number): number {
    this.#sequence = nextSequence(this.#sequence, nowMs);
    return this.#sequence;
  }

  #evictExpired(nowMs: number): void {
    for (const [idempotencyKey, record] of this.#recordsByIdempotencyKey) {
      if (Date.parse(record.expiresAt) > nowMs) continue;
      this.#recordsByIdempotencyKey.delete(idempotencyKey);
    }
  }

  #evictToCapacity(): void {
    while (this.#recordsByIdempotencyKey.size >= this.maxRecords) {
      const oldestKey = this.#recordsByIdempotencyKey.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.#recordsByIdempotencyKey.delete(oldestKey);
    }
  }
}

export class JsonFileBridgeStore implements BridgeStore {
  readonly kind = 'json-file' as const;
  readonly filePath: string;
  readonly maxRecords: number;
  readonly ttlMs: number;
  readonly #initialSequence: number;
  readonly #tempFileSuffix: string;
  #state: JsonBridgeStoreState | undefined;
  #lock: Promise<void> = Promise.resolve();

  constructor(options: JsonFileBridgeStoreOptions) {
    this.filePath = requireNonEmpty(options.filePath, 'filePath');
    this.maxRecords = requirePositiveInteger(options.maxRecords ?? DEFAULT_MAX_RECORDS, 'maxRecords');
    this.ttlMs = requirePositiveInteger(options.ttlMs ?? DEFAULT_TTL_MS, 'ttlMs');
    this.#initialSequence = requireSafeNonNegativeInteger(
      options.initialSequence ?? Math.min(Date.now() * 1000, Number.MAX_SAFE_INTEGER - 1),
      'initialSequence'
    );
    this.#tempFileSuffix = options.tempFileSuffix ?? '.tmp';
  }

  async get(idempotencyKey: string, nowMs: number): Promise<StoredBridgeRecord | undefined> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    return this.#withLock(async () => {
      const state = await this.#loadCachedState();
      this.#pruneCachedStateOnly(state, nowMs);
      return state.records.find((record) => record.idempotencyKey === idempotencyKey);
    });
  }

  async putIfAbsent(record: StoredBridgeRecordDraft, nowMs: number): Promise<BridgeStorePutResult> {
    validateStoredBridgeRecordDraft(record);
    return this.#withLock(async () => {
      const state = await this.#loadFreshState();
      pruneExpiredRecords(state, nowMs);
      const existing = state.records.find((candidate) => candidate.idempotencyKey === record.idempotencyKey);
      if (existing) {
        await this.#persistState(state);
        return { status: 'existing', record: existing };
      }
      while (state.records.length >= this.maxRecords) state.records.shift();
      const stored = withAllocatedSequence(record, nextSequenceForState(state, nowMs));
      state.records.push(stored);
      await this.#persistState(state);
      return { status: 'inserted', record: stored };
    });
  }

  async pruneExpired(nowMs: number): Promise<void> {
    await this.#withLock(async () => {
      const state = await this.#loadFreshState();
      if (pruneExpiredRecords(state, nowMs)) await this.#persistState(state);
      else this.#setCachedState(state);
    });
  }

  async snapshot(nowMs: number): Promise<BridgeStoreSnapshot> {
    return this.#withLock(async () => {
      const state = await this.#loadCachedState();
      this.#pruneCachedStateOnly(state, nowMs);
      return {
        storeKind: this.kind,
        acceptedCount: state.records.length,
        maxRecords: this.maxRecords,
        ttlMs: this.ttlMs,
        latestSequence: state.latestSequence
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

  async #loadCachedState(): Promise<MutableJsonBridgeStoreState> {
    if (this.#state !== undefined) return mutableState(this.#state);
    return this.#loadFreshState();
  }

  async #loadFreshState(): Promise<MutableJsonBridgeStoreState> {
    try {
      const state = validateJsonBridgeStoreState(JSON.parse(await readFile(this.filePath, 'utf8')), this.#initialSequence);
      this.#setCachedState(state);
      return mutableState(state);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      const state: JsonBridgeStoreState = {
        recordType: 'lfp2p.bridge.store.v1',
        latestSequence: this.#initialSequence,
        records: []
      };
      await this.#persistState(state);
      return mutableState(state);
    }
  }

  #pruneCachedStateOnly(state: MutableJsonBridgeStoreState, nowMs: number): void {
    if (pruneExpiredRecords(state, nowMs)) this.#setCachedState(state);
  }

  #setCachedState(state: JsonBridgeStoreState): void {
    this.#state = {
      recordType: 'lfp2p.bridge.store.v1',
      latestSequence: state.latestSequence,
      records: [...state.records]
    };
  }

  async #persistState(state: JsonBridgeStoreState): Promise<void> {
    this.#setCachedState(state);
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}${this.#tempFileSuffix}`;
    await writeFile(tempPath, `${JSON.stringify(this.#state)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }
}
