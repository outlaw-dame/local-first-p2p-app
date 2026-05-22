import Dexie, { type Table } from 'dexie';
import { type SignedEventEnvelope, validateSignedEvent } from '@lfp2p/protocol';

export type OutboxStatus = 'pending' | 'syncing' | 'confirmed' | 'failed' | 'conflicted';

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

class LocalFirstP2PDatabase extends Dexie {
  signedEvents!: Table<StoredSignedEvent, string>;
  mutationOutbox!: Table<MutationOutboxEntry, string>;
  eventSummaries!: Table<EventSummaryView, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      signedEvents: 'eventId, kind, author, createdAt',
      mutationOutbox: 'idempotencyKey, eventId, status, nextRetryAt, createdAt',
      eventSummaries: 'eventId, createdAt'
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

  async close(): Promise<void> {
    this.#db.close();
  }

  async delete(): Promise<void> {
    await this.#db.delete();
  }
}

export function createLocalFirstStore(databaseName?: string): DexieLocalFirstStore {
  return new DexieLocalFirstStore(databaseName);
}
