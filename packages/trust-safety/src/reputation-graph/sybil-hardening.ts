/**
 * Phase 1.8.5 — sybil-hardening layers.
 *
 * Four pure helpers wired into `computeReputation` at distinct
 * pipeline stages:
 *
 *   1. `compressByTimeBucket`     (pre-aggregation)
 *   2. `applyFingerprintAmplifier` (raw-weight stage)
 *   3. `applyPathQualityDamping`   (raw-weight stage, after 2)
 *   4. `applyCliquePenalty`        (post-iteration)
 *
 * Each helper is exposed for unit testing AND for advanced consumers
 * that may want to apply hardening to externally-aggregated graphs
 * (Phase 1.8.4 aggregator labelers, for example).
 *
 * Determinism: every helper iterates sorted-key arrays. Floating
 * point math uses `Math.sqrt` / `Math.pow` which are spec-
 * deterministic on IEEE-754, so the Phase 3.2 replay-equivalence
 * invariant continues to hold.
 *
 * Defense-in-depth: every helper that touches the C matrix freezes
 * each inner row on construction. The outer computer wraps the
 * final state in a single deep-freeze pass.
 */

import type { ReputationGraphConfig } from './config.js';
import type {
  AttestationRecord,
  ObservationRecord,
  ObserverKey,
  SubjectKey
} from './inputs.js';

/* -------------------------------------------------------------------------- */
/*                1. time-bucket burst compression                            */
/* -------------------------------------------------------------------------- */

/**
 * Bucket observations by `floor(windowEndMs / observationBucketMs)`,
 * then apply a `sqrt`-style concave compression per bucket: the
 * effective sat / unsat per bucket is `sign × sqrt(|x|)`.
 *
 * The intuition: a single burst of 10,000 satisfied events in one
 * day produces `sqrt(10_000) = 100` units of trust; the same 10,000
 * events spread across 10 days produce `10 × sqrt(1000) ≈ 316`
 * units of trust. Spread is rewarded > 3×, burst is penalized.
 *
 * The returned array is a NEW array of `ObservationRecord`s (one
 * per bucket per (observer, subject)). The compressor preserves
 * ALL original metadata of the LAST observation in each bucket
 * (observation kind, createdAt, etc.) — the compression is purely
 * on the count fields.
 *
 * Determinism: iterates sorted (observer, subject, bucket) keys
 * when constructing the output.
 */
export function compressByTimeBucket(
  observations: ReadonlyArray<ObservationRecord>,
  config: ReputationGraphConfig
): ReadonlyArray<ObservationRecord> {
  // Bucket key: `${observer}|${subject}|${bucketIndex}` so two
  // distinct observers cannot collide and the bucket index is a
  // small integer (replay-deterministic).
  type BucketAcc = {
    observer: ObserverKey;
    subject: SubjectKey;
    bucketIndex: number;
    rawSat: number;
    rawUnsat: number;
    observationKind: ObservationRecord['observationKind'];
    windowStart: string;
    windowEnd: string;
    createdAt: string;
  };
  const buckets = new Map<string, BucketAcc>();
  for (const o of observations) {
    const endMs = parseIsoOrZero(o.windowEnd);
    const bucketIndex = Math.floor(endMs / config.observationBucketMs);
    const key = `${o.observer}|${o.subject}|${bucketIndex}`;
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, {
        observer: o.observer,
        subject: o.subject,
        bucketIndex,
        rawSat: o.satCount,
        rawUnsat: o.unsatCount,
        observationKind: o.observationKind,
        windowStart: o.windowStart,
        windowEnd: o.windowEnd,
        createdAt: o.createdAt
      });
    } else {
      existing.rawSat += o.satCount;
      existing.rawUnsat += o.unsatCount;
      // Track the latest windowEnd / createdAt in the bucket so
      // time-decay uses the most-recent observation as reference.
      if (parseIsoOrZero(o.windowEnd) > parseIsoOrZero(existing.windowEnd)) {
        existing.windowEnd = o.windowEnd;
      }
      if (parseIsoOrZero(o.createdAt) > parseIsoOrZero(existing.createdAt)) {
        existing.createdAt = o.createdAt;
      }
      if (parseIsoOrZero(o.windowStart) < parseIsoOrZero(existing.windowStart)) {
        existing.windowStart = o.windowStart;
      }
    }
  }
  // Iterate sorted keys for replay-determinism.
  const sortedKeys = [...buckets.keys()].sort();
  const out: ObservationRecord[] = [];
  for (const key of sortedKeys) {
    const b = buckets.get(key)!;
    // Concave compression: sign-preserving sqrt. The compressed
    // counts MAY be fractional (e.g. sqrt(7) ≈ 2.65), but the
    // computer downstream multiplies these by time-decay and
    // accepts fractional sums. We DON'T round here — rounding would
    // create cliff effects at integer boundaries that an attacker
    // could game.
    out.push(
      Object.freeze({
        observer: b.observer,
        subject: b.subject,
        observationKind: b.observationKind,
        satCount: Math.sqrt(b.rawSat),
        unsatCount: Math.sqrt(b.rawUnsat),
        windowStart: b.windowStart,
        windowEnd: b.windowEnd,
        createdAt: b.createdAt
      })
    );
  }
  return Object.freeze(out);
}

/* -------------------------------------------------------------------------- */
/*           2 + 3. fingerprint amplifier + path-quality damping              */
/* -------------------------------------------------------------------------- */

/**
 * The set of `contextTag` values that count as "fingerprint
 * verified" for the amplifier. Frozen at module load.
 */
export const FINGERPRINT_VERIFIED_CONTEXT_TAGS = Object.freeze([
  'contact.verified-in-person',
  'contact.long-term-correspondence'
] as const);

/**
 * Apply the per-edge amplifier + damping multipliers to a raw
 * weight matrix BEFORE row normalization. Single-edge rows are
 * unaffected (post-normalization weight is 1.0 regardless of the
 * absolute value). Multi-edge rows favor attested + fingerprint-
 * verified edges.
 *
 * Returns a NEW raw matrix with the multipliers folded in. Does NOT
 * mutate the input.
 */
export function applyEdgeMultipliers(
  raw: ReadonlyMap<ObserverKey, ReadonlyMap<SubjectKey, number>>,
  attestations: ReadonlyArray<AttestationRecord>,
  config: ReputationGraphConfig
): Map<ObserverKey, Map<SubjectKey, number>> {
  // Build two lookup sets: (observer, subject) → has-positive-attestation,
  // and a separate set for fingerprint-verified attestations.
  const attestedEdges = new Set<string>();
  const fingerprintEdges = new Set<string>();
  for (const a of attestations) {
    if (a.valence !== 'positive') continue;
    const key = `${a.observer}|${a.subject}`;
    attestedEdges.add(key);
    if (
      (FINGERPRINT_VERIFIED_CONTEXT_TAGS as readonly string[]).includes(a.contextTag)
    ) {
      fingerprintEdges.add(key);
    }
  }
  const out = new Map<ObserverKey, Map<SubjectKey, number>>();
  // Iterate observers in sorted order to keep insertion order
  // replay-deterministic.
  const sortedObservers = [...raw.keys()].sort();
  for (const observer of sortedObservers) {
    const row = raw.get(observer)!;
    const newRow = new Map<SubjectKey, number>();
    const sortedSubjects = [...row.keys()].sort();
    for (const subject of sortedSubjects) {
      let weight = row.get(subject)!;
      const edgeKey = `${observer}|${subject}`;
      const isAttested = attestedEdges.has(edgeKey);
      const isFingerprint = fingerprintEdges.has(edgeKey);
      // Apply path-quality damping FIRST (so the amplifier doesn't
      // get dampened later). Edges with no positive attestation are
      // non-attested.
      if (!isAttested && weight > 0) {
        weight = weight * config.pathQualityDamping;
      }
      // Apply fingerprint amplifier to fingerprint-verified edges.
      if (isFingerprint && weight > 0) {
        weight = weight * config.fingerprintAmplifier;
      }
      newRow.set(subject, weight);
    }
    out.set(observer, newRow);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                       4. clique penalty                                    */
/* -------------------------------------------------------------------------- */

/**
 * Iterative Tarjan's strongly-connected-components algorithm on the
 * directed graph where an edge exists from `observer` to `subject`
 * iff `C[observer][subject] > 0`.
 *
 * Returns SCCs as arrays of node ids (sorted-ascending within each
 * SCC for replay determinism).
 */
export function findStronglyConnectedComponents(
  C: ReadonlyMap<ObserverKey, ReadonlyMap<SubjectKey, number>>,
  nodes: readonly string[]
): ReadonlyArray<ReadonlyArray<string>> {
  // Use indices into `nodes` for O(1) lookups.
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) nodeIndex.set(nodes[i]!, i);

  const indices = new Int32Array(nodes.length).fill(-1);
  const lowLinks = new Int32Array(nodes.length).fill(-1);
  const onStack = new Uint8Array(nodes.length);
  const stack: number[] = [];
  const sccs: string[][] = [];
  let index = 0;

  // Iterative Tarjan with an explicit work stack so we don't blow
  // the JS call stack on large graphs.
  type Frame = {
    v: number;
    successors: number[];
    cursor: number;
  };
  for (let start = 0; start < nodes.length; start++) {
    if (indices[start] !== -1) continue;
    const work: Frame[] = [];
    const startSucc = getSortedSuccessors(C, nodes, nodeIndex, start);
    indices[start] = index;
    lowLinks[start] = index;
    index++;
    stack.push(start);
    onStack[start] = 1;
    work.push({ v: start, successors: startSucc, cursor: 0 });
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const { v, successors } = frame;
      if (frame.cursor < successors.length) {
        const w = successors[frame.cursor++]!;
        if (indices[w] === -1) {
          // Push w's frame onto the work stack and resume later.
          indices[w] = index;
          lowLinks[w] = index;
          index++;
          stack.push(w);
          onStack[w] = 1;
          work.push({
            v: w,
            successors: getSortedSuccessors(C, nodes, nodeIndex, w),
            cursor: 0
          });
        } else if (onStack[w] === 1) {
          if (indices[w]! < lowLinks[v]!) {
            lowLinks[v] = indices[w]!;
          }
        }
      } else {
        // All successors processed. Pop and update parent's lowLink.
        if (lowLinks[v] === indices[v]) {
          // Root of an SCC — pop until we hit v.
          const scc: string[] = [];
          for (;;) {
            const u = stack.pop()!;
            onStack[u] = 0;
            scc.push(nodes[u]!);
            if (u === v) break;
          }
          scc.sort();
          sccs.push(scc);
        }
        work.pop();
        // Update parent's lowLink.
        if (work.length > 0) {
          const parent = work[work.length - 1]!;
          if (lowLinks[v]! < lowLinks[parent.v]!) {
            lowLinks[parent.v] = lowLinks[v]!;
          }
        }
      }
    }
  }
  // Sort SCCs by their smallest member's id so the output is
  // replay-deterministic at the SCC-array level too.
  sccs.sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
  return sccs;
}

function getSortedSuccessors(
  C: ReadonlyMap<ObserverKey, ReadonlyMap<SubjectKey, number>>,
  nodes: readonly string[],
  nodeIndex: ReadonlyMap<string, number>,
  v: number
): number[] {
  const row = C.get(nodes[v]!);
  if (row === undefined) return [];
  const result: number[] = [];
  const subjects = [...row.keys()].sort();
  for (const subject of subjects) {
    const w = nodeIndex.get(subject);
    if (w !== undefined && (row.get(subject) ?? 0) > 0) {
      result.push(w);
    }
  }
  return result;
}

/**
 * Apply the doctrine clique penalty to a score map: for every SCC
 * of size ≥ 2 that has NO outgoing edge to a node outside the SCC,
 * multiply every member's score by `(1 / size)^cliquePenaltyExponent`.
 *
 * Returns a NEW Map of scores with the penalty applied. Does NOT
 * mutate the input map. The Map's insertion order is preserved.
 *
 * The score-only-modification is intentional: the topology (C, p,
 * iteration count) is unchanged, only the final scalar score per
 * subject is multiplied. This preserves the seed-distance BFS
 * outputs and the convergence metadata.
 */
export function applyCliquePenalty<S extends { score: number }>(
  scores: ReadonlyMap<SubjectKey, S>,
  C: ReadonlyMap<ObserverKey, ReadonlyMap<SubjectKey, number>>,
  nodes: readonly string[],
  config: ReputationGraphConfig,
  /** Optional injection point: tests can provide pre-computed SCCs. */
  sccsOverride?: ReadonlyArray<ReadonlyArray<string>>,
  /** Modifier producing the penalized score given (original, penaltyFactor, key). */
  modify?: (original: S, factor: number, key: SubjectKey) => S
): Map<SubjectKey, S> {
  const sccs = sccsOverride ?? findStronglyConnectedComponents(C, nodes);
  // Identify closed SCCs: every outgoing edge from a member ends at
  // another member of the same SCC.
  const penalized = new Map<SubjectKey, number>();
  for (const scc of sccs) {
    if (scc.length < 2) continue;
    const sccSet = new Set(scc);
    let isClosed = true;
    closedCheck: for (const member of scc) {
      const row = C.get(member);
      if (row === undefined) continue;
      for (const [subject, weight] of row) {
        if (weight <= 0) continue;
        if (!sccSet.has(subject)) {
          isClosed = false;
          break closedCheck;
        }
      }
    }
    if (!isClosed) continue;
    const factor = Math.pow(1 / scc.length, config.cliquePenaltyExponent);
    for (const member of scc) penalized.set(member, factor);
  }
  // Reconstruct the score map, applying penalties where present.
  const out = new Map<SubjectKey, S>();
  for (const [key, original] of scores) {
    const factor = penalized.get(key);
    if (factor === undefined) {
      out.set(key, original);
    } else {
      const updated = modify
        ? modify(original, factor, key)
        : Object.freeze({ ...original, score: original.score * factor });
      out.set(key, updated);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                              helpers                                       */
/* -------------------------------------------------------------------------- */

function parseIsoOrZero(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}
