/**
 * Phase 1.8.2 — `ReputationGraphConfig` and defaults.
 *
 * Every default comes verbatim from the doctrine
 * (`docs/protocol/reputation-graph-doctrine.md` — "Algorithm:
 * local personalized EigenTrust + improvements" section). Caller-
 * supplied overrides are validated against the same range checks
 * the protocol-layer validator uses (Phase 1.8.1), so a hostile
 * config cannot pass invariants the runtime relies on.
 *
 * The doctrine non-negotiable #6 ("deterministic, replayable, and
 * bounded") is enforced HERE — every cap that the computer relies
 * on for termination + memory bounds lives in this record and is
 * range-checked on construction.
 */

import { tsError } from '../errors.js';
import { assertFiniteNumberInRange, assertPlainObject } from '../validation.js';

export type ReputationGraphConfig = Readonly<{
  /**
   * Personalization damping. `(1 - damping)` is the probability of
   * teleporting back to the seed vector on each iteration. Tradition
   * from PageRank: 0.85 is the standard. Smaller values pull more
   * strongly toward the seed (less transitive trust); larger values
   * give more weight to walks through observations (more transitive,
   * more vulnerable to centrality attacks).
   */
  damping: number;
  /**
   * Hard cap on graph node count. Anything beyond is truncated
   * deterministically by ascending stable id sort. Keeps memory
   * predictable on hostile inputs (e.g., a flood of one-off
   * observations referencing random subjects).
   */
  maxNodes: number;
  /**
   * Hard cap on outgoing edges per observer. Beyond this we keep the
   * highest-weighted edges (ties broken by ascending subject id).
   * Protects per-iteration work from a hostile observer who
   * observes about every subject in the graph.
   */
  maxEdgesPerNode: number;
  /** Iteration ceiling. Computation terminates after this many even if not converged. */
  maxIterations: number;
  /**
   * Convergence: stop iterating once `max|t_new − t_old| < threshold`.
   * Smaller threshold = more iterations = more accurate at the cost
   * of CPU.
   */
  convergenceThreshold: number;
  /**
   * Observation-window cutoff: observations whose `windowEnd` is
   * older than `now - observationWindowMs` are dropped before the
   * trust matrix is built.
   */
  observationWindowMs: number;
  /**
   * Time-decay half-life: a contribution from time `t` ago is
   * multiplied by `2^(-t / halfLife)`. The doctrine default (14d)
   * means an observation from two weeks ago contributes ~50% of a
   * fresh one.
   */
  timeDecayHalfLifeMs: number;
  /**
   * Exponent used in Phase 1.8.5 clique-detection penalty. Stored
   * here so Phase 1.8.2 already carries the configuration shape; the
   * computer in 1.8.2 does not yet apply the penalty (that lands in
   * 1.8.5) but a caller that builds the config can already pin the
   * value.
   */
  cliquePenaltyExponent: number;
  /**
   * Multiplier applied per non-attested hop in Phase 1.8.5 path-
   * quality damping. Edge re-weighting BEFORE row normalization:
   * non-attested edges contribute `pathQualityDamping ×` their raw
   * weight. Single-edge rows are unaffected (row-normalizes to 1
   * regardless); multi-edge rows favor attested edges. Default 0.7.
   */
  pathQualityDamping: number;
  /**
   * Phase 1.8.5 — fingerprint amplifier. Edges backed by an
   * attestation with `contextTag` `contact.verified-in-person` or
   * `contact.long-term-correspondence` get their raw weight
   * multiplied by this factor before row-normalization. Default
   * 1.5. This is the doctrine's "one signal an on-chain protocol
   * structurally cannot replicate" — out-of-band human verification
   * earns a permanent path-weight boost.
   */
  fingerprintAmplifier: number;
  /**
   * Phase 1.8.5 — observation bucket size in ms. Observations from
   * the same (observer, subject) within the same bucket are
   * aggregated together, and a concave compression function (sqrt)
   * is applied per-bucket so a 10000-count burst contributes far
   * less than 10 × 1000-count buckets. Resists "trust laundering"
   * via short-lived hot accounts. Default 24h.
   */
  observationBucketMs: number;
}>;

/**
 * Doctrine-verbatim defaults. Frozen so a caller cannot accidentally
 * mutate the shared baseline.
 */
export const DEFAULT_REPUTATION_CONFIG: ReputationGraphConfig = Object.freeze({
  damping: 0.85,
  maxNodes: 100_000,
  maxEdgesPerNode: 500,
  maxIterations: 100,
  convergenceThreshold: 1e-6,
  observationWindowMs: 30 * 24 * 60 * 60 * 1_000, // 30 days
  timeDecayHalfLifeMs: 14 * 24 * 60 * 60 * 1_000, // 14 days
  cliquePenaltyExponent: 0.5,
  pathQualityDamping: 0.7,
  fingerprintAmplifier: 1.5,
  observationBucketMs: 24 * 60 * 60 * 1_000 // 24h
} as const);

/**
 * Resolve a partial caller-supplied override into a fully-populated
 * frozen `ReputationGraphConfig`. Every override is range-checked; an
 * out-of-range or non-finite override throws a `TrustSafetyError`
 * (not silently coerced — the doctrine requires fail-closed on
 * misconfiguration).
 *
 * Allowed ranges (per doctrine + sanity bounds):
 *   - damping ∈ (0, 1)            (0 makes the algorithm uniform;
 *                                  1 makes it ignore personalization
 *                                  — both are anti-patterns)
 *   - maxNodes ∈ [1, 10_000_000]
 *   - maxEdgesPerNode ∈ [1, maxNodes]
 *   - maxIterations ∈ [1, 10_000]
 *   - convergenceThreshold ∈ (0, 1)
 *   - observationWindowMs ∈ [1_000, 365 * 24 * 60 * 60 * 1_000]
 *   - timeDecayHalfLifeMs ∈ [1_000, observationWindowMs]
 *   - cliquePenaltyExponent ∈ [0, 4]
 *   - pathQualityDamping ∈ (0, 1]
 */
export function resolveReputationGraphConfig(
  override: Partial<ReputationGraphConfig> = {}
): ReputationGraphConfig {
  if (override !== undefined && override !== null && typeof override !== 'object') {
    throw tsError('TS_INVALID_INPUT', 'reputation config override must be a plain object');
  }
  if (override !== null && typeof override === 'object') {
    assertPlainObject(override, 'ReputationGraphConfig');
  }
  const merged = { ...DEFAULT_REPUTATION_CONFIG, ...override };

  // damping: open (0, 1)
  assertFiniteNumberInRange(merged.damping, 'damping', Number.EPSILON, 1 - Number.EPSILON);

  assertSafePositiveInteger(merged.maxNodes, 'maxNodes', 1, 10_000_000);
  assertSafePositiveInteger(merged.maxEdgesPerNode, 'maxEdgesPerNode', 1, merged.maxNodes);
  assertSafePositiveInteger(merged.maxIterations, 'maxIterations', 1, 10_000);

  assertFiniteNumberInRange(
    merged.convergenceThreshold,
    'convergenceThreshold',
    Number.MIN_VALUE,
    1 - Number.EPSILON
  );

  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000;
  assertSafePositiveInteger(merged.observationWindowMs, 'observationWindowMs', 1_000, ONE_YEAR_MS);
  assertSafePositiveInteger(
    merged.timeDecayHalfLifeMs,
    'timeDecayHalfLifeMs',
    1_000,
    merged.observationWindowMs
  );

  assertFiniteNumberInRange(merged.cliquePenaltyExponent, 'cliquePenaltyExponent', 0, 4);
  assertFiniteNumberInRange(merged.pathQualityDamping, 'pathQualityDamping', Number.EPSILON, 1);
  // fingerprintAmplifier must be >= 1 — a value < 1 would penalize
  // fingerprint-verified contacts, inverting the doctrine intent.
  // Upper bound 10 prevents a misconfiguration that would dwarf
  // all other signals.
  assertFiniteNumberInRange(merged.fingerprintAmplifier, 'fingerprintAmplifier', 1, 10);
  // observationBucketMs must be positive and ≤ observationWindowMs
  // (a bucket longer than the window has zero buckets to compress).
  assertSafePositiveInteger(
    merged.observationBucketMs,
    'observationBucketMs',
    1_000,
    merged.observationWindowMs
  );

  return Object.freeze({ ...merged });
}

function assertSafePositiveInteger(
  value: unknown,
  label: string,
  min: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw tsError('TS_INVALID_NUMBER', `${label} must be a safe integer`);
  }
  if (value < min || value > max) {
    throw tsError('TS_INVALID_NUMBER', `${label} value ${value} is outside [${min}, ${max}]`);
  }
  return value;
}
