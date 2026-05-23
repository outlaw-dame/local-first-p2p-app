import Dexie, { type Table } from 'dexie';
import { type EncryptedKeyMaterial } from '@lfp2p/crypto';
import { type SignedEventEnvelope, validateSignedEvent } from '@lfp2p/protocol';

export type OutboxStatus = 'pending' | 'syncing' | 'confirmed' | 'failed' | 'conflicted';
export type DeviceIdentityStatus = 'active' | 'revoked';
export type LocalFirstTableName =
  | 'signedEvents'
  | 'mutationOutbox'
  | 'eventSummaries'
  | 'deviceIdentities'
  | 'localProtectionKeys';

export type StoredSignedEvent = Readonly<{
  eventId: string;
  kind: string;
  author: string;
  createdAt: string;
  event: SignedEventEnvelope;
}>;

export type MutationOutboxEntry = Readonly<{
  idempotencyKey: string;
  eventId: string;
  target: string;
  status: OutboxStatus;
  retryCount: number;
  nextRetryAt: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}>;

export type RecoverStaleOutboxClaimsInput = Readonly<{
  staleBefore: string;
  nextRetryAt: string;
  updatedAt?: string;
  lastError?: string;
  limit?: number;
}>;

export type OutboxStatusCounts = Readonly<Record<OutboxStatus, number>>;

export type EventSummaryView = Readonly<{
  eventId: string;
  title: string;
  subtitle: string;
  createdAt: string;
}>;

export type StoredDeviceIdentity = Readonly<{
  recordType: 'local-device-identity.v1';
  identityId: string;
  deviceId: string;
  publicKey: string;
  encryptedPrivateKey: EncryptedKeyMaterial;
  protectionKeyId: string;
  status: DeviceIdentityStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type StoredLocalProtectionKey = Readonly<{
  keyId: string;
  algorithm: 'aes-gcm-256';
  key: CryptoKey;
  createdAt: string;
}>;

type OutboxStatusPatch = Readonly<{
  updatedAt?: string;
  lastError?: string;
}>;

class LocalFirstP2PDatabase extends Dexie {
  signedEvents!: Table<StoredSignedEvent, string>;
  mutationOutbox!: Table<MutationOutboxEntry, string>;
  eventSummaries!: Table<EventSummaryView, string>;
  deviceIdentities!: Table<StoredDeviceIdentity, string>;
  localProtectionKeys!: Table<StoredLocalProtectionKey, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt',
      eventSummaries: 'eventId, createdAt'
    });
    this.version(2).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt'
    });
    this.version(3).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt, [status+nextRetryAt]',
      eventSummaries: 'eventId, createdAt',
      deviceIdentities: 'identityId, deviceId, publicKey, status, createdAt',
      localProtectionKeys: 'keyId, algorithm, createdAt'
    });
  }
}

export class DexieLocalFirstStore {
  readonly #db: LocalFirstP2PDatabase;

  constructor(databaseName = 'lfp2p-local-store') {
    this.#db = new LocalFirstP2PDatabase(databaseName);
  }

  async putSignedEvent(event: SignedEventEnvelope): Promise<void> {
    validateSignedEvent(event);
    await this.#db.signedEvents.put({
      eventId: event.eventId,
      kind: event.kind,
      author: event.author,
      createdAt: event.createdAt,
      event
    });
  }

  async getSignedEvent(eventId: string): Promise<SignedEventEnvelope | undefined> {
    return (await this.#db.signedEvents.get(eventId))?.event;
  }

  async listSignedEvents(limit = 50): Promise<StoredSignedEvent[]> {
    return this.#db.signedEvents.orderBy('createdAt').reverse().limit(limit).toArray();
  }

  async enqueueOutbox(entry: MutationOutboxEntry): Promise<void> {
    validateOutboxEntry(entry);
    await this.#db.mutationOutbox.put(entry);
  }

  async getOutboxEntry(idempotencyKey: string): Promise<MutationOutboxEntry | undefined> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    return this.#db.mutationOutbox.get(idempotencyKey);
  }

  async listPendingOutbox(limit = 50): Promise<MutationOutboxEntry[]> {
    return this.#db.mutationOutbox.where('status').equals('pending').limit(limit).toArray();
  }

  async listDueOutbox(now = new Date().toISOString(), limit = 50): Promise<MutationOutboxEntry[]> {
    requireIsoDate(now, 'now');
    requirePositiveInteger(limit, 'limit');
    return this.#db.mutationOutbox
      .where('[status+nextRetryAt]')
      .between(['pending', ''], ['pending', now], true, true)
      .limit(limit)
      .toArray();
  }

  async claimOutboxEntry(idempotencyKey: string, updatedAt = new Date().toISOString()): Promise<MutationOutboxEntry | undefined> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    requireIsoDate(updatedAt, 'updatedAt');
    return this.transaction('rw', ['mutationOutbox'], async () => {
      const entry = await this.#db.mutationOutbox.get(idempotencyKey);
      if (!entry || entry.status !== 'pending') return undefined;
      const claimed: MutationOutboxEntry = {
        ...entry,
        status: 'syncing',
        updatedAt
      };
      await this.#db.mutationOutbox.put(claimed);
      return claimed;
    });
  }

  async markOutboxConfirmed(idempotencyKey: string, updatedAt = new Date().toISOString()): Promise<void> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    requireIsoDate(updatedAt, 'updatedAt');
    await this.transaction('rw', ['mutationOutbox'], async () => {
      const entry = await this.#db.mutationOutbox.get(idempotencyKey);
      if (!entry) return;
      const confirmed: MutationOutboxEntry = {
        idempotencyKey: entry.idempotencyKey,
        eventId: entry.eventId,
        target: entry.target,
        status: 'confirmed',
        retryCount: entry.retryCount,
        nextRetryAt: entry.nextRetryAt,
        createdAt: entry.createdAt,
        updatedAt
      };
      await this.#db.mutationOutbox.put(confirmed);
    });
  }

  async markOutboxConflicted(
    idempotencyKey: string,
    lastError: string,
    updatedAt = new Date().toISOString()
  ): Promise<void> {
    await this.updateOutboxStatus(idempotencyKey, 'conflicted', { updatedAt, lastError });
  }

  async markOutboxFailed(
    idempotencyKey: string,
    lastError: string,
    updatedAt = new Date().toISOString()
  ): Promise<void> {
    await this.updateOutboxStatus(idempotencyKey, 'failed', { updatedAt, lastError });
  }

  async scheduleOutboxRetry(input: {
    idempotencyKey: string;
    retryCount: number;
    nextRetryAt: string;
    lastError: string;
    updatedAt?: string;
  }): Promise<void> {
    requireNonEmpty(input.idempotencyKey, 'idempotencyKey');
    requireNonNegativeInteger(input.retryCount, 'retryCount');
    requireIsoDate(input.nextRetryAt, 'nextRetryAt');
    requireNonEmpty(input.lastError, 'lastError');
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    requireIsoDate(updatedAt, 'updatedAt');
    await this.#db.mutationOutbox.update(input.idempotencyKey, {
      status: 'pending',
      retryCount: input.retryCount,
      nextRetryAt: input.nextRetryAt,
      lastError: input.lastError,
      updatedAt
    });
  }

  async recoverStaleOutboxClaims(input: RecoverStaleOutboxClaimsInput): Promise<number> {
    requireIsoDate(input.staleBefore, 'staleBefore');
    requireIsoDate(input.nextRetryAt, 'nextRetryAt');
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    requireIsoDate(updatedAt, 'updatedAt');
    const lastError = input.lastError ?? 'Recovered stale outbox claim';
    requireNonEmpty(lastError, 'lastError');
    const limit = input.limit === undefined ? 50 : requirePositiveInteger(input.limit, 'limit');
    const staleBeforeMs = Date.parse(input.staleBefore);

    return this.transaction('rw', ['mutationOutbox'], async () => {
      const staleEntries = await this.#db.mutationOutbox
        .where('status')
        .equals('syncing')
        .filter((entry) => Date.parse(entry.updatedAt) <= staleBeforeMs)
        .limit(limit)
        .toArray();

      if (staleEntries.length === 0) return 0;

      await this.#db.mutationOutbox.bulkPut(
        staleEntries.map((entry) => ({
          ...entry,
          status: 'pending' as const,
          retryCount: entry.retryCount + 1,
          nextRetryAt: input.nextRetryAt,
          updatedAt,
          lastError
        }))
      );
      return staleEntries.length;
    });
  }

  async countOutboxByStatus(): Promise<OutboxStatusCounts> {
    const [pending, syncing, confirmed, failed, conflicted] = await Promise.all([
      this.#db.mutationOutbox.where('status').equals('pending').count(),
      this.#db.mutationOutbox.where('status').equals('syncing').count(),
      this.#db.mutationOutbox.where('status').equals('confirmed').count(),
      this.#db.mutationOutbox.where('status').equals('failed').count(),
      this.#db.mutationOutbox.where('status').equals('conflicted').count()
    ]);
    return { pending, syncing, confirmed, failed, conflicted };
  }

  async putEventSummary(summary: EventSummaryView): Promise<void> {
    await this.#db.eventSummaries.put(summary);
  }

  async listEventSummaries(limit = 50): Promise<EventSummaryView[]> {
    return this.#db.eventSummaries.orderBy('createdAt').reverse().limit(limit).toArray();
  }

  async putDeviceIdentity(identity: StoredDeviceIdentity): Promise<void> {
    validateDeviceIdentity(identity);
    await this.#db.deviceIdentities.put(identity);
  }

  async getActiveDeviceIdentity(): Promise<StoredDeviceIdentity | undefined> {
    return this.#db.deviceIdentities.where('status').equals('active').first();
  }

  async putLocalProtectionKey(key: StoredLocalProtectionKey): Promise<void> {
    await this.#db.localProtectionKeys.put(key);
  }

  async getLocalProtectionKey(keyId: string): Promise<StoredLocalProtectionKey | undefined> {
    return this.#db.localProtectionKeys.get(keyId);
  }

  async transaction<T>(
    mode: 'r' | 'rw',
    tables: readonly LocalFirstTableName[],
    callback: () => Promise<T>
  ): Promise<T> {
    const resolvedTables = tables.map((table) => this.#resolveTable(table));
    return this.#db.transaction(mode, resolvedTables, callback);
  }

  async close(): Promise<void> {
    this.#db.close();
  }

  async delete(): Promise<void> {
    await this.#db.delete();
  }

  async updateOutboxStatus(idempotencyKey: string, status: OutboxStatus, patch: OutboxStatusPatch): Promise<void> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    if (patch.updatedAt !== undefined) requireIsoDate(patch.updatedAt, 'updatedAt');
    if (patch.lastError !== undefined) requireNonEmpty(patch.lastError, 'lastError');
    await this.#db.mutationOutbox.update(idempotencyKey, { status, ...patch });
  }

  #resolveTable(table: LocalFirstTableName): Table {
    switch (table) {
      case 'signedEvents':
        return this.#db.signedEvents;
      case 'mutationOutbox':
        return this.#db.mutationOutbox;
      case 'eventSummaries':
        return this.#db.eventSummaries;
      case 'deviceIdentities':
        return this.#db.deviceIdentities;
      case 'localProtectionKeys':
        return this.#db.localProtectionKeys;
    }
  }
}

export function createLocalFirstStore(databaseName?: string): DexieLocalFirstStore {
  return new DexieLocalFirstStore(databaseName);
}

function validateOutboxEntry(entry: MutationOutboxEntry): void {
  requireNonEmpty(entry.idempotencyKey, 'idempotencyKey');
  requireNonEmpty(entry.eventId, 'eventId');
  requireNonEmpty(entry.target, 'target');
  requireNonNegativeInteger(entry.retryCount, 'retryCount');
  requireIsoDate(entry.nextRetryAt, 'nextRetryAt');
  requireIsoDate(entry.createdAt, 'createdAt');
  requireIsoDate(entry.updatedAt, 'updatedAt');
  if (entry.lastError !== undefined) requireNonEmpty(entry.lastError, 'lastError');
}

function validateDeviceIdentity(identity: StoredDeviceIdentity): void {
  if (identity.recordType !== 'local-device-identity.v1') {
    throw new Error('Unsupported device identity record type');
  }
  if (identity.identityId.trim().length === 0) throw new Error('identityId is required');
  if (identity.deviceId.trim().length === 0) throw new Error('deviceId is required');
  if (identity.publicKey.trim().length === 0) throw new Error('publicKey is required');
  if (identity.protectionKeyId.trim().length === 0) throw new Error('protectionKeyId is required');
}

function validateLocalProtectionKey(key: StoredLocalProtectionKey): void {
  if (key.algorithm !== 'aes-gcm-256') throw new Error('Unsupported protection key algorithm');
  if (key.keyId.trim().length === 0) throw new Error('keyId is required');
}

function requireNonEmpty(value: string, label: string): string {
  if (value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function requireIsoDate(value: string, label: string): string {
  requireNonEmpty(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date string`);
  return value;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}
