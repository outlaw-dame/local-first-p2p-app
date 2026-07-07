import type { EventKind, JsonValue } from '@lfp2p/protocol';

/**
 * @lfp2p/mailbox-projection — pure deterministic projection of mailbox
 * delivery lifecycle events (Phase 5.11).
 *
 * The projection is scoped to ONE identity and tracks two sides:
 *  - inbox: envelopes addressed TO this identity (recipient view);
 *  - outbox: envelopes sent BY this identity (sender view).
 *
 * It never sees ciphertext: the decrypt-and-apply seam lives in the
 * persistence layer (`@lfp2p/local-store`, a later step), exactly like
 * the chat and UDR projections. `applyMailboxEvent` only ever receives
 * decrypted plaintext payloads.
 *
 * Boundary rules (Phase 5.11 plan):
 *  - MUST NOT import `@lfp2p/local-store`, `@lfp2p/sync-client`, or any
 *    bridge/app package (only type-only `@lfp2p/protocol` symbols);
 *  - outputs are deep-frozen with genuinely immutable Maps/Sets
 *    (Phase 3.2 local-first integrity);
 *  - errors are raised by stable code, never with payload content
 *    (Phase 3.1 privacy-safe logging).
 *
 * Consistency: delivery events are Class D (encrypted); expiry is Class
 * B (lifecycle). Envelope status is a monotonic lifecycle
 * (`queued → delivered → fetched`) with `expired` as a terminal state
 * reachable from `queued`/`delivered`. Applying the same ordered event
 * log twice yields identical state (replay equivalence); re-applying a
 * seen `eventId` is a no-op. Out-of-order events referencing an unknown
 * envelope are no-ops — the authoritative rebuild replays in
 * (`createdAt`, `eventId`) order, so `queued` precedes its transitions.
 */

// ---------------------------------------------------------------------------
// Stable error codes (Phase 3.1 — logged by code, never by content)
// ---------------------------------------------------------------------------

export const MAILBOX_ERROR_CODES = Object.freeze([
  'MAILBOX_INVALID_PAYLOAD',
  'MAILBOX_UNKNOWN_KIND',
  'MAILBOX_RECIPIENT_MISMATCH'
] as const);

export type MailboxErrorCode = (typeof MAILBOX_ERROR_CODES)[number];

export class MailboxProjectionError extends Error {
  readonly code: MailboxErrorCode;
  constructor(code: MailboxErrorCode, detail?: string) {
    super(detail !== undefined ? `${code}: ${detail}` : code);
    this.name = 'MailboxProjectionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Mailbox event kind guard
// ---------------------------------------------------------------------------

export const MAILBOX_EVENT_KINDS = Object.freeze([
  'mailbox.envelope.queued',
  'mailbox.envelope.delivered',
  'mailbox.envelope.expired',
  'mailbox.envelope.fetched',
  'mailbox.receipt.issued',
  'mailbox.ack.sent',
  'mailbox.checkpoint.advanced'
] as const);

export type MailboxEventKind = (typeof MAILBOX_EVENT_KINDS)[number];

export function isMailboxEventKind(kind: EventKind | string): kind is MailboxEventKind {
  return (MAILBOX_EVENT_KINDS as ReadonlyArray<string>).includes(kind);
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export const ENVELOPE_STATUSES = Object.freeze([
  'queued',
  'delivered',
  'fetched',
  'expired'
] as const);
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

export const EXPIRY_REASONS = Object.freeze(['ttl', 'quota', 'policy', 'sender-revoked'] as const);
export type ExpiryReason = (typeof EXPIRY_REASONS)[number];

export const RECEIPT_KINDS = Object.freeze([
  'provider-accepted',
  'recipient-fetched',
  'recipient-applied',
  'recipient-rejected'
] as const);
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

export const ACK_KINDS = Object.freeze(['applied', 'rejected', 'undecryptable'] as const);
export type AckKind = (typeof ACK_KINDS)[number];

export type MailboxDeliveryEnvelope = Readonly<{
  envelopeId: string;
  recipientIdentityId: string;
  /** Present = sealed (only that device); absent = visible (any device). */
  recipientDeviceId?: string;
  senderIdentityId: string;
  /** ObjectRef key of the actual message content. */
  contentRef: string;
  expiresAt: string;
  /** envelopeId of the original, when this is a forward. */
  forwardedFrom?: string;
}>;

export type ReceiptRecord = Readonly<{
  receiptId: string;
  receiptKind: ReceiptKind;
  issuedAt: string;
}>;

export type AckRecord = Readonly<{
  ackId: string;
  ackKind: AckKind;
  sentAt: string;
}>;

export type InboxEntry = Readonly<{
  envelope: MailboxDeliveryEnvelope;
  status: EnvelopeStatus;
  deliveredAt?: string;
  fetchedAt?: string;
  expiredAt?: string;
  expiredReason?: ExpiryReason;
  receipts: readonly ReceiptRecord[];
}>;

export type OutboxEntry = Readonly<{
  envelope: MailboxDeliveryEnvelope;
  status: EnvelopeStatus;
  deliveredAt?: string;
  providerId?: string;
  expiredAt?: string;
  expiredReason?: ExpiryReason;
  ack?: AckRecord;
}>;

export type MailboxCheckpoint = Readonly<{
  mailboxId: string;
  checkpointId: string;
  cursor: string;
  advancedAt: string;
}>;

export type MailboxState = Readonly<{
  identityId: string;
  inbox: ReadonlyMap<string, InboxEntry>;
  outbox: ReadonlyMap<string, OutboxEntry>;
  checkpoints: ReadonlyMap<string, MailboxCheckpoint>;
  updatedAt: string;
  appliedEventIds: ReadonlySet<string>;
}>;

export type ApplyMailboxEventMeta = Readonly<{
  kind: MailboxEventKind;
  eventId: string;
  createdAt: string;
}>;

// ---------------------------------------------------------------------------
// Truly-immutable collection helpers (freeze does not block Map/Set mutation)
// ---------------------------------------------------------------------------

function blockMutation(): never {
  throw new TypeError('MailboxState collections are read-only');
}

function readonlySet(values: Iterable<string>): ReadonlySet<string> {
  const set = new Set(values);
  for (const method of ['add', 'delete', 'clear'] as const) {
    Object.defineProperty(set, method, {
      value: blockMutation,
      writable: false,
      enumerable: false,
      configurable: false
    });
  }
  return Object.freeze(set);
}

function readonlyMap<V>(entries: Iterable<readonly [string, V]>): ReadonlyMap<string, V> {
  const map = new Map(entries);
  for (const method of ['set', 'delete', 'clear'] as const) {
    Object.defineProperty(map, method, {
      value: blockMutation,
      writable: false,
      enumerable: false,
      configurable: false
    });
  }
  return Object.freeze(map);
}

function mapWith<V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> {
  const next = new Map(map);
  next.set(key, value);
  return readonlyMap(next);
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function createEmptyMailboxState(identityId: string): MailboxState {
  if (typeof identityId !== 'string' || identityId.length === 0) {
    throw new MailboxProjectionError(
      'MAILBOX_INVALID_PAYLOAD',
      'identityId must be a non-empty string'
    );
  }
  return Object.freeze({
    identityId,
    inbox: readonlyMap<InboxEntry>([]),
    outbox: readonlyMap<OutboxEntry>([]),
    checkpoints: readonlyMap<MailboxCheckpoint>([]),
    updatedAt: '',
    appliedEventIds: readonlySet([])
  });
}

export type HydrateMailboxStateInput = Readonly<{
  identityId: string;
  inbox?: Iterable<readonly [string, InboxEntry]>;
  outbox?: Iterable<readonly [string, OutboxEntry]>;
  checkpoints?: Iterable<readonly [string, MailboxCheckpoint]>;
  updatedAt?: string;
  appliedEventIds?: Iterable<string>;
}>;

/**
 * Reconstruct a `MailboxState` from already-projected entries. This lets
 * a persistence layer (`@lfp2p/local-store`) apply a single event
 * against just the affected envelope's current entries — each envelope's
 * lifecycle is independent, so a minimal seeded state yields identical
 * results to the full aggregate. It is intentionally light on
 * validation: the entries originate from this projection's own prior
 * output, and the authoritative correctness path is a full replay of the
 * encrypted event log through `applyMailboxEvent` (which re-validates).
 * Only the identity and the top-level container shapes are checked.
 */
export function hydrateMailboxState(input: HydrateMailboxStateInput): MailboxState {
  if (typeof input !== 'object' || input === null) {
    throw new MailboxProjectionError('MAILBOX_INVALID_PAYLOAD', 'hydrate input must be an object');
  }
  if (typeof input.identityId !== 'string' || input.identityId.length === 0) {
    throw new MailboxProjectionError(
      'MAILBOX_INVALID_PAYLOAD',
      'identityId must be a non-empty string'
    );
  }
  return Object.freeze({
    identityId: input.identityId,
    inbox: readonlyMap<InboxEntry>(input.inbox ?? []),
    outbox: readonlyMap<OutboxEntry>(input.outbox ?? []),
    checkpoints: readonlyMap<MailboxCheckpoint>(input.checkpoints ?? []),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : '',
    appliedEventIds: readonlySet(input.appliedEventIds ?? [])
  });
}

// ---------------------------------------------------------------------------
// Payload field validation (decrypted app payloads; never logged)
// ---------------------------------------------------------------------------

const MAX_ID_LENGTH = 512;
const MAX_REF_LENGTH = 4096;

function asObject(payload: JsonValue): Readonly<Record<string, JsonValue>> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new MailboxProjectionError('MAILBOX_INVALID_PAYLOAD', 'payload must be a JSON object');
  }
  return payload as Readonly<Record<string, JsonValue>>;
}

function reqStr(
  payload: Readonly<Record<string, JsonValue>>,
  field: string,
  max = MAX_ID_LENGTH
): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new MailboxProjectionError(
      'MAILBOX_INVALID_PAYLOAD',
      `${field} must be a non-empty string of at most ${max} characters`
    );
  }
  return value;
}

function optStr(payload: Readonly<Record<string, JsonValue>>, field: string): string | undefined {
  if (payload[field] === undefined) return undefined;
  return reqStr(payload, field);
}

/**
 * Validate an ISO-8601 timestamp field AND canonicalise it to UTC
 * (`…Z`, millisecond precision). `expiresAt` is compared lexicographically
 * against a canonical `now` by both the persistence-layer expiry sweep
 * (a string-indexed range query) and the PWA view model, so a value
 * carrying a non-UTC offset (e.g. `2026-07-04T13:00:00+02:00`) would sort
 * incorrectly and evade expiry. Canonicalising here — at the single
 * projection boundary every stored envelope passes through — makes the
 * comparison sound regardless of how the payload was authored, and is
 * deterministic (a pure function of the input), so replay equivalence
 * holds. An unparseable value is rejected, never silently kept.
 */
function reqIsoTimestamp(payload: Readonly<Record<string, JsonValue>>, field: string): string {
  const raw = reqStr(payload, field);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new MailboxProjectionError(
      'MAILBOX_INVALID_PAYLOAD',
      `${field} must be a valid ISO-8601 timestamp`
    );
  }
  return new Date(ms).toISOString();
}

function reqEnum<T extends string>(
  payload: Readonly<Record<string, JsonValue>>,
  field: string,
  allowed: readonly T[]
): T {
  const value = payload[field];
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new MailboxProjectionError(
      'MAILBOX_INVALID_PAYLOAD',
      `${field} must be one of ${allowed.join(', ')}`
    );
  }
  return value as T;
}

function validateEnvelope(payload: Readonly<Record<string, JsonValue>>): MailboxDeliveryEnvelope {
  const envelope: { -readonly [K in keyof MailboxDeliveryEnvelope]: MailboxDeliveryEnvelope[K] } = {
    envelopeId: reqStr(payload, 'envelopeId'),
    recipientIdentityId: reqStr(payload, 'recipientIdentityId'),
    senderIdentityId: reqStr(payload, 'senderIdentityId'),
    contentRef: reqStr(payload, 'contentRef', MAX_REF_LENGTH),
    expiresAt: reqIsoTimestamp(payload, 'expiresAt')
  };
  const recipientDeviceId = optStr(payload, 'recipientDeviceId');
  if (recipientDeviceId !== undefined) envelope.recipientDeviceId = recipientDeviceId;
  const forwardedFrom = optStr(payload, 'forwardedFrom');
  if (forwardedFrom !== undefined) envelope.forwardedFrom = forwardedFrom;
  return Object.freeze(envelope);
}

// ---------------------------------------------------------------------------
// Status ordering (monotonic lifecycle guard)
// ---------------------------------------------------------------------------

const STATUS_RANK: Readonly<Record<EnvelopeStatus, number>> = {
  queued: 0,
  delivered: 1,
  fetched: 2,
  expired: 3 // separate terminal; handled explicitly, not by rank
};

/** Advance a non-terminal lifecycle status without ever regressing it. */
function advance(current: EnvelopeStatus, next: 'delivered' | 'fetched'): EnvelopeStatus {
  if (current === 'expired') return current; // terminal — no transition
  return STATUS_RANK[next] > STATUS_RANK[current] ? next : current;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Fold one decrypted mailbox event into `state` for `state.identityId`.
 * Pure and deterministic. Re-applying a seen `eventId` returns the input
 * unchanged (idempotent). Events referencing an envelope this identity
 * is not a party to are rejected (`MAILBOX_RECIPIENT_MISMATCH`);
 * lifecycle events for an unknown envelope are no-ops (recovered by
 * ordered replay).
 */
export function applyMailboxEvent(
  state: MailboxState,
  payload: JsonValue,
  meta: ApplyMailboxEventMeta
): MailboxState {
  if (!isMailboxEventKind(meta.kind)) {
    throw new MailboxProjectionError('MAILBOX_UNKNOWN_KIND', String(meta.kind));
  }
  if (typeof meta.eventId !== 'string' || meta.eventId.length === 0) {
    throw new MailboxProjectionError(
      'MAILBOX_INVALID_PAYLOAD',
      'meta.eventId must be a non-empty string'
    );
  }
  if (typeof meta.createdAt !== 'string' || meta.createdAt.length === 0) {
    throw new MailboxProjectionError(
      'MAILBOX_INVALID_PAYLOAD',
      'meta.createdAt must be a non-empty string'
    );
  }
  if (state.appliedEventIds.has(meta.eventId)) {
    return state;
  }

  const record = asObject(payload);
  const base = applyKind(state, meta.kind, record);

  const appliedEventIds = readonlySet([...state.appliedEventIds, meta.eventId]);
  const updatedAt = meta.createdAt > state.updatedAt ? meta.createdAt : state.updatedAt;
  return Object.freeze({ ...base, updatedAt, appliedEventIds });
}

function applyKind(
  state: MailboxState,
  kind: MailboxEventKind,
  payload: Readonly<Record<string, JsonValue>>
): MailboxState {
  switch (kind) {
    case 'mailbox.envelope.queued':
      return applyQueued(state, payload);
    case 'mailbox.envelope.delivered':
      return applyDelivered(state, payload);
    case 'mailbox.envelope.fetched':
      return applyFetched(state, payload);
    case 'mailbox.envelope.expired':
      return applyExpired(state, payload);
    case 'mailbox.receipt.issued':
      return applyReceipt(state, payload);
    case 'mailbox.ack.sent':
      return applyAck(state, payload);
    case 'mailbox.checkpoint.advanced':
      return applyCheckpoint(state, payload);
    default: {
      const never: never = kind;
      throw new MailboxProjectionError('MAILBOX_UNKNOWN_KIND', String(never));
    }
  }
}

function applyQueued(
  state: MailboxState,
  payload: Readonly<Record<string, JsonValue>>
): MailboxState {
  const envelope = validateEnvelope(payload);
  const isRecipient = envelope.recipientIdentityId === state.identityId;
  const isSender = envelope.senderIdentityId === state.identityId;
  if (!isRecipient && !isSender) {
    // IDOR guard: this identity is neither party to the envelope, so it
    // must not enter either projection side.
    throw new MailboxProjectionError(
      'MAILBOX_RECIPIENT_MISMATCH',
      'identity is neither sender nor recipient of the envelope'
    );
  }
  let inbox = state.inbox;
  let outbox = state.outbox;
  if (isRecipient && !inbox.has(envelope.envelopeId)) {
    inbox = mapWith(
      inbox,
      envelope.envelopeId,
      Object.freeze({
        envelope,
        status: 'queued' as const,
        receipts: Object.freeze([]) as readonly ReceiptRecord[]
      })
    );
  }
  if (isSender && !outbox.has(envelope.envelopeId)) {
    outbox = mapWith(
      outbox,
      envelope.envelopeId,
      Object.freeze({ envelope, status: 'queued' as const })
    );
  }
  return { ...state, inbox, outbox };
}

function applyDelivered(
  state: MailboxState,
  payload: Readonly<Record<string, JsonValue>>
): MailboxState {
  const envelopeId = reqStr(payload, 'envelopeId');
  const deliveredAt = reqStr(payload, 'deliveredAt');
  const providerId = optStr(payload, 'providerId');
  let inbox = state.inbox;
  let outbox = state.outbox;
  const inEntry = inbox.get(envelopeId);
  if (inEntry !== undefined && inEntry.status !== 'expired') {
    inbox = mapWith(
      inbox,
      envelopeId,
      Object.freeze({ ...inEntry, status: advance(inEntry.status, 'delivered'), deliveredAt })
    );
  }
  const outEntry = outbox.get(envelopeId);
  if (outEntry !== undefined && outEntry.status !== 'expired') {
    outbox = mapWith(
      outbox,
      envelopeId,
      Object.freeze({
        ...outEntry,
        status: advance(outEntry.status, 'delivered'),
        deliveredAt,
        ...(providerId === undefined ? {} : { providerId })
      })
    );
  }
  return { ...state, inbox, outbox };
}

function applyFetched(
  state: MailboxState,
  payload: Readonly<Record<string, JsonValue>>
): MailboxState {
  const envelopeId = reqStr(payload, 'envelopeId');
  const fetchedAt = reqStr(payload, 'fetchedAt');
  reqStr(payload, 'recipientDeviceId'); // required by schema; validated, not stored separately
  const entry = state.inbox.get(envelopeId);
  // Fetch only applies to the recipient inbox and is a no-op on an
  // expired (terminal) or absent entry. Double-fetch is idempotent
  // because advance() never regresses and re-sets the same fetchedAt.
  if (entry === undefined || entry.status === 'expired') {
    return state;
  }
  const inbox = mapWith(
    state.inbox,
    envelopeId,
    Object.freeze({ ...entry, status: advance(entry.status, 'fetched'), fetchedAt })
  );
  return { ...state, inbox };
}

function applyExpired(
  state: MailboxState,
  payload: Readonly<Record<string, JsonValue>>
): MailboxState {
  const envelopeId = reqStr(payload, 'envelopeId');
  const expiredAt = reqStr(payload, 'expiredAt');
  const reason = reqEnum(payload, 'reason', EXPIRY_REASONS);
  let inbox = state.inbox;
  let outbox = state.outbox;
  const inEntry = inbox.get(envelopeId);
  if (inEntry !== undefined && inEntry.status !== 'expired') {
    inbox = mapWith(
      inbox,
      envelopeId,
      Object.freeze({ ...inEntry, status: 'expired' as const, expiredAt, expiredReason: reason })
    );
  }
  const outEntry = outbox.get(envelopeId);
  if (outEntry !== undefined && outEntry.status !== 'expired') {
    outbox = mapWith(
      outbox,
      envelopeId,
      Object.freeze({ ...outEntry, status: 'expired' as const, expiredAt, expiredReason: reason })
    );
  }
  return { ...state, inbox, outbox };
}

function applyReceipt(
  state: MailboxState,
  payload: Readonly<Record<string, JsonValue>>
): MailboxState {
  const envelopeId = reqStr(payload, 'envelopeId');
  const receipt: ReceiptRecord = Object.freeze({
    receiptId: reqStr(payload, 'receiptId'),
    receiptKind: reqEnum(payload, 'receiptKind', RECEIPT_KINDS),
    issuedAt: reqStr(payload, 'issuedAt')
  });
  const entry = state.inbox.get(envelopeId);
  if (entry === undefined) return state; // receipts annotate a known inbox entry
  if (entry.receipts.some((r) => r.receiptId === receipt.receiptId)) return state; // idempotent
  const inbox = mapWith(
    state.inbox,
    envelopeId,
    Object.freeze({ ...entry, receipts: Object.freeze([...entry.receipts, receipt]) })
  );
  return { ...state, inbox };
}

function applyAck(state: MailboxState, payload: Readonly<Record<string, JsonValue>>): MailboxState {
  const envelopeId = reqStr(payload, 'envelopeId');
  const ack: AckRecord = Object.freeze({
    ackId: reqStr(payload, 'ackId'),
    ackKind: reqEnum(payload, 'ackKind', ACK_KINDS),
    sentAt: reqStr(payload, 'sentAt')
  });
  // The ack (recipient → sender) resolves the sender's outbox entry.
  const entry = state.outbox.get(envelopeId);
  if (entry === undefined) return state;
  const outbox = mapWith(state.outbox, envelopeId, Object.freeze({ ...entry, ack }));
  return { ...state, outbox };
}

function applyCheckpoint(
  state: MailboxState,
  payload: Readonly<Record<string, JsonValue>>
): MailboxState {
  const checkpoint: MailboxCheckpoint = Object.freeze({
    mailboxId: reqStr(payload, 'mailboxId'),
    checkpointId: reqStr(payload, 'checkpointId'),
    cursor: reqStr(payload, 'cursor'),
    advancedAt: reqStr(payload, 'advancedAt')
  });
  const checkpoints = mapWith(state.checkpoints, checkpoint.mailboxId, checkpoint);
  return { ...state, checkpoints };
}
