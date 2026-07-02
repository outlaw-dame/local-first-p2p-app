# Phase Exit Report: Phase 1.8.2 — Local personalized EigenTrust computer

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

Pure runtime-agnostic function that takes a frozen
`ReputationGraphInputs` and produces a frozen `LocalReputationState`
following the doctrine's personalized PageRank formulation:

```
t̄^(k+1) = (1 − α) · p  +  α · Cᵀ · t̄^(k)
```

with `p` seeded from the user's Phase 2.3 contact graph. The
computation is per-user — the doctrine non-negotiable #1 ("reputation
is per-user, not global") is the academic fix for the symmetric-
reputation-function sybil result (Berkeley 2007 / Cheng-Friedman 2005).

What this slice DOES NOT do: sybil-hardening LAYERS (clique penalty,
path-quality damping, time-windowed multi-window aggregation,
fingerprint amplifier beyond the seed band) land in Phase 1.8.5. The
configuration fields for those layers exist on `ReputationGraphConfig`
today so the wire shape does not need to change at 1.8.5.

## Completed work

### `packages/trust-safety/src/reputation-graph/inputs.ts` (new)

- `ObservationRecord` / `AttestationRecord` / `RevocationRecord` /
  `SeedContact` plain-record types — the computer is envelope-
  agnostic (Phase 3.2 pure-projection discipline; the unwrapping
  from `SignedEventEnvelope` happens at the PWA emit / sync-client
  / bridge wiring layers).
- `subjectRefToKey(ref)` canonical-id producer for every
  `SafetySubjectRef` variant. Type-prefixed (`actor:`, `bridge:`,
  `domain:`, etc.) so two different subject types with coincidentally
  matching ids never collide. `blob` uses the digest algorithm +
  value AND the `digest` vs `content-link` discriminator so two
  sources cannot collapse to the same key.

### `packages/trust-safety/src/reputation-graph/config.ts` (new)

- `ReputationGraphConfig` (renamed from doctrine's `ReputationConfig`
  to avoid collision with the existing `ReputationConfig` in the
  Phase 1.64 `transport-admission` module).
- `DEFAULT_REPUTATION_CONFIG` — doctrine-verbatim defaults, frozen.
- `resolveReputationGraphConfig(override?)` — validates every
  override against documented ranges (damping ∈ (0,1), maxNodes ∈
  [1, 10M], maxIterations ∈ [1, 10k], convergenceThreshold ∈
  (0,1), windows in ms, etc.). Out-of-range / NaN / non-integer
  values throw `TrustSafetyError`.

### `packages/trust-safety/src/reputation-graph/computer.ts` (new)

`computeReputation(inputs) → LocalReputationState`. Algorithm steps:

1. Apply revocations (filter attestations by attestationId in
   the revoked set).
2. Drop observations outside the window cutoff; drop expired
   attestations.
3. Aggregate raw (observer, subject) weights from observations
   ((sat − unsat) × timeDecay) and attestations (strength × valence-
   sign × timeDecay × 10 multiplier — attestations weigh 10× a
   single observation per doctrine intent).
4. Build node universe + truncate to `maxNodes` deterministically
   by ascending stable id sort. Cap edges per observer at
   `maxEdgesPerNode` (keep highest weight, ties broken by ascending
   subject id).
5. Row-normalize per Kamvar: negatives → 0, divide by row sum.
   Zero-sum rows contribute nothing to the matrix step.
6. Build personalization vector `p` from `seedContacts` (strength ×
   time-decay since attestation), normalize so Σp = 1. Empty / all-
   zero seeds produce empty output (doctrine fallback, not an error).
7. Iterate `t = (1 − α) · p + α · Cᵀ · t` until `max|Δt| <
convergenceThreshold` or `maxIterations`. NaN/Infinity in any
   iteration aborts with `convergedWithinIterations: false`.
8. BFS from seed nodes for `seedDistance` per subject.
9. Build the per-subject score map; freeze every level.

Output `LocalReputationState`:

- `version: 'lfp2p.reputation-graph.v1'`
- `computedAtMs` (echo of the reference clock)
- `truncated: boolean`
- `convergedWithinIterations: boolean`
- `iterations: number`
- `scores: ReadonlyMap<SubjectKey, { score, confidence, seedDistance }>`
- `config: ReputationGraphConfig` (echo)

Determinism (Phase 3.2 replay equivalence):

- Every loop iterates a SORTED array of keys, never Map iteration
  order — so two runs with different input array orderings produce
  identical output.
- Floating-point summations happen in sorted-key order, so input
  re-ordering cannot perturb the sums.
- `Math.pow(2, x)` time-decay is IEEE-754 spec-deterministic.

### 28 new adversarial tests (`reputation-graph-computer.test.ts`)

- **Degenerate inputs** (4): empty graph, null / string runtime
  guard, missing arrays, all-zero-after-decay seeds (degraded not
  error).
- **Single-seed graph** (1): seed alone scores positively, seedDist=0.
- **Happy-path personalization** (2): two-hop chain produces
  monotonically decreasing scores per hop + correct seed distances;
  attestation > observation contribution at equivalent strength.
- **Sybil-zero baseline** (2): disconnected sybil cluster scores
  ≈zero; weakly-connected sybils never exceed real-attested subjects.
- **Revocation** (1): matching revocation removes the attestation.
- **Time decay** (3): older observations weigh relatively less when
  alongside fresh competing observations; out-of-window dropped;
  expired attestations dropped.
- **Personalization actually personalizes** (1): different seeds →
  different rankings (the doctrine non-negotiable #1).
- **Replay equivalence (Phase 3.2)** (2): same input thrice → byte-
  identical states; input array reordering → byte-identical states.
- **Frozen-walk discipline** (1): output deep-frozen at every level.
- **Hard cap discipline** (4): config truncation values resolved
  correctly; out-of-range overrides throw; Infinity/NaN overrides
  throw; resolved config is frozen.
- **Convergence** (2): chain converges before maxIterations; config
  echoed via output.
- **`subjectRefToKey`** (2): stable strings per type; collision-free
  across types.
- **`nowIso` handling** (3): explicit clock used; invalid ISO throws;
  without explicit, derived from input maxima.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1383 passing (1318 → 1383, +65 across 1.8.2 + 1.8.3)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                                                        | Status | Evidence                                                                                                             |
| ------------------------------------------------------------------------------------------------ | :----: | -------------------------------------------------------------------------------------------------------------------- |
| Pure function `computeReputation(inputs) → LocalReputationState` with all defaults from doctrine |   ✓    | `computer.ts` + `DEFAULT_REPUTATION_CONFIG` echoed in output                                                         |
| Personalized seed vector seeded from Phase 2.3 contacts with documented strength bands           |   ✓    | `SeedContact` shape pinned; doctrine bands (1.0/0.5/0.1) are caller's responsibility — validator accepts any `[0,1]` |
| Hard caps enforced; truncation deterministic by stable id sort                                   |   ✓    | sorted truncation tested; config range tests pin upper bounds                                                        |
| Convergence threshold + iteration cap + graceful failure when not converged                      |   ✓    | `convergedWithinIterations` flag + dedicated chain test                                                              |
| Deep-freeze on construction per Phase 3.2                                                        |   ✓    | frozen-walk test                                                                                                     |
| Replay equivalence                                                                               |   ✓    | byte-identical thrice + array-reorder tests                                                                          |
| NaN / Infinity rejection (config + intermediates)                                                |   ✓    | config tests + intermediate-NaN aborts loop returning empty scores                                                   |
| Empty graph                                                                                      |   ✓    | dedicated test                                                                                                       |
| Single-seed graph                                                                                |   ✓    | dedicated test                                                                                                       |

## Deferred for Phase 1.8.5

- Clique-detection penalty (closed-group internal endorsements
  pay a `1/√N` factor).
- Path-quality damping (`α^n` per non-attested hop).
- Time-windowed multi-window aggregation (resists trust laundering).
- Phase 2.3 fingerprint-compare amplifier (permanent trust-path
  boost from out-of-band human verification — the one signal an
  on-chain protocol cannot replicate).

The configuration fields for these layers are reserved on
`ReputationGraphConfig` today so wiring at 1.8.5 does not require a
wire-shape change.

## Decision

- [x] accepted as complete

Reason: the local personalized EigenTrust computer is structurally
complete — every doctrine acceptance criterion is satisfied, the
computation is pure (replays byte-identical on the same input),
the output is deep-frozen per Phase 3.2, hard caps prevent
unbounded compute on hostile inputs, and the sybil-zero baseline
is pinned by tests (disconnected sybil clusters score ≈zero
regardless of internal endorsement volume). Sybil-hardening LAYERS
land in Phase 1.8.5 and are explicitly deferred with config-shape
forward-compat reserved.
