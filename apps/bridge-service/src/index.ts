import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { verifySignedEventEnvelope } from '@lfp2p/crypto';
import { type PrivacyScope, type SignedEventEnvelope, validateSignedEvent } from '@lfp2p/protocol';

export type BridgeServiceRole = 'stateful-edge-actor' | 'persistent-availability-peer';
export type BridgeDeliveryStatus = 'confirmed' | 'conflicted' | 'rejected';
export type BridgeStoreKind = 'memory' | 'json-file';

export type BridgeDeliveryRequest = Readonly<{
  idempotencyKey: string;
  target: string;
  event: SignedEventEnvelope;
}>;

export type BridgeDeliveryResponse =
  | Readonly<{
      status: 'confirmed';
      eventId: string;
      idempotencyKey: string;
      sequence: number;
      acceptedAt: string;
      duplicate: boolean;
    }>
  | Readonly<{
      status: 'conflicted';
      idempotencyKey: string;
      reason: string;
      existingEventId?: string;
    }>
  | Readonly<{
      status: 'rejected';
      idempotencyKey: string;
      reason: string;
    }>;

export type BridgeRecord = Readonly<{
  idempotencyKey: string;
  target: string;
  eventId: string;
  author: string;
  privacy: PrivacyScope;
  sequence: number;
  acceptedAt: string;
}>;

export type StoredBridgeRecord = BridgeRecord &
  Readonly<{
    expiresAt: string;
  }>;

export type BridgeStoreSnapshot = Readonly<{
  storeKind: BridgeStoreKind;
  acceptedCount: number;
  maxRecords: number;
  ttlMs: number;
  latestSequence: number;
}>;

export type BridgeServiceSnapshot = BridgeStoreSnapshot &
  Readonly<{
    role: BridgeServiceRole;
    authoritativeForPrivateState: false;
  }>;

export type BridgeStorePutResult =
  | Readonly<{ status: 'inserted'; record: StoredBridgeRecord }>
  | Readonly<{ status: 'existing'; record: StoredBridgeRecord }>;

export type BridgeStore = Readonly<{
  readonly kind: BridgeStoreKind;
  readonly maxRecords: number;
  readonly ttlMs: number;
  get(idempotencyKey: string, nowMs: number): Promise<StoredBridgeRecord | undefined>;
  putIfAbsent(record: StoredBridgeRecord, nowMs: number): Promise<BridgeStorePutResult>;
  nextSequence(nowMs: number): Promise<number>;
  pruneExpired(nowMs: number): Promise<void>;
  snapshot(nowMs: number): Promise<BridgeStoreSnapshot>;
}>;

export type BridgeServiceOptions = Readonly<{
  role?: BridgeServiceRole;
  store: BridgeStore;
}>;

export type InMemoryBridgeStoreOptions = Readonly<{
  maxRecords?: number;
  ttlMs?: number;
  initialSequence?: number;
}>;

export type InMemoryBridgeServiceOptions = InMemoryBridgeStoreOptions &
  Readonly<{
    role?: BridgeServiceRole;
  }>;

export type JsonFileBridgeStoreOptions = Readonly<{
  filePath: string;
  maxRecords?: number;
  ttlMs?: number;
  initialSequence?: number;
  tempFileSuffix?: string;
}>;

type JsonBridgeStoreState = Readonly<{
  recordType: 'lfp2p.bridge.store.v1';
  latestSequence: number;
  records: StoredBridgeRecord[];
}>;

const BRIDGE_ALLOWED_PRIVACY_SCOPES = new Set<PrivacyScope>(['dm', 'group', 'public']);
const DEFAULT_MAX_RECORDS = 10_000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class BridgeService {
  readonly role: BridgeServiceRole;
  readonly authoritativeForPrivateState = false as const;
  readonly store: BridgeStore;

  constructor(options: BridgeServiceOptions) {
    this.role = options.role ?? 'stateful-edge-actor';
    this.store = options.store;
  }

  async acceptDelivery(request: BridgeDeliveryRequest, now = new Date().toISOString()): Promise<BridgeDeliveryResponse> {
    const idempotencyKey = requireNonEmpty(request.idempotencyKey, 'idempotencyKey');
    const target = requireNonEmpty(request.target, 'target');
    const nowMs = requireIsoDate(now, 'now');
    await this.store.pruneExpired(nowMs);

    try {
      validateSignedEvent(request.event);
    } catch (error) {
      return rejected(idempotencyKey, `Invalid signed event envelope: ${normalizeErrorMessage(error)}`);
    }

    if (!BRIDGE_ALLOWED_PRIVACY_SCOPES.has(request.event.privacy)) {
      return rejected(idempotencyKey, `Bridge cannot accept ${request.event.privacy} scoped events`);
    }

    if (!verifySignedEventEnvelope(request.event)) {
      return rejected(idempotencyKey, 'Event signature verification failed');
    }

    const existing = await this.store.get(idempotencyKey, nowMs);
    if (existing) return responseForExistingRecord(existing, idempotencyKey, target, request.event);

    const sequence = await this.store.nextSequence(nowMs);
    const candidate: StoredBridgeRecord = {
      idempotencyKey,
      target,
      eventId: request.event.eventId,
      author: request.event.author,
      privacy: request.event.privacy,
      sequence,
      acceptedAt: now,
      expiresAt: new Date(nowMs + this.store.ttlMs).toISOString()
    };
    const result = await this.store.putIfAbsent(candidate, nowMs);
    if (result.status === 'existing') return responseForExistingRecord(result.record, idempotencyKey, target, request.event);

    return {
      status: 'confirmed',
      idempotencyKey,
      eventId: result.record.eventId,
      sequence: result.record.sequence,
      acceptedAt: result.record.acceptedAt,
      duplicate: false
    };
  }

  async getRecord(idempotencyKey: string, now = new Date().toISOString()): Promise<BridgeRecord | undefined> {
    requireNonEmpty(idempotencyKey, 'idempotencyKey');
    const record = await this.store.get(idempotencyKey, requireIsoDate(now, 'now'));
    return withoutExpiry(record);
  }

  async snapshot(now = new Date().toISOString()): Promise<BridgeServiceSnapshot> {
    const storeSnapshot = await this.store.snapshot(requireIsoDate(now, 'now'));
    return {
      role: this.role,
      authoritativeForPrivateState: false,
      ...storeSnapshot
    };
  }
}

export class InMemoryBridgeService extends BridgeService {
  constructor(options: BridgeServiceRole | InMemoryBridgeServiceOptions = 'stateful-edge-actor') {
    const normalized = typeof options === 'string' ? { role: options } : options;
    super({
      role: normalized.role,
      store: new InMemoryBridgeStore({
        ...(normalized.maxRecords === undefined ? {} : { maxRecords: normalized.maxRecords }),
        ...(normalized.ttlMs === undefined ? {} : { ttlMs: normalized.ttlMs }),
        ...(normalized.initialSequence === undefined ? {} : { initialSequence: normalized.initialSequence })
      })
    });
  }
}

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

  async putIfAbsent(record: StoredBridgeRecord, nowMs: number): Promise<BridgeStorePutResult> {
    validateStoredBridgeRecord(record);
    this.#evictExpired(nowMs);
    const existing = this.#recordsByIdempotencyKey.get(record.idempotencyKey);
    if (existing) return { status: 'existing', record: existing };
    this.#evictToCapacity();
    this.#recordsByIdempotencyKey.set(record.idempotencyKey, record);
    this.#sequence = Math.max(this.#sequence, record.sequence);
    return { status: 'inserted', record };
  }

  async nextSequence(nowMs: number): Promise<number> {
    const wallClockFloor = Math.min(nowMs * 1000, Number.MAX_SAFE_INTEGER - 1);
    this.#sequence = Math.max(this.#sequence + 1, wallClockFloor);
    return this.#sequence;
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
      const state = await this.#loadState();
      const changed = pruneExpiredRecords(state, nowMs);
      if (changed) await this.#persistState(state);
      return state.records.find((record) => record.idempotencyKey === idempotencyKey);
    });
  }

  async putIfAbsent(record: StoredBridgeRecord, nowMs: number): Promise<BridgeStorePutResult> {
    validateStoredBridgeRecord(record);
    return this.#withLock(async () => {
      const state = await this.#loadState();
      const changed = pruneExpiredRecords(state, nowMs);
      const existing = state.records.find((candidate) => candidate.idempotencyKey === record.idempotencyKey);
      if (existing) {
        if (changed) await this.#persistState(state);
        return { status: 'existing', record: existing };
      }
      while (state.records.length >= this.maxRecords) {
        state.records.shift();
      }
      state.records.push(record);
      state.latestSequence = Math.max(state.latestSequence, record.sequence);
      await this.#persistState(state);
      return { status: 'inserted', record };
    });
  }

  async nextSequence(nowMs: number): Promise<number> {
    return this.#withLock(async () => {
      const state = await this.#loadState();
      const wallClockFloor = Math.min(nowMs * 1000, Number.MAX_SAFE_INTEGER - 1);
      state.latestSequence = Math.max(state.latestSequence + 1, wallClockFloor);
      await this.#persistState(state);
      return state.latestSequence;
    });
  }

  async pruneExpired(nowMs: number): Promise<void> {
    await this.#withLock(async () => {
      const state = await this.#loadState();
      if (pruneExpiredRecords(state, nowMs)) await this.#persistState(state);
    });
  }

  async snapshot(nowMs: number): Promise<BridgeStoreSnapshot> {
    return this.#withLock(async () => {
      const state = await this.#loadState();
      if (pruneExpiredRecords(state, nowMs)) await this.#persistState(state);
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

  async #loadState(): Promise<MutableJsonBridgeStoreState> {
    if (this.#state !== undefined) return mutableState(this.#state);
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(content);
      this.#state = validateJsonBridgeStoreState(parsed, this.#initialSequence);
      return mutableState(this.#state);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      this.#state = {
        recordType: 'lfp2p.bridge.store.v1',
        latestSequence: this.#initialSequence,
        records: []
      };
      await this.#persistState(this.#state);
      return mutableState(this.#state);
    }
  }

  async #persistState(state: JsonBridgeStoreState): Promise<void> {
    this.#state = {
      recordType: 'lfp2p.bridge.store.v1',
      latestSequence: state.latestSequence,
      records: [...state.records]
    };
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}${this.#tempFileSuffix}`;
    await writeFile(tempPath, `${JSON.stringify(this.#state)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }
}

export async function handleBridgeDeliveryRequest(
  service: BridgeService,
  request: Request,
  now = new Date().toISOString()
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ status: 'rejected', idempotencyKey: 'unknown', reason: 'Method not allowed' }, 405);
  }

  const parsed = await parseDeliveryRequestJson(request);
  if (parsed.status === 'invalid') {
    return jsonResponse({ status: 'rejected', idempotencyKey: parsed.idempotencyKey, reason: parsed.reason }, 400);
  }

  const response = await service.acceptDelivery(parsed.request, now);
  return jsonResponse(response, statusCodeForBridgeResponse(response));
}

export const bridgeServicePlaceholder = {
  role: 'stateful-edge-actor' satisfies BridgeServiceRole,
  authoritativeForPrivateState: false
};

type MutableJsonBridgeStoreState = {
  recordType: 'lfp2p.bridge.store.v1';
  latestSequence: number;
  records: StoredBridgeRecord[];
};

function responseForExistingRecord(
  existing: StoredBridgeRecord,
  idempotencyKey: string,
  target: string,
  event: SignedEventEnvelope
): BridgeDeliveryResponse {
  if (existing.eventId !== event.eventId) {
    return {
      status: 'conflicted',
      idempotencyKey,
      reason: 'Idempotency key already belongs to a different event',
      existingEventId: existing.eventId
    };
  }

  if (existing.target !== target) {
    return {
      status: 'conflicted',
      idempotencyKey,
      reason: 'Idempotency key already belongs to a different target',
      existingEventId: existing.eventId
    };
  }

  return {
    status: 'confirmed',
    idempotencyKey,
    eventId: existing.eventId,
    sequence: existing.sequence,
    acceptedAt: existing.acceptedAt,
    duplicate: true
  };
}

function pruneExpiredRecords(state: MutableJsonBridgeStoreState, nowMs: number): boolean {
  const previousLength = state.records.length;
  state.records = state.records.filter((record) => Date.parse(record.expiresAt) > nowMs);
  return state.records.length !== previousLength;
}

function validateJsonBridgeStoreState(value: unknown, initialSequence: number): JsonBridgeStoreState {
  if (!isRecord(value)) throw new Error('Bridge store state must be a JSON object');
  if (value.recordType !== 'lfp2p.bridge.store.v1') throw new Error('Unsupported bridge store record type');
  const latestSequence = requireSafeNonNegativeInteger(Number(value.latestSequence), 'latestSequence');
  if (!Array.isArray(value.records)) throw new Error('Bridge store records must be an array');
  const records = value.records.map((record) => {
    if (!isRecord(record)) throw new Error('Bridge store record must be a JSON object');
    return validateStoredBridgeRecord(record as Partial<StoredBridgeRecord>);
  });
  return {
    recordType: 'lfp2p.bridge.store.v1',
    latestSequence: Math.max(initialSequence, latestSequence, ...records.map((record) => record.sequence)),
    records
  };
}

function validateStoredBridgeRecord(record: Partial<StoredBridgeRecord>): StoredBridgeRecord {
  const idempotencyKey = requireNonEmpty(String(record.idempotencyKey ?? ''), 'record.idempotencyKey');
  const target = requireNonEmpty(String(record.target ?? ''), 'record.target');
  const eventId = requireNonEmpty(String(record.eventId ?? ''), 'record.eventId');
  const author = requireNonEmpty(String(record.author ?? ''), 'record.author');
  const privacy = record.privacy;
  if (privacy !== 'dm' && privacy !== 'group' && privacy !== 'public') {
    throw new Error('record.privacy must be bridge-safe');
  }
  const sequence = requireSafeNonNegativeInteger(Number(record.sequence), 'record.sequence');
  const acceptedAt = requireNonEmpty(String(record.acceptedAt ?? ''), 'record.acceptedAt');
  requireIsoDate(acceptedAt, 'record.acceptedAt');
  const expiresAt = requireNonEmpty(String(record.expiresAt ?? ''), 'record.expiresAt');
  requireIsoDate(expiresAt, 'record.expiresAt');
  return {
    idempotencyKey,
    target,
    eventId,
    author,
    privacy,
    sequence,
    acceptedAt,
    expiresAt
  };
}

function statusCodeForBridgeResponse(response: BridgeDeliveryResponse): number {
  if (response.status === 'confirmed') return response.duplicate ? 200 : 202;
  if (response.status === 'conflicted') return 409;
  return 422;
}

async function parseDeliveryRequestJson(
  request: Request
): Promise<
  | Readonly<{ status: 'valid'; request: BridgeDeliveryRequest }>
  | Readonly<{ status: 'invalid'; idempotencyKey: string; reason: string }>
> {
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed)) return invalid('unknown', 'Request body must be a JSON object');
    const idempotencyKey = coerceString(parsed.idempotencyKey, 'idempotencyKey');
    const target = coerceString(parsed.target, 'target');
    if (!isRecord(parsed.event)) return invalid(idempotencyKey, 'event must be a JSON object');
    const headerKey = request.headers.get('x-lfp2p-idempotency-key');
    if (headerKey !== null && headerKey !== idempotencyKey) {
      return invalid(idempotencyKey, 'Idempotency header does not match request body');
    }
    const bridgeRequest: BridgeDeliveryRequest = {
      idempotencyKey,
      target,
      event: parsed.event as SignedEventEnvelope
    };
    return { status: 'valid', request: bridgeRequest };
  } catch (error) {
    return invalid('unknown', `Invalid request body: ${normalizeErrorMessage(error)}`);
  }
}

function jsonResponse(body: BridgeDeliveryResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function withoutExpiry(record: StoredBridgeRecord | undefined): BridgeRecord | undefined {
  if (!record) return undefined;
  return {
    idempotencyKey: record.idempotencyKey,
    target: record.target,
    eventId: record.eventId,
    author: record.author,
    privacy: record.privacy,
    sequence: record.sequence,
    acceptedAt: record.acceptedAt
  };
}

function mutableState(state: JsonBridgeStoreState): MutableJsonBridgeStoreState {
  return {
    recordType: state.recordType,
    latestSequence: state.latestSequence,
    records: [...state.records]
  };
}

function invalid(idempotencyKey: string, reason: string): Readonly<{ status: 'invalid'; idempotencyKey: string; reason: string }> {
  return { status: 'invalid', idempotencyKey, reason };
}

function rejected(idempotencyKey: string, reason: string): BridgeDeliveryResponse {
  return { status: 'rejected', idempotencyKey, reason };
}

function coerceString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function requireIsoDate(value: string, label: string): number {
  requireNonEmpty(value, label);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error(`${label} must be an ISO date string`);
  return millis;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

function requireSafeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a safe non-negative integer`);
  return value;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'unknown validation error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
