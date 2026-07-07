import type { EventKind } from './index.js';

/**
 * Operation consistency classes are the protocol-level guardrail that keeps
 * local-first convergence helpers from being applied to authority, lifecycle,
 * key-epoch, or infrastructure-admission events by accident.
 *
 * See docs/protocol/operation-consistency-classes.md.
 */
export const OPERATION_CONSISTENCY_CLASSES = ['A', 'B', 'C', 'D', 'E'] as const;

export type OperationConsistencyClass = (typeof OPERATION_CONSISTENCY_CLASSES)[number];

export type OperationConsistencyClassMetadata = Readonly<{
  class: OperationConsistencyClass;
  name: string;
  crdtAllowed: boolean;
  lwwAllowed: boolean;
  summary: string;
}>;

export const OPERATION_CONSISTENCY_CLASS_METADATA = Object.freeze({
  A: Object.freeze({
    class: 'A',
    name: 'eventually-consistent-projection',
    crdtAllowed: true,
    lwwAllowed: true,
    summary: 'Pure projection events where idempotent replay and commutative apply are acceptable.'
  }),
  B: Object.freeze({
    class: 'B',
    name: 'append-only-lifecycle-state-machine',
    crdtAllowed: false,
    lwwAllowed: false,
    summary: 'Lifecycle events with explicit legal transitions and terminal states.'
  }),
  C: Object.freeze({
    class: 'C',
    name: 'monotonic-authority-epoch',
    crdtAllowed: false,
    lwwAllowed: false,
    summary:
      'Authority-changing events that must advance epochs and cannot roll back authority state.'
  }),
  D: Object.freeze({
    class: 'D',
    name: 'encrypted-payload-or-key-epoch',
    crdtAllowed: false,
    lwwAllowed: false,
    summary:
      'Encrypted payload, MLS, or key-epoch events whose projection must respect key epoch and membership rules.'
  }),
  E: Object.freeze({
    class: 'E',
    name: 'infrastructure-observation',
    crdtAllowed: false,
    lwwAllowed: false,
    summary:
      'Bridge, relay, super-peer, or public-index observations that are advisory and infrastructure-scoped.'
  })
} satisfies Readonly<Record<OperationConsistencyClass, OperationConsistencyClassMetadata>>);

const EVENT_KIND_CONSISTENCY_CLASS_VALUES = {
  'identity.device.created': 'C',
  'identity.controller.created': 'C',
  'identity.device.authorized': 'C',
  'identity.device.revoked': 'C',
  'identity.device.rotated': 'C',
  'identity.capability.granted': 'C',
  'identity.capability.revoked': 'B',
  'identity.contact-card.published': 'A',
  'contact.petname.set': 'A',
  'note.created': 'A',
  'outbox.test.created': 'A',
  'reputation.observation.recorded': 'A',
  'reputation.attestation.published': 'B',
  'reputation.attestation.revoked': 'B',
  'reputation.aggregator.published': 'A',
  'reputation.aggregator.score.removed': 'A',
  'mls.group.created': 'D',
  'mls.member.proposed': 'D',
  'mls.member.added': 'D',
  'mls.member.removed': 'D',
  'mls.device.updated': 'D',
  'mls.commit.published': 'D',
  'mls.welcome.issued': 'D',
  'mls.epoch.advanced': 'D',
  'mls.fork.detected': 'D',
  'mls.fork.recovery.published': 'D',
  'mls.stale-epoch.rejected': 'D',
  // Phase 5 — encrypted chat events. All carry PrivatePayloadEnvelopeV1
  // ciphertext; the bridge transports them as opaque Class D records.
  'chat.thread.created': 'D',
  'chat.message.sent': 'D',
  'chat.message.edited': 'D',
  'chat.message.deleted': 'D',
  'chat.thread.accepted': 'D',
  // Phase 5.11 — User Data Root lifecycle events. Append-only
  // claim/release / add/remove / join/leave / bind state machine with
  // explicit legal transitions; not CRDT/LWW-mergeable. The payload
  // ciphertext is `self`-scoped, but the *event* is a Class B lifecycle
  // record, not Class D message content.
  'udr.partition.claimed': 'B',
  'udr.partition.released': 'B',
  'udr.feed-subscription.added': 'B',
  'udr.feed-subscription.removed': 'B',
  'udr.sync-interest.added': 'B',
  'udr.sync-interest.removed': 'B',
  'udr.mailbox.bound': 'B',
  'udr.space.joined': 'B',
  'udr.space.left': 'B',
  // Phase 5.11 — mailbox delivery events. Delivery-plane records carry
  // encrypted payloads (Class D). `mailbox.envelope.expired` is a
  // lifecycle transition that destroys availability, not an encrypted
  // key/payload transition, so it is Class B (append-only lifecycle).
  'mailbox.envelope.queued': 'D',
  'mailbox.envelope.delivered': 'D',
  'mailbox.envelope.expired': 'B',
  'mailbox.envelope.fetched': 'D',
  'mailbox.receipt.issued': 'D',
  'mailbox.ack.sent': 'D',
  'mailbox.checkpoint.advanced': 'D'
} as const satisfies Readonly<Record<EventKind, OperationConsistencyClass>>;

/**
 * Compile-time exhaustive registry for every first-class protocol EventKind.
 *
 * Adding a new EventKind in index.ts without classifying it here is a
 * typecheck failure. This intentionally converts the draft taxonomy from a
 * read-only audit lens into an enforceable protocol package guardrail.
 */
export const EVENT_KIND_CONSISTENCY_CLASS = Object.freeze(EVENT_KIND_CONSISTENCY_CLASS_VALUES);

export function isOperationConsistencyClass(value: unknown): value is OperationConsistencyClass {
  return (
    typeof value === 'string' &&
    OPERATION_CONSISTENCY_CLASSES.includes(value as OperationConsistencyClass)
  );
}

export function consistencyClassForEventKind(kind: EventKind): OperationConsistencyClass {
  const consistencyClass = EVENT_KIND_CONSISTENCY_CLASS[kind];
  if (consistencyClass === undefined) {
    throw new Error('Unknown event kind: ' + kind);
  }
  return consistencyClass;
}

export function assertEventKindConsistencyClass(
  kind: EventKind,
  expected: OperationConsistencyClass,
  label = 'event kind consistency class'
): void {
  const actual = consistencyClassForEventKind(kind);
  if (actual !== expected) {
    throw new Error(`${label}: ${kind} is Class ${actual}, expected Class ${expected}`);
  }
}

export function assertCrdtPayloadAllowedForEventKind(
  kind: EventKind,
  label = 'CRDT payload boundary'
): void {
  const consistencyClass = consistencyClassForEventKind(kind);
  const metadata = OPERATION_CONSISTENCY_CLASS_METADATA[consistencyClass];
  if (!metadata.crdtAllowed) {
    throw new Error(
      `${label}: ${kind} is Class ${consistencyClass} (${metadata.name}); CRDT/Loro/Yjs-style payload merging is not allowed at this boundary`
    );
  }
}

export function assertLwwAllowedForEventKind(kind: EventKind, label = 'LWW boundary'): void {
  const consistencyClass = consistencyClassForEventKind(kind);
  const metadata = OPERATION_CONSISTENCY_CLASS_METADATA[consistencyClass];
  if (!metadata.lwwAllowed) {
    throw new Error(
      `${label}: ${kind} is Class ${consistencyClass} (${metadata.name}); last-writer-wins is not allowed at this boundary`
    );
  }
}
