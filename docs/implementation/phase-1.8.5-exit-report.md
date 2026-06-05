# Phase Exit Report: Phase 1.8.5 — Sybil-hardening layers

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

Four pure helpers wired into the Phase 1.8.2 computer pipeline at
distinct stages. Each closes a documented attack class from the
EigenTrust literature that the Phase 1.8.2 baseline did not yet
mitigate.

The doctrine non-negotiable #1 ("Reputation is per-user, not
global") continues to hold — every layer is per-input-graph, not a
network-level authority. Replay equivalence (Phase 3.2) is
preserved: every helper iterates sorted-key arrays and uses
spec-deterministic floating-point math.

## Completed work

### `packages/trust-safety/src/reputation-graph/sybil-hardening.ts` (new)

1. **`compressByTimeBucket(observations, config)`** — buckets
   observations by `floor(windowEndMs / observationBucketMs)` per
   `(observer, subject)` pair, then applies a sqrt-style concave
   compression per bucket. A 10 000-burst contributes `sqrt(10 000) =
   100`; the same 10 000 spread across 10 buckets contributes `10 ×
   sqrt(1 000) ≈ 316`. Spread is rewarded >3×, burst is penalized —
   resists trust laundering via short-lived hot accounts.

2. **`applyEdgeMultipliers(raw, attestations, config)`** — runs at
   the raw-weight stage BEFORE row-normalization:
   - **Path-quality damping**: edges with NO positive attestation
     get multiplied by `pathQualityDamping` (default 0.7). Within
     a single observer's row this favors attested edges; single-
     edge rows are unaffected (still normalizes to 1.0).
   - **Fingerprint amplifier**: edges with a positive attestation
     whose `contextTag` is `contact.verified-in-person` or
     `contact.long-term-correspondence` get multiplied by
     `fingerprintAmplifier` (default 1.5). This is the doctrine's
     "one signal an on-chain protocol structurally cannot
     replicate" — out-of-band human verification earns a permanent
     trust-path boost.
   - Negative-valence attestations do NOT shield an edge from
     damping (verified by test).

3. **`findStronglyConnectedComponents(C, nodes)`** — iterative
   Tarjan SCC implementation (explicit work-stack so we don't blow
   the JS call stack on large graphs). Returns SCCs sorted by
   smallest member's id; within-SCC members sorted ascending for
   replay-determinism.

4. **`applyCliquePenalty(scores, C, nodes, config)`** — for every
   SCC of size ≥ 2 with NO outbound edges to nodes outside the
   SCC, multiplies each member's score by `(1 / size)^cliquePenaltyExponent`.
   Defaults at `exponent = 0.5` give a `1/√N` penalty per member.
   Score-only modification — topology stays intact so the
   subsequent BFS for `seedDistance` walks the original graph.
   Open SCCs (with any outbound edge to a non-member) are NOT
   penalized.

### `config.ts` (extended)

Added two new fields to `ReputationGraphConfig`:

- `fingerprintAmplifier` (default 1.5; range `[1, 10]` — anything
  below 1 would penalize fingerprint-verified contacts, inverting
  the doctrine intent; upper bound prevents amplifier-dwarfing-all-
  else misconfiguration).
- `observationBucketMs` (default 24h; range `[1 000ms, observationWindowMs]`
  — a bucket longer than the window has zero buckets to compress).

`resolveReputationGraphConfig` range-checks both with explicit
`TS_INVALID_NUMBER` errors.

### `computer.ts` (extended)

The Phase 1.8.2 pipeline now runs the hardening layers at the right
stages:

```
1. apply revocations
2. window + expiry cutoffs
2.5 NEW — compressByTimeBucket
3. aggregate raw weights
3.5 NEW — applyEdgeMultipliers (fingerprint amplifier + path damping)
4. truncate to maxNodes / maxEdgesPerNode (deterministic id sort)
5. row-normalize C
6. seed personalization vector p
7. iterate t = (1−α)·p + α·Cᵀ·t
7.5 NEW — applyCliquePenalty
8. seed-distance BFS
9. build + deep-freeze score map
```

All 144 pre-1.8.5 reputation tests continue to pass — the hardening
layers preserve every previously-pinned invariant including the
sybil-zero baseline, replay-equivalence (byte-identical thrice +
array-reorder), and the doctrine non-negotiables.

### 26 new adversarial tests

`reputation-graph-sybil-hardening.test.ts`:

- **Clique penalty (1)**: closed 5-clique with strong internal
  observations — each member's score < seed's, total clique share
  bounded.
- **Tarjan SCC (3)**: chain produces 3 singleton SCCs; 3-cycle is
  one 3-SCC; output replay-deterministic.
- **`applyCliquePenalty` (4)**: closed 3-SCC penalized by exact
  `(1/3)^exponent`; SCC with outbound edge NOT penalized; size-1
  SCC never penalized; output preserves input Map insertion order.
- **Path damping (2)**: mixed-row attested edge favored over
  observation-only edge in computed state; single-edge row
  unchanged (regression invariant).
- **`applyEdgeMultipliers` (5)**: pure function (does not mutate
  input); non-attested edges multiplied by damping; attested
  non-fingerprint edges full weight; fingerprint-verified edges
  amplified; **negative-valence attestations do NOT shield non-
  attestation damping** (privacy / threat-model edge case).
- **Time-bucket compression (4)**: burst < spread (end-to-end
  computed-state comparison); same-bucket observations aggregated;
  frozen output records; replay-determinism.
- **Fingerprint amplifier (2)**: `contact.verified-in-person` >
  `community.contributor` at equal strength; documented context-
  tag set frozen + complete.
- **Config range checks (4)**: `fingerprintAmplifier < 1` rejected;
  `> 10` rejected; `observationBucketMs > observationWindowMs`
  rejected; `observationBucketMs < 1 000` rejected.
- **End-to-end replay (1)**: hardening pipeline preserves byte-
  identical output across runs.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1428 passing (1383 → 1428, +26 here + 19 in 1.8.4)
pnpm build       # clean
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|:---:|---|
| Clique-detection penalty implemented; test pinned with N-clique scenario showing rank suppression | ✓ | 5-clique e2e + 3-clique exact-factor unit |
| Path-quality damping implemented; test pinned with attested-vs-unattested path scenario | ✓ | mixed-row test + unit on `applyEdgeMultipliers` |
| Time-windowed aggregation pinned with burst-vs-spread test | ✓ | end-to-end test computed via `computeReputation` |
| Fingerprint amplifier verified against Phase 2.3 contact-verification context tags | ✓ | dedicated test + frozen context-tag set |
| Replay equivalence preserved across hardening | ✓ | byte-identical replay test |
| All pre-1.8.5 tests continue to pass | ✓ | 144 → 144 pre-hardening tests still green |
| Threat-model row updated with each mitigation citing the test | n/a at this slice | doctrine table already covers; threat-model.md update deferred to Phase 1.68 refresh |

## Deferred

- **Threat-model.md row update** citing each new test by name
  (matches Phase 1.68 doctrine refresh pattern).
- **PWA observation-bucket visualization** so users can see how
  their observations have been compressed.
- **Tunable per-aggregator config** in the PWA settings — today
  the user inherits doctrine defaults.

## Decision

- [x] accepted as complete

Reason: every doctrine sybil-hardening layer is implemented as a
PURE helper, wired into the existing computer pipeline at the right
stage, and pinned by tests that verify both the local property
(each layer's specific behavior) AND the global property (the
full pipeline still replays byte-identical, the sybil-zero
baseline still holds, the personalization-actually-personalizes
invariant still holds). No engine math is duplicated. The
configuration shape was forward-compat reserved in Phase 1.8.2 so
this slice is a strict extension with no breaking changes.
