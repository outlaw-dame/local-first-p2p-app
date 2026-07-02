/**
 * Phase 1.8.2 — local personalized EigenTrust computer.
 *
 * Pure runtime-agnostic function that takes a frozen
 * `ReputationGraphInputs` and produces a frozen
 * `LocalReputationState` of per-subject scores. The computation
 * follows the doctrine
 * (`docs/protocol/reputation-graph-doctrine.md` — "Algorithm" section):
 *
 *   1. Apply revocations.
 *   2. Drop observations past the window cutoff; drop expired
 *      attestations.
 *   3. Aggregate each (observer, subject) raw weight from
 *      observations (+sat − unsat, time-decayed) and attestations
 *      (strength × valence-sign, time-decayed, valence=`dispute`
 *      contributes 0 — it is informational only).
 *   4. Truncate to `maxNodes` (deterministic by ascending stable
 *      id sort) and `maxEdgesPerNode` per observer (keep highest
 *      weight, ties broken by ascending subject id).
 *   5. Row-normalize per Kamvar: negative entries → 0, then divide
 *      by row sum. Observers whose row sums to zero have no
 *      preference and contribute nothing on the matrix-vector step.
 *   6. Build the personalization vector `p` from `seedContacts`
 *      (strength × time-decay since attestation), then normalize so
 *      `Σp = 1`. If `Σp = 0` after time-decay (no live seed) we
 *      fail-closed deterministically with an empty score map —
 *      this is a doctrine-compliant degraded input, NOT an error.
 *   7. Iterate `t = (1 − α) · p + α · Cᵀ · t` until
 *      `max|t_new − t_old| < convergenceThreshold` or
 *      `maxIterations`. NaN / Infinity in any iteration aborts the
 *      loop and returns `convergedWithinIterations: false` with
 *      empty scores — defense-in-depth even though Phase 1.8.1
 *      input validation already rejects NaN/Infinity counts.
 *   8. Compute `seedDistance` per subject via BFS from seed nodes
 *      through the directed edges (observer → subject) using only
 *      non-zero weights. Subjects unreachable from any seed get
 *      `Number.POSITIVE_INFINITY`.
 *   9. Deep-freeze the output state per Phase 3.2 frozen-walk.
 *
 * What this slice DOES NOT do:
 *   - Sybil-hardening layers (clique penalty, path-quality damping,
 *     fingerprint amplifier beyond the seed band, time-window
 *     aggregation across multiple windows). Those land in
 *     Phase 1.8.5 and are pinned by their own adversarial tests.
 *     The configuration fields exist on `ReputationGraphConfig` today so
 *     the wire shape does not need to change at 1.8.5.
 *
 * Determinism notes (Phase 3.2 replay equivalence):
 *   - Every loop iterates a sorted array of keys, never a Map
 *     iteration order, so two runs over the same input produce
 *     byte-identical output even if the caller hashed key insertion
 *     differently.
 *   - Floating-point summations happen in sorted-key order, so a
 *     re-ordering of the input array CANNOT change the result.
 *   - `Math.pow(2, x)` and `Math.exp` are spec-deterministic across
 *     V8 / SpiderMonkey / JavaScriptCore on the same input.
 */

import { tsError } from '../errors.js';
import { assertPlainObject } from '../validation.js';
import {
  DEFAULT_REPUTATION_CONFIG,
  resolveReputationGraphConfig,
  type ReputationGraphConfig
} from './config.js';
import type { ObserverKey, ReputationGraphInputs, SubjectKey } from './inputs.js';
import { REPUTATION_LIMITS } from './constants.js';
import {
  applyCliquePenalty,
  applyEdgeMultipliers,
  compressByTimeBucket
} from './sybil-hardening.js';

export const LOCAL_REPUTATION_STATE_VERSION = 'lfp2p.reputation-graph.v1' as const;

export type LocalReputationScore = Readonly<{
  /** `[0, 1]` — clamped final score. Sum across all subjects ≤ 1. */
  score: number;
  /** `[0, 1]` — derived from observation density and convergence. */
  confidence: number;
  /** Hops from the nearest seed in the directed trust graph. `+Infinity` if unreachable. */
  seedDistance: number;
}>;

export type LocalReputationState = Readonly<{
  version: typeof LOCAL_REPUTATION_STATE_VERSION;
  /** Reference clock used (echoed for audit). */
  computedAtMs: number;
  /** `true` when `maxNodes` was hit and lower-sorted nodes were dropped. */
  truncated: boolean;
  /** `true` when the iteration converged within `maxIterations`. */
  convergedWithinIterations: boolean;
  /** Final iteration count actually used. */
  iterations: number;
  /** Keyed by `SubjectKey`. Insertion order is sorted-ascending so the Map serializes deterministically. */
  scores: ReadonlyMap<SubjectKey, LocalReputationScore>;
  /** Echoed config so audit + replay carry the parameters used. */
  config: ReputationGraphConfig;
}>;

export function computeReputation(inputs: ReputationGraphInputs): LocalReputationState {
  if (inputs === null || typeof inputs !== 'object') {
    throw tsError('TS_INVALID_INPUT', 'ReputationGraphInputs must be a plain object');
  }
  assertPlainObject(inputs, 'ReputationGraphInputs');
  if (!Array.isArray(inputs.observations)) {
    throw tsError('TS_INVALID_INPUT', 'inputs.observations must be an array');
  }
  if (!Array.isArray(inputs.attestations)) {
    throw tsError('TS_INVALID_INPUT', 'inputs.attestations must be an array');
  }
  if (!Array.isArray(inputs.revocations)) {
    throw tsError('TS_INVALID_INPUT', 'inputs.revocations must be an array');
  }
  if (!Array.isArray(inputs.seedContacts)) {
    throw tsError('TS_INVALID_INPUT', 'inputs.seedContacts must be an array');
  }

  const config = resolveReputationGraphConfig({});
  const nowMs = resolveNowMs(inputs);

  // ---- Step 1: apply revocations --------------------------------------
  const revokedIds = new Set<string>();
  for (const r of inputs.revocations) revokedIds.add(r.attestationId);
  const liveAttestations = inputs.attestations.filter((a) => !revokedIds.has(a.attestationId));

  // ---- Step 2: window + expiry cutoffs --------------------------------
  const observationCutoffMs = nowMs - config.observationWindowMs;
  const filteredObservations = inputs.observations.filter((o) => {
    const winEndMs = parseIsoOrZero(o.windowEnd);
    return winEndMs >= observationCutoffMs;
  });
  const unexpiredAttestations = liveAttestations.filter((a) => {
    if (a.expiresAt === undefined) return true;
    const expMs = parseIsoOrZero(a.expiresAt);
    return expMs >= nowMs;
  });

  // ---- Step 2.5 (Phase 1.8.5): time-bucket burst compression ---------
  // Aggregates observations by (observer, subject, bucket) and
  // applies a sqrt-style concave compression so a single burst
  // counts less than the same volume spread across multiple
  // buckets. Resists "trust laundering" via short-lived hot
  // accounts.
  const liveObservations = compressByTimeBucket(filteredObservations, config);

  // ---- Step 3: aggregate raw weights ----------------------------------
  // raw[observer][subject] = signed contribution; negative or zero
  // entries get zeroed during row-normalization per Kamvar.
  const raw = new Map<ObserverKey, Map<SubjectKey, number>>();
  for (const o of liveObservations) {
    const obsAgeMs = Math.max(0, nowMs - parseIsoOrZero(o.windowEnd));
    const decay = timeDecay(obsAgeMs, config.timeDecayHalfLifeMs);
    const delta = (o.satCount - o.unsatCount) * decay;
    if (!Number.isFinite(delta)) continue;
    addRaw(raw, o.observer, o.subject, delta);
  }
  for (const a of unexpiredAttestations) {
    const ageMs = Math.max(0, nowMs - parseIsoOrZero(a.createdAt));
    const decay = timeDecay(ageMs, config.timeDecayHalfLifeMs);
    const sign = a.valence === 'positive' ? 1 : a.valence === 'negative' ? -1 : 0;
    // Attestations carry more weight per "event" than a single
    // observation (the user explicitly attested rather than just
    // counted), so scale `strength` by a fixed multiplier. The
    // multiplier (10) is chosen so an attestation of strength 0.5
    // is worth 5 satisfied observations.
    const delta = sign * a.strength * decay * 10;
    if (!Number.isFinite(delta)) continue;
    addRaw(raw, a.observer, a.subject, delta);
  }

  // ---- Step 3.5 (Phase 1.8.5): fingerprint amplifier + path damping ----
  // Edges with a positive `contact.verified-in-person` /
  // `contact.long-term-correspondence` attestation get a
  // fingerprintAmplifier boost; edges with NO positive attestation
  // get the pathQualityDamping multiplier. Both fold into the raw
  // weights BEFORE row-normalization, so single-edge rows are
  // unaffected (post-normalization weight is 1 regardless) and
  // multi-edge rows favor attested + fingerprint edges. Closes the
  // community-structure / eigenvector-centrality attack and gives
  // out-of-band human verification a permanent path-weight boost.
  const rawHardened = applyEdgeMultipliers(raw, unexpiredAttestations, config);

  // ---- Step 4: build node universe + truncate -------------------------
  const nodeSet = new Set<string>();
  for (const o of inputs.seedContacts) nodeSet.add(o.subject);
  for (const [observer, edges] of rawHardened) {
    nodeSet.add(observer);
    for (const subject of edges.keys()) nodeSet.add(subject);
  }
  // Stable ascending id sort so truncation is replay-deterministic.
  const sortedNodes = [...nodeSet].sort();
  let truncated = false;
  let nodes: string[] = sortedNodes;
  if (sortedNodes.length > config.maxNodes) {
    nodes = sortedNodes.slice(0, config.maxNodes);
    truncated = true;
  }
  const liveNodes = new Set(nodes);

  // ---- Step 5: row-normalize the trust matrix C ------------------------
  // C[observer][subject] = normalized weight ∈ [0, 1] with Σ_subject C[observer][subject] = 1 OR 0.
  const C = new Map<ObserverKey, ReadonlyMap<SubjectKey, number>>();
  for (const [observer, edges] of rawHardened) {
    if (!liveNodes.has(observer)) continue;
    // Filter edges to live subjects + cap to maxEdgesPerNode by
    // descending positive weight, ties broken by ascending subject id.
    const positives: Array<readonly [SubjectKey, number]> = [];
    for (const [subject, weight] of edges) {
      if (!liveNodes.has(subject)) continue;
      const positive = Math.max(0, weight);
      if (positive > 0) positives.push([subject, positive]);
    }
    positives.sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    const capped = positives.slice(0, config.maxEdgesPerNode);
    const rowSum = capped.reduce((s, [, w]) => s + w, 0);
    if (rowSum <= 0 || !Number.isFinite(rowSum)) continue;
    const row = new Map<SubjectKey, number>();
    // Re-sort by ascending subject id so the per-row insertion
    // order is replay-deterministic.
    capped.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [subject, w] of capped) row.set(subject, w / rowSum);
    C.set(observer, Object.freeze(row));
  }

  // ---- Step 6: seed personalization vector p --------------------------
  const pRaw = new Map<SubjectKey, number>();
  for (const seed of inputs.seedContacts) {
    if (!liveNodes.has(seed.subject)) continue;
    const ageMs = Math.max(0, nowMs - parseIsoOrZero(seed.attestedAt));
    const decay = timeDecay(ageMs, config.timeDecayHalfLifeMs);
    const w = clampUnitInterval(seed.strength) * decay;
    if (!Number.isFinite(w) || w <= 0) continue;
    pRaw.set(seed.subject, (pRaw.get(seed.subject) ?? 0) + w);
  }
  const pSum = [...pRaw.values()].reduce((s, w) => s + w, 0);
  if (pSum <= 0 || !Number.isFinite(pSum) || nodes.length === 0) {
    // Degraded input: no seed survived time-decay. Doctrine
    // non-negotiable #1 ("reputation is per-user") makes this an
    // empty-output case rather than an error — different users with
    // no seeds get the same empty result.
    return freezeState({
      version: LOCAL_REPUTATION_STATE_VERSION,
      computedAtMs: nowMs,
      truncated,
      convergedWithinIterations: true,
      iterations: 0,
      scores: new Map<SubjectKey, LocalReputationScore>(),
      config
    });
  }
  // p only spans seed subjects; everything else has p_j = 0.
  const p = new Map<SubjectKey, number>();
  for (const node of nodes) {
    const raw_p = pRaw.get(node) ?? 0;
    if (raw_p > 0) p.set(node, raw_p / pSum);
  }

  // ---- Step 7: iterate personalized PageRank --------------------------
  // We update only the values vector keyed by node id. Initial vector
  // = p (a standard personalized PageRank choice that converges
  // faster than uniform on graphs with strong personalization).
  let t = new Map<SubjectKey, number>();
  for (const node of nodes) t.set(node, p.get(node) ?? 0);

  let iterations = 0;
  let convergedWithinIterations = false;
  let aborted = false;
  for (let k = 0; k < config.maxIterations; k++) {
    iterations = k + 1;
    const tNew = new Map<SubjectKey, number>();
    // Initialize with the (1 − α) · p term.
    for (const node of nodes) {
      const personalization = p.get(node) ?? 0;
      tNew.set(node, (1 - config.damping) * personalization);
    }
    // Add α · Cᵀ · t. Iterate observers in sorted order to keep
    // summation order deterministic.
    for (const observer of nodes) {
      const row = C.get(observer);
      if (row === undefined) continue;
      const tObs = t.get(observer) ?? 0;
      if (tObs === 0) continue;
      const factor = config.damping * tObs;
      // Iterate row subjects in sorted order (already the case
      // since we re-sorted on insertion in step 5).
      for (const [subject, c] of row) {
        const prev = tNew.get(subject) ?? 0;
        const next = prev + c * factor;
        if (!Number.isFinite(next)) {
          aborted = true;
          break;
        }
        tNew.set(subject, next);
      }
      if (aborted) break;
    }
    if (aborted) break;
    // Convergence check on max delta across all nodes.
    let maxDelta = 0;
    for (const node of nodes) {
      const dv = Math.abs((tNew.get(node) ?? 0) - (t.get(node) ?? 0));
      if (dv > maxDelta) maxDelta = dv;
    }
    t = tNew;
    if (maxDelta < config.convergenceThreshold) {
      convergedWithinIterations = true;
      break;
    }
  }
  if (aborted) {
    return freezeState({
      version: LOCAL_REPUTATION_STATE_VERSION,
      computedAtMs: nowMs,
      truncated,
      convergedWithinIterations: false,
      iterations,
      scores: new Map<SubjectKey, LocalReputationScore>(),
      config
    });
  }

  // ---- Step 7.5 (Phase 1.8.5): clique penalty --------------------------
  // For every SCC of size ≥ 2 with no outbound edges to nodes
  // outside the SCC, multiply each member's eigenvector entry by
  // `(1 / size)^cliquePenaltyExponent`. Closes the feedback-clique
  // attack (N mutually-rating accounts pay a 1/√N penalty by
  // default). Score-only modification — topology is unchanged so
  // the subsequent BFS for seed distance still walks the original
  // graph.
  const tPenalized = applyCliquePenalty<{ score: number }>(
    new Map([...t.entries()].map(([k, v]) => [k, { score: v }])),
    C,
    nodes,
    config
  );

  // ---- Step 8: seed-distance BFS --------------------------------------
  const seedDistance = computeSeedDistances(C, p, nodes);

  // ---- Step 9: build the score map ------------------------------------
  const scores = new Map<SubjectKey, LocalReputationScore>();
  // Pre-compute observation density per subject for the confidence
  // factor. Density counts the number of distinct observers that
  // contributed a positive raw weight toward this subject.
  const observersPerSubject = new Map<SubjectKey, number>();
  for (const [, edges] of raw) {
    for (const [subject, weight] of edges) {
      if (!liveNodes.has(subject)) continue;
      if (weight <= 0) continue;
      observersPerSubject.set(subject, (observersPerSubject.get(subject) ?? 0) + 1);
    }
  }
  // Insert in sorted node order so the Map's serialization order is
  // deterministic.
  for (const node of nodes) {
    const rawT = tPenalized.get(node)?.score ?? 0;
    if (rawT <= 0) continue;
    const clamped = Math.min(1, Math.max(0, rawT));
    const obsN = observersPerSubject.get(node) ?? 0;
    const dist = seedDistance.get(node) ?? Number.POSITIVE_INFINITY;
    const confidence = computeConfidence(obsN, convergedWithinIterations, dist);
    scores.set(
      node,
      Object.freeze<LocalReputationScore>({
        score: clamped,
        confidence,
        seedDistance: dist
      })
    );
  }

  return freezeState({
    version: LOCAL_REPUTATION_STATE_VERSION,
    computedAtMs: nowMs,
    truncated,
    convergedWithinIterations,
    iterations,
    scores,
    config
  });
}

/* -------------------------------------------------------------------------- */
/*                                helpers                                     */
/* -------------------------------------------------------------------------- */

function timeDecay(ageMs: number, halfLifeMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0;
  if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) return 0;
  // Math.pow(2, x) is spec-deterministic on IEEE-754.
  return Math.pow(2, -ageMs / halfLifeMs);
}

function parseIsoOrZero(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function clampUnitInterval(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function addRaw(
  raw: Map<ObserverKey, Map<SubjectKey, number>>,
  observer: ObserverKey,
  subject: SubjectKey,
  delta: number
): void {
  let row = raw.get(observer);
  if (row === undefined) {
    row = new Map<SubjectKey, number>();
    raw.set(observer, row);
  }
  row.set(subject, (row.get(subject) ?? 0) + delta);
}

function computeSeedDistances(
  C: ReadonlyMap<ObserverKey, ReadonlyMap<SubjectKey, number>>,
  p: ReadonlyMap<SubjectKey, number>,
  nodes: readonly string[]
): Map<SubjectKey, number> {
  // BFS from every seed node simultaneously, returning the minimum
  // hop count per subject. Edges are (observer → subject) wherever
  // C[observer][subject] > 0.
  const distance = new Map<SubjectKey, number>();
  const queue: string[] = [];
  for (const node of nodes) {
    if ((p.get(node) ?? 0) > 0) {
      distance.set(node, 0);
      queue.push(node);
    }
  }
  // Stable BFS order: dequeue in insertion order, but enqueue in
  // sorted neighbour order so two runs trace the same exploration.
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    const currentDist = distance.get(current)!;
    const row = C.get(current);
    if (row === undefined) continue;
    const neighbours: SubjectKey[] = [];
    for (const subject of row.keys()) neighbours.push(subject);
    neighbours.sort();
    for (const neighbour of neighbours) {
      if (distance.has(neighbour)) continue;
      distance.set(neighbour, currentDist + 1);
      queue.push(neighbour);
    }
  }
  return distance;
}

function computeConfidence(
  observationCount: number,
  convergedWithinIterations: boolean,
  seedDistance: number
): number {
  // Density factor: log10(obsN + 1) / 4, capped at 1. Saturates near
  // ~10 000 observations — chosen so an account with one or two
  // observers has a documented low confidence rather than a
  // spuriously high one.
  const densityFactor = Math.min(1, Math.log10(observationCount + 1) / 4);
  // Convergence factor: a non-converged iteration cuts confidence
  // sharply but does not zero it (the score might still be
  // approximately correct).
  const convergenceFactor = convergedWithinIterations ? 1 : 0.1;
  // Reachability factor: scores for subjects far from the seed set
  // are inherently less trustworthy. Decays geometrically with hop
  // count and caps at 1.0 (seed itself).
  const reachabilityFactor = Number.isFinite(seedDistance) ? Math.pow(0.7, seedDistance) : 0;
  return clampUnitInterval(densityFactor * convergenceFactor * reachabilityFactor);
}

function freezeState(state: Omit<LocalReputationState, never>): LocalReputationState {
  // Freeze the scores Map's value records (already frozen on
  // insert) and the outer state itself. JS Maps' internal structure
  // is not freezable but our consumer surface treats the Map as
  // immutable — and the Phase 3.2 frozen-walk test pins this.
  return Object.freeze({
    version: state.version,
    computedAtMs: state.computedAtMs,
    truncated: state.truncated,
    convergedWithinIterations: state.convergedWithinIterations,
    iterations: state.iterations,
    scores: state.scores,
    config: state.config
  });
}

function resolveNowMs(inputs: ReputationGraphInputs): number {
  if (inputs.nowIso !== undefined) {
    const ms = Date.parse(inputs.nowIso);
    if (!Number.isFinite(ms)) {
      throw tsError('TS_INVALID_TIMESTAMP', 'inputs.nowIso did not parse as a valid date');
    }
    return ms;
  }
  // Pure on arguments: if no explicit `now`, take the maximum
  // `createdAt` across inputs. This makes the function pure on its
  // arguments (no implicit Date.now()) — critical for replay
  // equivalence in tests.
  let maxMs = 0;
  for (const o of inputs.observations) {
    const ms = parseIsoOrZero(o.createdAt);
    if (ms > maxMs) maxMs = ms;
  }
  for (const a of inputs.attestations) {
    const ms = parseIsoOrZero(a.createdAt);
    if (ms > maxMs) maxMs = ms;
  }
  for (const r of inputs.revocations) {
    const ms = parseIsoOrZero(r.revokedAt);
    if (ms > maxMs) maxMs = ms;
  }
  for (const s of inputs.seedContacts) {
    const ms = parseIsoOrZero(s.attestedAt);
    if (ms > maxMs) maxMs = ms;
  }
  // Fall back to a fixed sentinel if every input was empty/zero, so
  // the timeDecay math doesn't divide by absurd ages on cold-start
  // inputs.
  return maxMs > 0 ? maxMs : 0;
}

/* -------------------------------------------------------------------------- */
/*                           constants re-export                              */
/* -------------------------------------------------------------------------- */

// Re-export REPUTATION_LIMITS so callers that hold a config object
// can find the hard upper bounds defined alongside the protocol
// layer.
export { REPUTATION_LIMITS, DEFAULT_REPUTATION_CONFIG };
