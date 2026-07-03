import type { EventKind, JsonValue } from '@lfp2p/protocol';

/**
 * @lfp2p/udr-projection — pure deterministic projection of User Data
 * Root (UDR) lifecycle events (Phase 5.11).
 *
 * The UDR is the local-first logical container for what one identity
 * owns or subscribes to: data partitions, feed subscriptions, sync
 * interests, Spaces, and a mailbox binding. This package is the pure
 * state machine over the DECRYPTED `udr.*` payloads. It never sees
 * ciphertext: the decrypt-and-apply seam lives in `@lfp2p/local-store`
 * (Phase 5.11 Step 4), exactly like the chat projection.
 *
 * Boundary rules (Phase 5.11 plan):
 * - MUST NOT import `@lfp2p/local-store`, `@lfp2p/sync-client`, or any
 *   app package (only type-only `@lfp2p/protocol` symbols);
 * - outputs are deep-frozen (Phase 3.2 local-first integrity);
 * - errors are raised by stable code, never with payload content
 *   (Phase 3.1 privacy-safe logging).
 *
 * Consistency class: B (append-only lifecycle). Set membership is the
 * model — claim/add/join insert, release/remove/leave delete, and both
 * directions are idempotent so replay and out-of-order redelivery
 * converge. Applying the same ordered event log twice yields identical
 * state (replay equivalence), and re-applying an already-seen
 * `eventId` is a no-op.
 */

// ---------------------------------------------------------------------------
// Stable error codes (Phase 3.1 — logged by code, never by content)
// ---------------------------------------------------------------------------

export const UDR_ERROR_CODES = Object.freeze(['UDR_INVALID_PAYLOAD', 'UDR_UNKNOWN_KIND'] as const);

export type UdrErrorCode = (typeof UDR_ERROR_CODES)[number];

export class UdrProjectionError extends Error {
  readonly code: UdrErrorCode;
  constructor(code: UdrErrorCode, detail?: string) {
    super(detail !== undefined ? `${code}: ${detail}` : code);
    this.name = 'UdrProjectionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// UDR event kind guard
// ---------------------------------------------------------------------------

export const UDR_EVENT_KINDS = Object.freeze([
  'udr.partition.claimed',
  'udr.partition.released',
  'udr.feed-subscription.added',
  'udr.feed-subscription.removed',
  'udr.sync-interest.added',
  'udr.sync-interest.removed',
  'udr.mailbox.bound',
  'udr.space.joined',
  'udr.space.left'
] as const);

export type UdrEventKind = (typeof UDR_EVENT_KINDS)[number];

export function isUdrEventKind(kind: EventKind | string): kind is UdrEventKind {
  return (UDR_EVENT_KINDS as ReadonlyArray<string>).includes(kind);
}

// ---------------------------------------------------------------------------
// Projection state
// ---------------------------------------------------------------------------

export type UdrState = Readonly<{
  identityId: string;
  partitionIds: ReadonlySet<string>;
  feedSubscriptionIds: ReadonlySet<string>;
  syncInterestIds: ReadonlySet<string>;
  spaceIds: ReadonlySet<string>;
  mailboxId: string | undefined;
  /** ISO timestamp of the most recently applied event, or empty. */
  updatedAt: string;
  /** eventIds already folded in — drives idempotent replay. */
  appliedEventIds: ReadonlySet<string>;
}>;

export type ApplyUdrEventMeta = Readonly<{
  kind: UdrEventKind;
  eventId: string;
  /** Envelope `createdAt`; drives `updatedAt` and is not trusted for auth. */
  createdAt: string;
}>;

export function createEmptyUdrState(identityId: string): UdrState {
  if (typeof identityId !== 'string' || identityId.length === 0) {
    throw new UdrProjectionError('UDR_INVALID_PAYLOAD', 'identityId must be a non-empty string');
  }
  return Object.freeze({
    identityId,
    partitionIds: readonlySet([]),
    feedSubscriptionIds: readonlySet([]),
    syncInterestIds: readonlySet([]),
    spaceIds: readonlySet([]),
    mailboxId: undefined,
    updatedAt: '',
    appliedEventIds: readonlySet([])
  });
}

// ---------------------------------------------------------------------------
// Serialization boundary
// ---------------------------------------------------------------------------

/**
 * Plain, storage-friendly snapshot of `UdrState`. Persistence layers
 * (e.g. `@lfp2p/local-store`) store this shape; set construction stays
 * inside this package so the read-only-set invariant is never bypassed.
 * Arrays are sorted so the serialized form is canonical (stable diffs
 * and equality in tests / storage).
 */
export type UdrStateSnapshot = Readonly<{
  identityId: string;
  partitionIds: readonly string[];
  feedSubscriptionIds: readonly string[];
  syncInterestIds: readonly string[];
  spaceIds: readonly string[];
  mailboxId?: string;
  updatedAt: string;
  appliedEventIds: readonly string[];
}>;

function sortedFrozen(set: ReadonlySet<string>): readonly string[] {
  return Object.freeze([...set].sort());
}

export function serializeUdrState(state: UdrState): UdrStateSnapshot {
  const snapshot: { -readonly [K in keyof UdrStateSnapshot]: UdrStateSnapshot[K] } = {
    identityId: state.identityId,
    partitionIds: sortedFrozen(state.partitionIds),
    feedSubscriptionIds: sortedFrozen(state.feedSubscriptionIds),
    syncInterestIds: sortedFrozen(state.syncInterestIds),
    spaceIds: sortedFrozen(state.spaceIds),
    updatedAt: state.updatedAt,
    appliedEventIds: sortedFrozen(state.appliedEventIds)
  };
  if (state.mailboxId !== undefined) snapshot.mailboxId = state.mailboxId;
  return Object.freeze(snapshot);
}

/**
 * Rebuild `UdrState` from a stored snapshot, validating defensively —
 * a corrupt or tampered persisted row must not crash the caller or
 * inject malformed state. Unknown array members that are not non-empty
 * strings are rejected (fail closed) rather than silently dropped, so
 * tampering is surfaced.
 */
export function deserializeUdrState(snapshot: UdrStateSnapshot): UdrState {
  if (typeof snapshot !== 'object' || snapshot === null) {
    throw new UdrProjectionError('UDR_INVALID_PAYLOAD', 'snapshot must be an object');
  }
  if (typeof snapshot.identityId !== 'string' || snapshot.identityId.length === 0) {
    throw new UdrProjectionError('UDR_INVALID_PAYLOAD', 'snapshot.identityId must be non-empty');
  }
  const readIds = (value: unknown, field: string): ReadonlySet<string> => {
    if (!Array.isArray(value)) {
      throw new UdrProjectionError('UDR_INVALID_PAYLOAD', `snapshot.${field} must be an array`);
    }
    for (const v of value) {
      if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID_LENGTH) {
        throw new UdrProjectionError(
          'UDR_INVALID_PAYLOAD',
          `snapshot.${field} entries must be non-empty strings within bounds`
        );
      }
    }
    return readonlySet(value as string[]);
  };
  if (snapshot.mailboxId !== undefined) {
    if (
      typeof snapshot.mailboxId !== 'string' ||
      snapshot.mailboxId.length === 0 ||
      snapshot.mailboxId.length > MAX_ID_LENGTH
    ) {
      throw new UdrProjectionError('UDR_INVALID_PAYLOAD', 'snapshot.mailboxId must be a valid id');
    }
  }
  if (typeof snapshot.updatedAt !== 'string') {
    throw new UdrProjectionError('UDR_INVALID_PAYLOAD', 'snapshot.updatedAt must be a string');
  }
  return Object.freeze({
    identityId: snapshot.identityId,
    partitionIds: readIds(snapshot.partitionIds, 'partitionIds'),
    feedSubscriptionIds: readIds(snapshot.feedSubscriptionIds, 'feedSubscriptionIds'),
    syncInterestIds: readIds(snapshot.syncInterestIds, 'syncInterestIds'),
    spaceIds: readIds(snapshot.spaceIds, 'spaceIds'),
    mailboxId: snapshot.mailboxId,
    updatedAt: snapshot.updatedAt,
    appliedEventIds: readIds(snapshot.appliedEventIds, 'appliedEventIds')
  });
}

// ---------------------------------------------------------------------------
// Payload field validation (decrypted app payloads; never logged)
// ---------------------------------------------------------------------------

const MAX_ID_LENGTH = 512;

function asObject(payload: JsonValue): Readonly<Record<string, JsonValue>> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new UdrProjectionError('UDR_INVALID_PAYLOAD', 'payload must be a JSON object');
  }
  return payload as Readonly<Record<string, JsonValue>>;
}

function requireId(payload: Readonly<Record<string, JsonValue>>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new UdrProjectionError(
      'UDR_INVALID_PAYLOAD',
      `${field} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Truly-immutable set helpers
// ---------------------------------------------------------------------------

function blockMutation(): never {
  throw new TypeError('UdrState sets are read-only');
}

/**
 * Build a genuinely read-only `Set`. `Object.freeze(new Set(...))` does
 * NOT stop `add`/`delete`/`clear` — freezing only locks own properties,
 * not the internal `[[SetData]]`. A consumer holding a returned
 * `UdrState` could otherwise corrupt projected membership (and, worse,
 * `appliedEventIds`, breaking replay/idempotency). Here we replace the
 * three mutators with a fail-closed throw and freeze the instance so
 * they cannot be reassigned. Reads (`has`, `size`, iteration) are
 * unaffected.
 */
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

function withAdded(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  if (set.has(value)) return set;
  return readonlySet([...set, value]);
}

function withRemoved(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  if (!set.has(value)) return set;
  return readonlySet([...set].filter((v) => v !== value));
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Fold one decrypted UDR event into state. Pure and deterministic.
 *
 * `payload` MUST already be decrypted plaintext (never a
 * `PrivatePayloadEnvelopeV1`); the local-store decrypt seam is
 * responsible for that. Re-applying an already-seen `eventId` returns
 * the input state unchanged (idempotent).
 */
export function applyUdrEvent(
  state: UdrState,
  payload: JsonValue,
  meta: ApplyUdrEventMeta
): UdrState {
  if (!isUdrEventKind(meta.kind)) {
    throw new UdrProjectionError('UDR_UNKNOWN_KIND', String(meta.kind));
  }
  if (typeof meta.eventId !== 'string' || meta.eventId.length === 0) {
    throw new UdrProjectionError('UDR_INVALID_PAYLOAD', 'meta.eventId must be a non-empty string');
  }
  if (typeof meta.createdAt !== 'string' || meta.createdAt.length === 0) {
    throw new UdrProjectionError(
      'UDR_INVALID_PAYLOAD',
      'meta.createdAt must be a non-empty string'
    );
  }
  if (state.appliedEventIds.has(meta.eventId)) {
    return state;
  }

  const record = asObject(payload);
  const base = applyKind(state, meta.kind, record);

  const appliedEventIds = readonlySet([...state.appliedEventIds, meta.eventId]);
  // updatedAt advances monotonically under ordered replay; guard against
  // an out-of-order older timestamp regressing it.
  const updatedAt = meta.createdAt > state.updatedAt ? meta.createdAt : state.updatedAt;

  return Object.freeze({
    ...base,
    updatedAt,
    appliedEventIds
  });
}

function applyKind(
  state: UdrState,
  kind: UdrEventKind,
  payload: Readonly<Record<string, JsonValue>>
): UdrState {
  switch (kind) {
    case 'udr.partition.claimed':
      return {
        ...state,
        partitionIds: withAdded(state.partitionIds, requireId(payload, 'partitionId'))
      };
    case 'udr.partition.released':
      return {
        ...state,
        partitionIds: withRemoved(state.partitionIds, requireId(payload, 'partitionId'))
      };
    case 'udr.feed-subscription.added':
      return {
        ...state,
        feedSubscriptionIds: withAdded(state.feedSubscriptionIds, requireId(payload, 'feedId'))
      };
    case 'udr.feed-subscription.removed':
      return {
        ...state,
        feedSubscriptionIds: withRemoved(state.feedSubscriptionIds, requireId(payload, 'feedId'))
      };
    case 'udr.sync-interest.added':
      return {
        ...state,
        syncInterestIds: withAdded(state.syncInterestIds, requireId(payload, 'syncInterestId'))
      };
    case 'udr.sync-interest.removed':
      return {
        ...state,
        syncInterestIds: withRemoved(state.syncInterestIds, requireId(payload, 'syncInterestId'))
      };
    case 'udr.mailbox.bound':
      // Single binding; a later bind supersedes (a device can move its
      // mailbox). Deterministic under ordered replay.
      return { ...state, mailboxId: requireId(payload, 'mailboxId') };
    case 'udr.space.joined':
      return { ...state, spaceIds: withAdded(state.spaceIds, requireId(payload, 'spaceId')) };
    case 'udr.space.left':
      return { ...state, spaceIds: withRemoved(state.spaceIds, requireId(payload, 'spaceId')) };
    default: {
      // Exhaustiveness guard — unreachable given the isUdrEventKind check.
      const never: never = kind;
      throw new UdrProjectionError('UDR_UNKNOWN_KIND', String(never));
    }
  }
}
