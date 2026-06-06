/**
 * Phase 1.8.12 — sync-client inbound ingestion for reputation
 * events.
 *
 * Where the existing `processInboundSyncBatch` handles
 * `SignedEventEnvelope` records keyed by protocol-layer event
 * kinds (identity, notes, outbox tests), reputation events live
 * in their own event family (Phase 1.8.1) with their own validator
 * and their own Dexie table (Phase 1.8.7). This module wires
 * already-validated reputation records into the local log with the
 * doctrine's opt-in discipline preserved.
 *
 * Non-negotiables enforced here:
 *
 *   1. **Opt-in only.** Only `reputation.aggregator.published` and
 *      `reputation.aggregator.score.removed` events from labelers
 *      in `subscribedLabelers` are persisted. Events from any other
 *      labeler are silently dropped — counts surface to the caller
 *      via the `dropped` field. This mirrors the Phase 1.8.4
 *      aggregator runtime contract: the user MUST have explicitly
 *      subscribed before the event reaches their device's state.
 *
 *   2. **No remote observation / attestation ingestion (yet).**
 *      `reputation.observation.recorded`,
 *      `reputation.attestation.published`, and
 *      `reputation.attestation.revoked` are the LOCAL user's own
 *      events; the doctrine default privacy is device-local. A
 *      foreign observation arriving over the network is dropped
 *      with `policy-not-subscribable`. Cross-device sharing of
 *      these event kinds is the Phase 1.8.13 deferred work.
 *
 *   3. **Re-validation at the persistence boundary.** Every
 *      record is run through `validateReputationEvent` again
 *      before the store call. The store also re-validates as
 *      defense-in-depth, but doing it here too means an invalid
 *      event surfaces with a clear `rejected` count + an error row
 *      instead of throwing on `appendTrustSafetyReputationEvent`.
 *
 *   4. **Idempotent persistence.** The Dexie table is primary-
 *      keyed on `eventId`; duplicate inbound records become silent
 *      no-ops at the store layer. We still count them as `applied`
 *      since the user's intent (this event is now persisted) is
 *      satisfied.
 */
import {
  validateReputationEvent,
  type ReputationEvent
} from '@lfp2p/trust-safety';
import type { createLocalFirstStore } from '@lfp2p/local-store';

type Store = ReturnType<typeof createLocalFirstStore>;

/**
 * One inbound record. Source attribution `publisherLabelerId` is the
 * caller's responsibility — typically extracted from the bridge-
 * delivered envelope's signing author and mapped to a labeler id.
 *
 * Observation / attestation / revocation events do NOT carry a
 * publisher concept; they are dropped at this layer regardless of
 * what the caller supplies as `publisherLabelerId`.
 */
export type InboundReputationRecord = Readonly<{
  /**
   * For aggregator events: the labeler id of the publisher. The
   * runtime uses this for the opt-in subscription check. Pass an
   * empty string when no publisher mapping is available; the
   * record will be dropped as "policy-not-subscribable".
   */
  publisherLabelerId: string;
  event: ReputationEvent;
  /** ISO timestamp. Defaults to caller's clock. */
  receivedAt?: string;
}>;

export type ProcessInboundReputationInput = Readonly<{
  store: Store;
  records: ReadonlyArray<InboundReputationRecord>;
  /**
   * Set of labeler ids the user has subscribed to. Aggregator
   * events from labelers NOT in this set are silently dropped.
   * MUST be a Set (not an Array) so membership checks are O(1) on
   * large subscription lists.
   */
  subscribedLabelers: ReadonlySet<string>;
  now?: Date;
}>;

export type ProcessInboundReputationResult = Readonly<{
  received: number;
  applied: number;
  /** Events dropped by opt-in discipline. */
  dropped: number;
  /** Events that failed validation / persistence. */
  rejected: number;
  errors: ReadonlyArray<
    Readonly<{
      index: number;
      eventId?: string;
      reason: string;
    }>
  >;
}>;

/**
 * Stable reason codes for `dropped` records. Logged audit-safely
 * (Phase 3.1 privacy-safe logging — never raw event content).
 */
export const REPUTATION_DROP_REASONS = Object.freeze([
  /** Aggregator event from a labeler the user has NOT subscribed to. */
  'not-subscribed',
  /**
   * Observation / attestation / revocation event arrived over the
   * network. Cross-device sharing of these kinds is deferred to
   * Phase 1.8.13.
   */
  'policy-not-subscribable'
] as const);
export type ReputationDropReason = (typeof REPUTATION_DROP_REASONS)[number];

/**
 * Process a batch of inbound reputation records. Pure on its
 * inputs except for the store mutation. Throws ONLY on truly
 * pathological input (non-array `records`, missing store); per-
 * record validation failures surface as `rejected` counts.
 */
export async function processInboundReputationBatch(
  input: ProcessInboundReputationInput
): Promise<ProcessInboundReputationResult> {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('processInboundReputationBatch: input must be an object');
  }
  if (input.store === undefined || input.store === null) {
    throw new TypeError('processInboundReputationBatch: input.store is required');
  }
  if (!Array.isArray(input.records)) {
    throw new TypeError('processInboundReputationBatch: input.records must be an array');
  }
  if (!(input.subscribedLabelers instanceof Set)) {
    throw new TypeError(
      'processInboundReputationBatch: input.subscribedLabelers must be a Set'
    );
  }
  let received = 0;
  let applied = 0;
  let dropped = 0;
  let rejected = 0;
  const errors: Array<{ index: number; eventId?: string; reason: string }> = [];

  for (const [index, record] of input.records.entries()) {
    received += 1;
    let validated: ReputationEvent;
    try {
      validated = validateReputationEvent(record.event);
    } catch (err) {
      rejected += 1;
      errors.push({
        index,
        ...(record.event !== undefined &&
        typeof (record.event as { eventId?: unknown }).eventId === 'string'
          ? { eventId: (record.event as { eventId: string }).eventId }
          : {}),
        reason: (err as Error).message
      });
      continue;
    }
    // Opt-in discipline.
    if (
      validated.kind === 'reputation.observation.recorded' ||
      validated.kind === 'reputation.attestation.published' ||
      validated.kind === 'reputation.attestation.revoked'
    ) {
      dropped += 1;
      continue;
    }
    // Aggregator events: subscribed-labelers gate.
    if (
      typeof record.publisherLabelerId !== 'string' ||
      record.publisherLabelerId.length === 0 ||
      !input.subscribedLabelers.has(record.publisherLabelerId)
    ) {
      dropped += 1;
      continue;
    }
    // Persist. Idempotent on eventId.
    try {
      await input.store.appendTrustSafetyReputationEvent(validated);
      applied += 1;
    } catch (err) {
      rejected += 1;
      errors.push({
        index,
        eventId: validated.eventId,
        reason: (err as Error).message
      });
    }
  }
  return Object.freeze({
    received,
    applied,
    dropped,
    rejected,
    errors: Object.freeze(errors)
  });
}
