/**
 * @lfp2p/openrank-adapter — Phase 1.8.11.
 *
 * Thin mapper from OpenRank-shaped HTTP responses to the Phase
 * 1.8.4 `AggregatorEventWithSource` records the reputation
 * aggregator runtime consumes.
 *
 * Doctrine boundary: this package is INTENTIONALLY OUTSIDE the
 * protocol core. The reputation graph doctrine
 * (`docs/protocol/reputation-graph-doctrine.md`) is explicit that
 * an external OpenRank dependency MUST NOT live in
 * `@lfp2p/trust-safety` — it would centralise the trust root.
 * Users opt in by subscribing to an OpenRank-derived labeler in
 * Phase 1.66; that labeler is the one running this adapter.
 *
 * Hardening posture:
 *
 *   1. Strict shape validation on every OpenRank response field.
 *      A hostile or malformed response surfaces as a fail-closed
 *      error rather than silently producing an empty event.
 *   2. Score / confidence clamped to [0, 1] (defense-in-depth even
 *      though the Phase 1.8.4 runtime clamps again).
 *   3. observationCount truncated to a safe non-negative integer.
 *   4. Per-batch subject cap mirrors the Phase 1.8.1
 *      `REPUTATION_LIMITS.maxSubjectsPerAggregatorBatch`. A larger
 *      response is split into multiple aggregator events
 *      deterministically (sorted by ascending actor id), so a
 *      hostile aggregator cannot DoS the consumer with a single
 *      multi-million-subject blob.
 *   5. The adapter NEVER performs the HTTP fetch itself. The
 *      caller supplies a `fetcher` function so:
 *       a. tests can mock deterministically,
 *       b. the network surface and authentication are the
 *          caller's responsibility (not the protocol's),
 *       c. the doctrine's "no on-chain trust" boundary is
 *          enforced — this adapter touches no chain, only HTTP.
 *   6. The output uses the `openrank.v1` algorithm id reserved at
 *      Phase 1.8.1 — same versioned identifier the local doctrine
 *      table declares.
 */

import {
  REPUTATION_EVENT_VERSION,
  REPUTATION_LIMITS,
  type AggregatorEventWithSource,
  type AggregatorSubjectScore,
  type ReputationEvent,
  type SafetySubjectRef
} from '@lfp2p/trust-safety';

export const OPENRANK_ADAPTER_VERSION = 'lfp2p.openrank-adapter.v1' as const;

/**
 * Raw OpenRank API row. We accept ONLY the fields we actually use;
 * extra fields are silently ignored. NaN / Infinity / out-of-range
 * values are normalized into safe defaults rather than throwing,
 * so an aggregator with a buggy producer cannot break the entire
 * batch — only that row is dropped.
 */
export type OpenRankRow = Readonly<{
  /**
   * OpenRank addresses subjects by Farcaster-style `fid` (numeric)
   * or an explicit actor id string. Both are accepted; the adapter
   * normalises numeric fids to the documented `actor:` string form.
   */
  fid?: number | string;
  actorId?: string;
  /** Float in `[0, 1]` per OpenRank API contract; clamped here. */
  score?: number;
  /** Float in `[0, 1]` per OpenRank API contract; clamped here. */
  confidence?: number;
  /** Non-negative integer; truncated + clamped. */
  observationCount?: number;
}>;

export type OpenRankResponse = Readonly<{
  /** Sequence number / page cursor — not consumed but tolerated. */
  cursor?: string;
  /** OpenRank's algorithm identifier; defaults to `openrank.v1`. */
  algorithm?: 'openrank.v1';
  /** Reference clock the aggregator computed at. ISO-8601. */
  computedAt?: string;
  /** Required: the per-subject rows. */
  rows: ReadonlyArray<OpenRankRow>;
}>;

export type OpenRankFetcher = (request: OpenRankFetchRequest) => Promise<OpenRankResponse>;

export type OpenRankFetchRequest = Readonly<{
  /** Labeler id for the source the user has subscribed to. */
  labelerId: string;
  /** Optional filter the caller may push down to the API. */
  subjectActorIds?: ReadonlyArray<string>;
  /** Optional pagination cursor passed through to the API. */
  cursor?: string;
}>;

export type OpenRankAdapterOptions = Readonly<{
  /**
   * The labeler id the user has subscribed to (Phase 1.66). This
   * id appears on the produced `AggregatorEventWithSource` so the
   * Phase 1.8.4 runtime can route the event to the right labeler
   * slot.
   */
  labelerId: string;
  /** Caller-supplied HTTP fetcher — see the security note above. */
  fetcher: OpenRankFetcher;
  /**
   * Optional clock for the adapter's `createdAt` / `computedAt`
   * field when the OpenRank response does not include one.
   * Defaults to `() => new Date().toISOString()`.
   */
  now?: () => string;
}>;

export type OpenRankAdapter = Readonly<{
  /**
   * Fetch + map. Returns ZERO or MORE
   * `AggregatorEventWithSource` records — multiple are produced
   * only when the response exceeds the per-event batch cap.
   *
   * Throws on a structurally invalid OpenRank response (missing
   * `rows` array, non-object payload). Hostile / malformed
   * INDIVIDUAL rows are dropped silently with no error — the
   * surrounding batch still ships.
   */
  fetchAggregatorEvents(
    request?: Omit<OpenRankFetchRequest, 'labelerId'>
  ): Promise<ReadonlyArray<AggregatorEventWithSource>>;
}>;

export function createOpenRankAdapter(options: OpenRankAdapterOptions): OpenRankAdapter {
  if (typeof options.labelerId !== 'string' || options.labelerId.length === 0) {
    throw new Error('createOpenRankAdapter: labelerId must be a non-empty string');
  }
  if (typeof options.fetcher !== 'function') {
    throw new Error('createOpenRankAdapter: fetcher must be a function');
  }
  const now = options.now ?? (() => new Date().toISOString());
  const labelerId = options.labelerId;

  return Object.freeze({
    fetchAggregatorEvents: async (request = {}) => {
      const response = await options.fetcher({
        labelerId,
        ...request
      });
      if (response === null || typeof response !== 'object') {
        throw new Error('OpenRank response must be an object');
      }
      if (!Array.isArray(response.rows)) {
        throw new Error('OpenRank response.rows must be an array');
      }
      const computedAt =
        typeof response.computedAt === 'string' && response.computedAt.length > 0
          ? response.computedAt
          : now();
      const algorithm = response.algorithm ?? 'openrank.v1';
      const subjects: AggregatorSubjectScore[] = [];
      for (const row of response.rows) {
        const score = mapOpenRankRow(row);
        if (score !== undefined) subjects.push(score);
      }
      if (subjects.length === 0) {
        return Object.freeze([] as ReadonlyArray<AggregatorEventWithSource>);
      }
      // Sort by ascending subject key so batches are
      // replay-deterministic on the same input set.
      subjects.sort((a, b) => {
        const ak = aggregatorSubjectKey(a);
        const bk = aggregatorSubjectKey(b);
        return ak < bk ? -1 : ak > bk ? 1 : 0;
      });
      // Split into per-event batches when over the cap.
      const out: AggregatorEventWithSource[] = [];
      const cap = REPUTATION_LIMITS.maxSubjectsPerAggregatorBatch;
      for (let i = 0; i < subjects.length; i += cap) {
        const slice = subjects.slice(i, i + cap);
        const event: Extract<ReputationEvent, { kind: 'reputation.aggregator.published' }> =
          Object.freeze({
            version: REPUTATION_EVENT_VERSION,
            eventId: `evt_openrank_${labelerId}_${i}_${computedAt}`,
            createdAt: now(),
            kind: 'reputation.aggregator.published',
            algorithm,
            computedAt,
            subjects: Object.freeze(slice)
          });
        out.push(
          Object.freeze({
            publisherLabelerId: labelerId,
            event
          })
        );
      }
      return Object.freeze(out);
    }
  });
}

/* -------------------------------------------------------------------------- */
/*                          row mapping + clamping                            */
/* -------------------------------------------------------------------------- */

function mapOpenRankRow(row: OpenRankRow | undefined): AggregatorSubjectScore | undefined {
  if (row === null || typeof row !== 'object') return undefined;
  const subject = normaliseSubject(row);
  if (subject === undefined) return undefined;
  const score = clampUnit(row.score);
  const confidence = clampUnit(row.confidence);
  const observationCount = clampSafeNonNegativeInteger(row.observationCount);
  return Object.freeze({
    subject,
    score,
    confidence,
    observationCount
  });
}

function normaliseSubject(row: OpenRankRow): SafetySubjectRef | undefined {
  if (typeof row.actorId === 'string' && row.actorId.length > 0) {
    return Object.freeze({ type: 'actor' as const, actorId: row.actorId });
  }
  if (typeof row.fid === 'string' && row.fid.length > 0) {
    return Object.freeze({ type: 'actor' as const, actorId: `fid:${row.fid}` });
  }
  if (typeof row.fid === 'number' && Number.isSafeInteger(row.fid) && row.fid >= 0) {
    return Object.freeze({ type: 'actor' as const, actorId: `fid:${row.fid}` });
  }
  return undefined;
}

function clampUnit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampSafeNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  if (value > REPUTATION_LIMITS.maxObservationCount) {
    return REPUTATION_LIMITS.maxObservationCount;
  }
  return Math.floor(value);
}

function aggregatorSubjectKey(score: AggregatorSubjectScore): string {
  const ref = score.subject;
  if (ref.type === 'actor') return `actor:${ref.actorId}`;
  // Fall back to a JSON serialization for non-actor subjects (rare
  // for OpenRank but possible for community-curated adapters). The
  // exact form is replay-deterministic.
  return JSON.stringify(ref);
}
