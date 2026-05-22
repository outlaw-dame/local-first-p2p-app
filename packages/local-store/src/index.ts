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
    if (entry.idempotencyKey.trim().length === 0) throw new Error('idempotencyKey is required');
    await this.#db.mutationOutbox.put(entry);
  }

  async listPendingOutbox(limit = 50): Promise<MutationOutboxEntry[]> {
    return this.#db.mutationOutbox.where('status').equals('pending').limit(limit).toArray();
  }

  async markOutboxConfirmed(idempotencyKey: string, updatedAt = new Date().toISOString()): Promise<void> {
    await this.#db.mutationOutbox.update(idempotencyKey, { status: 'confirmed', updatedAt });
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
    validateLocalProtectionKey(key);
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
