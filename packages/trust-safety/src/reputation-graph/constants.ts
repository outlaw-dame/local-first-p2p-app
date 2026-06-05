/**
 * Bounded enums for Phase 1.8.1 reputation graph events.
 *
 * Every string-typed field on every reputation event MUST be one of
 * these enum values. Free-form text is deliberately not allowed —
 * the doctrine non-negotiable #5 (observations carry counts + stable
 * tags only, never payload bytes) is enforced at the validator
 * boundary by referring back to these tuples.
 *
 * Forward compatibility: an event carrying a value outside the
 * declared tuple is rejected deterministically with TS_INVALID_ENUM.
 * The doctrine explicitly chooses reject-not-partial: a partially
 * applied event would create non-replayable state — two devices
 * with different protocol versions would diverge. This is the same
 * stance Phase 1.62 / 1.66 / 1.67 take with their own enums.
 */

/**
 * Observation kind — what the observer is reporting about a subject.
 * Counts (`satCount`, `unsatCount`) accumulate per (subject, kind,
 * window) so a noisy peer in one dimension does not drown out a
 * useful peer in another.
 */
export const OBSERVATION_KINDS = Object.freeze([
  // Outbox-event observations (the subject is the author of a signed
  // event the observer received).
  'outbox.useful',
  'outbox.spammy',
  'outbox.duplicate',
  // Bridge transport observations (the subject is a bridge identity
  // the observer routed through). Pairs with Phase 1.64 PeerReputation
  // but is the user-level analogue — bridges with poor user-side
  // observations should be deprioritized regardless of their per-peer
  // metric.
  'bridge.well-behaved',
  'bridge.misbehaved',
  // Media observations (the subject is the publisher of a manifest /
  // block ref that the observer fetched).
  'media.served-correct',
  'media.served-corrupt'
] as const);
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/**
 * Attestation valence — directional explicit endorsement vs report.
 *
 * `positive` and `negative` are first-class endorsements; `dispute`
 * is a notice that the observer challenges an earlier attestation
 * about the same subject (used to express disagreement without
 * issuing a negative attestation that could be weaponized).
 */
export const ATTESTATION_VALENCES = Object.freeze(['positive', 'negative', 'dispute'] as const);
export type AttestationValence = (typeof ATTESTATION_VALENCES)[number];

/**
 * Attestation context tag — the bounded vocabulary describing WHY
 * the attestation was issued. Free-form notes are deliberately not
 * allowed (Phase 3.1 privacy-safe-logging + the doctrine's
 * "counts and stable tags only" rule). New tags MUST be added here
 * via protocol version bumps; consumers reject unknown tags rather
 * than partial-applying them.
 */
export const ATTESTATION_CONTEXT_TAGS = Object.freeze([
  // Identity / contact verification
  'contact.verified-in-person',
  'contact.long-term-correspondence',
  // Community roles (the attester is asserting the subject holds a
  // role they have personally observed)
  'community.moderator',
  'community.contributor',
  // Commercial interactions
  'commercial.fulfilled-order',
  'commercial.refunded-fairly',
  'commercial.dispute-unresolved',
  // Adverse interactions (mirror of the positive tags so the user
  // does not have to invent a free-form negative tag)
  'contact.failed-verification',
  'community.bad-actor',
  'commercial.fraudulent'
] as const);
export type AttestationContextTag = (typeof ATTESTATION_CONTEXT_TAGS)[number];

/**
 * Reason an aggregator removes a previously-published subject score.
 * `revoked` = the aggregator deliberately retracts; `expired` =
 * normal lifecycle; `superseded` = a fresher score covers this
 * subject; `algorithm-changed` = the aggregator switched algorithms
 * and the old score is no longer comparable.
 */
export const AGGREGATOR_REMOVAL_REASONS = Object.freeze([
  'revoked',
  'expired',
  'superseded',
  'algorithm-changed'
] as const);
export type AggregatorRemovalReason = (typeof AGGREGATOR_REMOVAL_REASONS)[number];

/**
 * Reputation algorithm identifiers an aggregator may publish under.
 * Versioned strings — a `v1` and `v2` of the same algorithm are
 * different identifiers and consumers MUST treat them as
 * non-comparable scores.
 *
 * `local.personalized-eigentrust.v1` is reserved for the device's
 * own computation (Phase 1.8.2). External aggregators (e.g., an
 * OpenRank adapter labeler) publish under their own versioned id.
 */
export const REPUTATION_ALGORITHMS = Object.freeze([
  'local.personalized-eigentrust.v1',
  'openrank.v1',
  'community-curated.v1'
] as const);
export type ReputationAlgorithm = (typeof REPUTATION_ALGORITHMS)[number];

/**
 * Hard caps. Per-event because an aggregator's batch publish
 * naturally fans out to many subjects; we cap the batch so a single
 * malformed event cannot consume unbounded memory at validation
 * time. Tuned high enough for realistic batches but low enough to
 * fail-closed against the obvious DoS shape.
 */
export const REPUTATION_LIMITS = Object.freeze({
  /**
   * Max subjects in a single `reputation.aggregator.published`
   * batch. Larger batches MUST be split across multiple events;
   * consumers reject an oversized batch deterministically.
   */
  maxSubjectsPerAggregatorBatch: 10_000,
  /**
   * Max observation window in milliseconds. Caps the size of any
   * single `reputation.observation.recorded` event's window field.
   * 365 days — observations older than this are dropped during
   * Phase 1.8.2 computation anyway; we reject obviously-bogus
   * multi-year windows at the protocol layer.
   */
  maxWindowMs: 365 * 24 * 60 * 60 * 1_000,
  /**
   * Max value for a count field on an observation event. Anything
   * higher than this is almost certainly a counter overflow or
   * adversarial input; we reject at the protocol layer.
   */
  maxObservationCount: 1_000_000
} as const);
