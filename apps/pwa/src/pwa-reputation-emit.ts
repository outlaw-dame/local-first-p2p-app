/**
 * Phase 1.8.7 — PWA helpers for emitting reputation events.
 *
 * These helpers are the user-facing emit surface for Phase 1.8.1's
 * five reputation event kinds. They follow the same discipline as
 * the Phase 1.70 + Phase 2.2 emit helpers:
 *
 *   - construct the event payload from caller inputs,
 *   - validate via the protocol-layer validator
 *     (`validateReputationEvent`) — defense-in-depth at the helper
 *     boundary,
 *   - persist atomically via the Phase 1.8.7.A
 *     `appendTrustSafetyReputationEvent` (idempotent on `eventId`).
 *
 * The doctrine's "Default privacy = device-local" rule is enforced
 * STRUCTURALLY here: these helpers do NOT cross-publish or sign-and-
 * send. The persisted reputation events live in the local Dexie
 * log; cross-device propagation is a separate opt-in flow (deferred
 * to a future slice that wires reputation events into the sync-
 * client's outbound path).
 *
 * Every helper takes a caller-supplied `eventId` so callers in
 * tests can pin deterministic ids; defaults derive from
 * `globalThis.crypto.randomUUID()`.
 */
import {
  REPUTATION_EVENT_VERSION,
  validateReputationEvent,
  type AggregatorRemovalReason,
  type AggregatorSubjectScore,
  type AttestationContextTag,
  type AttestationValence,
  type ObservationKind,
  type ReputationAlgorithm,
  type ReputationEvent
} from '@lfp2p/trust-safety';
import type { SafetySubjectRef } from '@lfp2p/trust-safety';
import type { createLocalFirstStore } from '@lfp2p/local-store';

type Store = ReturnType<typeof createLocalFirstStore>;

/* -------------------------------------------------------------------------- */
/*                          observation emit                                  */
/* -------------------------------------------------------------------------- */

export type EmitObservationInput = Readonly<{
  store: Store;
  subject: SafetySubjectRef;
  observationKind: ObservationKind;
  satCount: number;
  unsatCount: number;
  windowStart: string;
  windowEnd: string;
  /** Defaults to a fresh `new Date().toISOString()`. */
  createdAt?: string;
  /** Defaults to `globalThis.crypto.randomUUID()`-derived. */
  eventId?: string;
}>;

/**
 * Build, validate, and persist a `reputation.observation.recorded`
 * event. Idempotent on the generated `eventId` via the store layer.
 *
 * Throws `TrustSafetyError` (re-thrown from `validateReputationEvent`)
 * on invalid input — bounded enum violation, out-of-range counts,
 * inverted window, oversized window etc.
 */
export async function emitObservationRecorded(
  input: EmitObservationInput
): Promise<ReputationEvent> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const eventId = input.eventId ?? newEventId('rep_obs');
  const candidate = {
    version: REPUTATION_EVENT_VERSION,
    eventId,
    createdAt,
    kind: 'reputation.observation.recorded' as const,
    subject: input.subject,
    observationKind: input.observationKind,
    satCount: input.satCount,
    unsatCount: input.unsatCount,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd
  };
  const validated = validateReputationEvent(candidate);
  await input.store.appendTrustSafetyReputationEvent(validated);
  return validated;
}

/* -------------------------------------------------------------------------- */
/*                          attestation emit                                  */
/* -------------------------------------------------------------------------- */

export type EmitAttestationPublishedInput = Readonly<{
  store: Store;
  subject: SafetySubjectRef;
  valence: AttestationValence;
  contextTag: AttestationContextTag;
  strength: number;
  expiresAt?: string;
  createdAt?: string;
  eventId?: string;
}>;

/**
 * Build, validate, and persist a `reputation.attestation.published`
 * event. The doctrine's fingerprint-amplifier behavior (Phase 1.8.5)
 * triggers automatically when `contextTag` is
 * `contact.verified-in-person` or `contact.long-term-correspondence`.
 */
export async function emitAttestationPublished(
  input: EmitAttestationPublishedInput
): Promise<ReputationEvent> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const eventId = input.eventId ?? newEventId('rep_att');
  const candidate = {
    version: REPUTATION_EVENT_VERSION,
    eventId,
    createdAt,
    kind: 'reputation.attestation.published' as const,
    subject: input.subject,
    valence: input.valence,
    contextTag: input.contextTag,
    strength: input.strength,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt })
  };
  const validated = validateReputationEvent(candidate);
  await input.store.appendTrustSafetyReputationEvent(validated);
  return validated;
}

export type EmitAttestationRevokedInput = Readonly<{
  store: Store;
  attestationId: string;
  revokedAt?: string;
  createdAt?: string;
  eventId?: string;
}>;

/**
 * Build, validate, and persist a `reputation.attestation.revoked`
 * event. The Phase 1.8.2 computer applies the revocation by
 * removing the matching attestation's contribution from the trust
 * matrix on the next computation.
 */
export async function emitAttestationRevoked(
  input: EmitAttestationRevokedInput
): Promise<ReputationEvent> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const revokedAt = input.revokedAt ?? createdAt;
  const eventId = input.eventId ?? newEventId('rep_rev');
  const candidate = {
    version: REPUTATION_EVENT_VERSION,
    eventId,
    createdAt,
    kind: 'reputation.attestation.revoked' as const,
    attestationId: input.attestationId,
    revokedAt
  };
  const validated = validateReputationEvent(candidate);
  await input.store.appendTrustSafetyReputationEvent(validated);
  return validated;
}

/* -------------------------------------------------------------------------- */
/*                          aggregator emit                                   */
/* -------------------------------------------------------------------------- */

export type EmitAggregatorPublishedInput = Readonly<{
  store: Store;
  algorithm: ReputationAlgorithm;
  computedAt: string;
  subjects: ReadonlyArray<AggregatorSubjectScore>;
  createdAt?: string;
  eventId?: string;
}>;

/**
 * Build, validate, and persist a
 * `reputation.aggregator.published` event. Intended for an
 * aggregator labeler (Phase 1.8.4) to ingest a batch of subject
 * scores; the PWA also uses this internally to persist the
 * device-side computer's output for cross-device sync (deferred).
 */
export async function emitAggregatorPublished(
  input: EmitAggregatorPublishedInput
): Promise<ReputationEvent> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const eventId = input.eventId ?? newEventId('rep_agg');
  const candidate = {
    version: REPUTATION_EVENT_VERSION,
    eventId,
    createdAt,
    kind: 'reputation.aggregator.published' as const,
    algorithm: input.algorithm,
    computedAt: input.computedAt,
    subjects: input.subjects
  };
  const validated = validateReputationEvent(candidate);
  await input.store.appendTrustSafetyReputationEvent(validated);
  return validated;
}

export type EmitAggregatorRemovedInput = Readonly<{
  store: Store;
  subject: SafetySubjectRef;
  reason: AggregatorRemovalReason;
  createdAt?: string;
  eventId?: string;
}>;

/**
 * Build, validate, and persist a
 * `reputation.aggregator.score.removed` event. Used when a
 * subscribed aggregator publishes a retraction.
 */
export async function emitAggregatorRemoved(
  input: EmitAggregatorRemovedInput
): Promise<ReputationEvent> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const eventId = input.eventId ?? newEventId('rep_rem');
  const candidate = {
    version: REPUTATION_EVENT_VERSION,
    eventId,
    createdAt,
    kind: 'reputation.aggregator.score.removed' as const,
    subject: input.subject,
    reason: input.reason
  };
  const validated = validateReputationEvent(candidate);
  await input.store.appendTrustSafetyReputationEvent(validated);
  return validated;
}

/* -------------------------------------------------------------------------- */

function newEventId(prefix: string): string {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `evt_${prefix}_${rand}`;
}
