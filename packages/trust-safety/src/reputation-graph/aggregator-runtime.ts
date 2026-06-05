/**
 * Phase 1.8.4 — reputation aggregator stacking runtime.
 *
 * Composes the local-personalized EigenTrust output (Phase 1.8.2)
 * with one or more subscribed external aggregator labelers
 * (e.g. an OpenRank adapter) into a single unified per-subject view.
 *
 * The doctrine non-negotiable: the LOCAL computer is ALWAYS
 * labeler-priority #0. External aggregators stack BELOW the local
 * output at user-chosen priority (Phase 1.66). For any subject the
 * local computer has scored, that score wins. For subjects the
 * local computer has NOT scored, the user's highest-priority
 * subscribed aggregator with data wins.
 *
 * This is the integration point an OpenRank-derived adapter slots
 * into: it ships a `SafetyLabelerProfile` declaring labeler.kind =
 * `reputation-aggregator` + the `aggregate.reputation-scoring`
 * capability, the user subscribes via the existing Phase 1.66
 * surface, and the adapter's `reputation.aggregator.published`
 * events feed `computeAggregatedReputation` alongside the local
 * computer's output.
 *
 * Pure function, deep-frozen output (Phase 3.2 frozen-walk).
 * Privacy-safe per Phase 3.1: the per-subject view carries a stable
 * labeler-id source attribution — never the raw score before
 * composition, never the labeler's underlying observation graph.
 */

import { tsError } from '../errors.js';
import type {
  ReputationEvent,
  AggregatorSubjectScore
} from './events.js';
import type { LocalReputationScore, LocalReputationState } from './computer.js';
import { subjectRefToKey, type SubjectKey } from './inputs.js';

export const AGGREGATED_REPUTATION_VIEW_VERSION =
  'lfp2p.reputation-aggregated-view.v1' as const;

/**
 * Identifier of the source labeler that produced a per-subject
 * score in the composed view.
 *
 *   - `'__local__'` is reserved for the device-side personalized
 *     EigenTrust computer (Phase 1.8.2). The doctrine non-negotiable
 *     "local is always #0" is structurally enforced by this id
 *     being the only source the runtime can derive from a
 *     `LocalReputationState`.
 *   - Any other string is a `labelerId` from the user's Phase 1.66
 *     subscription list.
 */
export type ReputationSourceId = '__local__' | string;

export const LOCAL_REPUTATION_SOURCE: ReputationSourceId = '__local__';

/**
 * One subject's composed reputation entry.
 *
 * `sourceLabelerId` is the stable identity of the labeler whose
 * score won composition for this subject — privacy-safe (no
 * scoring math leaks). `priority` is the labeler's priority at
 * the time of composition; `__local__` always wins regardless of
 * the listed priority value.
 */
export type AggregatedReputationEntry = Readonly<{
  subject: SubjectKey;
  score: number;
  confidence: number;
  /** `0` for local; explicit priority for subscribed labelers. */
  priority: number;
  sourceLabelerId: ReputationSourceId;
  /** Optional — `seedDistance` is only populated when the local source wins. */
  seedDistance?: number;
}>;

export type AggregatedReputationView = Readonly<{
  version: typeof AGGREGATED_REPUTATION_VIEW_VERSION;
  /** Sorted-key insertion order so serialization is replay-deterministic. */
  entries: ReadonlyMap<SubjectKey, AggregatedReputationEntry>;
  /** Audit-friendly: every labeler whose score contributed at least one subject to the view. */
  contributingLabelers: ReadonlyArray<ReputationSourceId>;
}>;

/**
 * One subscription record from the user's Phase 1.66 labeler stack.
 * The runtime expects already-validated subscriptions — we don't
 * re-validate here, only filter aggregator events by subscribed id.
 */
export type AggregatorSubscription = Readonly<{
  labelerId: string;
  /** Numeric priority — lower number = higher priority. `0` is reserved for the local source. */
  priority: number;
}>;

export type ComputeAggregatedReputationInput = Readonly<{
  /** Output of the Phase 1.8.2 local computer. */
  localState: LocalReputationState;
  /**
   * The user's currently-subscribed reputation aggregator labelers,
   * each with their priority in the Phase 1.66 stack. Subscriptions
   * with priority `0` are silently ignored (the local source owns
   * that slot).
   */
  subscriptions: ReadonlyArray<AggregatorSubscription>;
  /**
   * `reputation.aggregator.published` events the runtime has
   * received from any source. Events from labelers NOT in
   * `subscriptions` are silently ignored — the user has not opted
   * in to them.
   *
   * Each event must carry a `publisherLabelerId` so the runtime can
   * route it. This is the upstream caller's responsibility (the
   * event envelope's author is mapped to the labeler id during
   * ingestion).
   */
  aggregatorEvents: ReadonlyArray<AggregatorEventWithSource>;
  /**
   * Phase 1.8.8 — `reputation.aggregator.score.removed` events the
   * runtime has received. Optional (defaults to empty). Same opt-in
   * discipline as `aggregatorEvents`: removals from non-subscribed
   * labelers are silently ignored.
   *
   * A removal evicts the matching `(publisherLabelerId, subject)`
   * pair from the candidate set BEFORE composition. The local
   * source's score for that subject is unaffected — doctrine
   * non-negotiable "LOCAL ALWAYS #0" is preserved.
   *
   * A removal that does not match any current candidate (e.g.
   * arrives before the publish, or the publish was never
   * observed) is a no-op — the runtime fails open rather than
   * throwing on a stale removal.
   */
  removalEvents?: ReadonlyArray<AggregatorRemovalEventWithSource>;
}>;

export type AggregatorEventWithSource = Readonly<{
  publisherLabelerId: string;
  event: Extract<ReputationEvent, { kind: 'reputation.aggregator.published' }>;
}>;

/**
 * Phase 1.8.8 — `reputation.aggregator.score.removed` event with
 * source attribution. Same plumbing convention as
 * `AggregatorEventWithSource`: the upstream caller maps the event
 * envelope's author to a stable labelerId during ingestion.
 *
 * When a removal event is observed:
 *   - the matching `(publisherLabelerId, subject)` pair is purged
 *     from the runtime's candidate set, so the labeler's score for
 *     that subject no longer competes for placement in the view;
 *   - the LOCAL source's score for that subject continues to win
 *     when present (doctrine non-negotiable);
 *   - removal events from labelers NOT in `subscriptions` are
 *     silently ignored (opt-in discipline preserved).
 */
export type AggregatorRemovalEventWithSource = Readonly<{
  publisherLabelerId: string;
  event: Extract<ReputationEvent, { kind: 'reputation.aggregator.score.removed' }>;
}>;

/**
 * Compose `localState` with subscribed-aggregator output. Returns a
 * frozen `AggregatedReputationView`. Pure on its inputs.
 *
 * Composition rules (doctrine non-negotiable: local always #0):
 *
 *   1. For every subject in `localState.scores`, the local score
 *      wins regardless of any aggregator opinion.
 *   2. For every subject NOT in `localState.scores`, take the
 *      highest-priority subscribed aggregator's score for that
 *      subject (lower priority number = higher rank).
 *   3. Aggregator events from labelers NOT in `subscriptions` are
 *      silently dropped — the user has not opted in.
 *   4. Tie-breaks for two aggregators at the same priority go to
 *      ascending labeler id (replay-deterministic).
 */
export function computeAggregatedReputation(
  input: ComputeAggregatedReputationInput
): AggregatedReputationView {
  if (input === null || typeof input !== 'object') {
    throw tsError('TS_INVALID_INPUT', 'ComputeAggregatedReputationInput must be a plain object');
  }
  if (!Array.isArray(input.subscriptions)) {
    throw tsError('TS_INVALID_INPUT', 'input.subscriptions must be an array');
  }
  if (!Array.isArray(input.aggregatorEvents)) {
    throw tsError('TS_INVALID_INPUT', 'input.aggregatorEvents must be an array');
  }
  if (input.removalEvents !== undefined && !Array.isArray(input.removalEvents)) {
    throw tsError('TS_INVALID_INPUT', 'input.removalEvents must be an array when supplied');
  }

  // Build the priority map (subscribed labelerId → priority).
  // Subscriptions with priority 0 are silently dropped — local
  // owns that slot.
  const subscribedPriority = new Map<string, number>();
  for (const sub of input.subscriptions) {
    if (typeof sub.labelerId !== 'string' || sub.labelerId.length === 0) continue;
    if (typeof sub.priority !== 'number' || !Number.isFinite(sub.priority)) continue;
    if (!Number.isInteger(sub.priority) || sub.priority < 1) continue;
    // Last-write-wins on duplicate labelerId — the caller should
    // dedupe before calling; we do NOT throw.
    subscribedPriority.set(sub.labelerId, sub.priority);
  }

  // Aggregate per-subject candidates from subscribed events.
  // Map<subjectKey, Map<labelerId, AggregatorSubjectScore>>
  const candidates = new Map<SubjectKey, Map<string, AggregatorSubjectScore>>();
  for (const evt of input.aggregatorEvents) {
    if (typeof evt.publisherLabelerId !== 'string') continue;
    if (!subscribedPriority.has(evt.publisherLabelerId)) continue;
    for (const subject of evt.event.subjects) {
      const subjKey = subjectRefToKey(subject.subject);
      let perSubject = candidates.get(subjKey);
      if (perSubject === undefined) {
        perSubject = new Map();
        candidates.set(subjKey, perSubject);
      }
      // Last-write-wins per (subject, labeler) — newer events
      // supersede earlier ones from the same labeler.
      perSubject.set(evt.publisherLabelerId, subject);
    }
  }

  // Phase 1.8.8 — apply removals AFTER the candidate set is built.
  // Removals from non-subscribed labelers are silently ignored
  // (opt-in discipline preserved). Stale removals (no matching
  // candidate) are no-ops (fail open). After this pass, every
  // remaining candidate is one the aggregator currently endorses.
  const removalEvents = input.removalEvents ?? [];
  for (const removal of removalEvents) {
    if (typeof removal.publisherLabelerId !== 'string') continue;
    if (!subscribedPriority.has(removal.publisherLabelerId)) continue;
    const subjKey = subjectRefToKey(removal.event.subject);
    const perSubject = candidates.get(subjKey);
    if (perSubject === undefined) continue;
    perSubject.delete(removal.publisherLabelerId);
    if (perSubject.size === 0) candidates.delete(subjKey);
  }

  // Build the composed view. Iterate sorted local subject keys
  // first, then sorted aggregator-only keys, so the final Map
  // insertion order is replay-deterministic.
  const localKeys = [...input.localState.scores.keys()].sort();
  const aggregatorOnlyKeys = [...candidates.keys()]
    .filter((k) => !input.localState.scores.has(k))
    .sort();

  const entries = new Map<SubjectKey, AggregatedReputationEntry>();
  const contributors = new Set<ReputationSourceId>();

  // Local-wins phase.
  for (const key of localKeys) {
    const local = input.localState.scores.get(key)!;
    entries.set(
      key,
      Object.freeze({
        subject: key,
        score: local.score,
        confidence: local.confidence,
        priority: 0,
        sourceLabelerId: LOCAL_REPUTATION_SOURCE,
        seedDistance: local.seedDistance
      })
    );
    contributors.add(LOCAL_REPUTATION_SOURCE);
  }

  // Aggregator-only phase (subjects the local source did NOT score).
  for (const key of aggregatorOnlyKeys) {
    const perSubject = candidates.get(key)!;
    // Pick the candidate with the lowest priority value (highest
    // rank); ties broken by ascending labeler id.
    let bestLabelerId: string | undefined;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (const labelerId of [...perSubject.keys()].sort()) {
      const priority = subscribedPriority.get(labelerId)!;
      if (priority < bestPriority) {
        bestPriority = priority;
        bestLabelerId = labelerId;
      }
    }
    if (bestLabelerId === undefined) continue;
    const winner = perSubject.get(bestLabelerId)!;
    entries.set(
      key,
      Object.freeze({
        subject: key,
        score: clampUnitInterval(winner.score),
        confidence: clampUnitInterval(winner.confidence),
        priority: bestPriority,
        sourceLabelerId: bestLabelerId
      })
    );
    contributors.add(bestLabelerId);
  }

  return Object.freeze({
    version: AGGREGATED_REPUTATION_VIEW_VERSION,
    entries,
    contributingLabelers: Object.freeze([...contributors].sort())
  });
}

/* -------------------------------------------------------------------------- */
/*                              helpers                                       */
/* -------------------------------------------------------------------------- */

function clampUnitInterval(v: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/* -------------------------------------------------------------------------- */
/*                        export the local score type                         */
/* -------------------------------------------------------------------------- */

// Re-export for callers that hold a LocalReputationScore alongside
// the aggregated entry — convenient for the PWA UI layer.
export type { LocalReputationScore };
