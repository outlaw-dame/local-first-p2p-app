# Phase Exit Report: Phase 1.8.3 — Surface integration (admission band + curation downrank + spam gate)

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

Three pure surfaces that consume `LocalReputationState` and produce
parameter multipliers / decisions for downstream layers. The
integration is intentionally NARROW: it does NOT duplicate any
existing engine math. Phase 1.64 admission + Phase 1.65 curation
continue to own their algorithms; Phase 1.8.3 supplies the
"per-peer modulation" parameter the doctrine specified.

The doctrine non-negotiable #7 ("Reputation never causes silent
deletion") is enforced HERE — every multiplier is bounded below by a
positive floor (`CURATION_FLOOR = 0.1`), and the spam gate produces a
LABEL SUGGESTION, not an immediate hide.

## Completed work

### `surface-integration.ts` (new)

- `REPUTATION_BANDS` — `('high' | 'mid' | 'low' | 'untrusted')` frozen.
- `REPUTATION_BAND_THRESHOLDS` — `0.5 / 0.1 / 0.01` (doctrine table).
- `getReputationBand(score)` — maps `[0, ∞)` to a band; NaN/Infinity/
  negative collapse to `'untrusted'` (fail closed).
- `ADMISSION_BAND_TABLE` — frozen multiplier set per band exactly
  per the doctrine:

  | Band      | capacity × | refill × | cooldown-exp × |
  | --------- | ---------- | -------- | -------------- |
  | high      | 2          | 2        | 0.5            |
  | mid       | 1          | 1        | 1              |
  | low       | 0.5        | 0.5      | 1.5            |
  | untrusted | 0.25       | 0.25     | 2              |

- `getAdmissionBandMultipliers(score)` — convenience lookup.
- `applyAdmissionBand(baseline, score)` — applies the multipliers
  to a `{ capacity, refillPerSecond, cooldownExponent }` baseline,
  returning a new frozen record annotated with the band. Throws
  `TS_INVALID_NUMBER` on bad baseline (programming bug — fail closed).
- `getCurationDownrankFactor(score)` — `[CURATION_FLOOR, 1]` linear
  mapping. Doctrine non-negotiable #7 enforced: factor NEVER reaches
  0 across the full range, NaN, Infinity, or negative inputs.
- `getScore(state, key)` — convenience extractor.

The audit-friendliness pattern (Phase 3.1): every output carries the
BAND name (privacy-safe stable string) so consumers log
`band: 'high'` rather than the raw score.

### `spam-gate.ts` (new)

- `SpamGateInput = { score, seedDistance, hasPositiveAttestation }`.
- `SpamGateConfig` — `spamScoreThreshold` (default 0.05) +
  `spamSeedDistanceMax` (default 3).
- `SpamGateDecision = { version, flagSpam, reasonCode,
bandSnapshot: { atOrAboveThreshold } }` — frozen.
- `SPAM_GATE_REASON_CODES` — 5 stable codes (`'score-above-threshold'`,
  `'within-seed-distance'`, `'positive-attestation-present'`,
  `'unknown-input'`, `'flagged'`).
- `computeSpamGateDecision(input, config?)` — three-condition AND:
  flags ONLY when `low score AND far from seed AND no positive
attestation`. Each guard short-circuits with its own reason code
  so consumers can audit WHY a subject was / wasn't flagged.
- **Fail-open on unknown input**: NaN / non-numeric / non-boolean
  returns `'unknown-input'` with `flagSpam: false` — a missing data
  point CANNOT cause a false-positive spam label. Doctrine non-
  negotiable #7 + the "hostile aggregator" threat-model row.
- `resolveSpamGateConfig(override?)` — validates ranges + frozen
  output. Out-of-range / NaN / non-integer values throw.

The gate produces a DECISION; it does NOT itself emit the label.
That wiring lives at Phase 1.8.4 (aggregator labeler kind) or the
PWA emit layer.

### 37 new adversarial tests

`reputation-graph-surface-integration.test.ts` (21):

- Band boundary cases per the doctrine table (8 cases including
  threshold edges).
- Score-above-1 clamps to `'high'`.
- NaN / Infinity / negative collapse to `'untrusted'`.
- `undefined` collapses to `'untrusted'`.
- `REPUTATION_BANDS` + thresholds frozen.
- Doctrine multiplier table verbatim (4 bands).
- `ADMISSION_BAND_TABLE` entries frozen.
- `applyAdmissionBand` composition correctness across bands.
- Bad-baseline fail-closed (3 cases: negative capacity, NaN, zero).
- Curation downrank monotonicity sweep.
- `CURATION_FLOOR` boundary (score=0).
- score=1 → factor=1.
- NaN / Infinity / negative inputs → `CURATION_FLOOR`.
- **Doctrine non-negotiable #7**: full sweep + adversarial inputs
  ALL produce factor > 0 (no silent deletion).
- `getScore` returns score when present / undefined when absent.
- End-to-end band assignment composes with `computeReputation`
  (seed > 1-hop > 2-hop monotonicity in band rank).

`reputation-graph-spam-gate.test.ts` (16):

- Happy path: all three conditions hold → `flagSpam: true`,
  reason `'flagged'`.
- Decision deep-frozen.
- Every reason code returned IS in the documented enum.
- Each guard short-circuits independently (high score, near seed,
  positive attestation present).
- `Number.POSITIVE_INFINITY` seedDistance satisfies the far-from-seed
  condition (unreachable subjects ARE candidates).
- Fail-open on unknown input (5 cases: NaN score, negative score,
  non-numeric, non-boolean attestation, negative distance).
- `resolveSpamGateConfig` happy path + frozen output.
- Out-of-range threshold rejected (negative, > 1, NaN).
- Out-of-range seed distance rejected (non-integer, negative, NaN).
- User-override discipline: stricter score threshold flags
  previously-non-spam subject; stricter distance flags previously-
  non-spam subject.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1383 passing (1318 → 1383, +37 here, +28 in 1.8.2)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                          |      Status       | Evidence                                                                                                                                 |
| ------------------------------------------------------------------ | :---------------: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Admission band table modulates per-peer params per doctrine        |         ✓         | dedicated multiplier-table test + composition test                                                                                       |
| Curation surface input — downranks, never hides                    |         ✓         | doctrine non-negotiable #7 floor test                                                                                                    |
| Spam gate emits `spam.likely` candidate via three-condition AND    |         ✓         | dedicated guard tests; emit wiring deferred to 1.8.4 / PWA                                                                               |
| Audit log records the band, NOT raw score (privacy-safe per 3.1)   |         ✓         | every output carries the band as a stable string                                                                                         |
| User-overrides (explicit subscribe / mute) beat algorithmic signal | n/a at this layer | local-controls override happens at the Phase 1.62 surface that consumes these outputs; the integration layer just supplies the parameter |

## Deferred work

- **Phase 1.8.4** — `labeler.kind: reputation-aggregator` so a user
  can subscribe to OpenRank scores (or any other aggregator) as one
  labeler among many in the Phase 1.66 stack. This is where the
  spam-gate decision becomes an emitted `spam.likely` label.
- **Phase 1.8.5** — sybil-hardening layers (clique penalty, path-
  quality damping, time-windowed multi-window aggregation, Phase
  2.3 fingerprint amplifier). Config-shape forward compat already
  reserved.
- **Live wiring into `transport-admission`**. `applyAdmissionBand`
  is the seam where a future slice plugs the bridge admission's
  per-peer baseline through this layer. No change to the engine
  math itself.
- **PWA settings surface** for the spam gate (user-tunable
  thresholds, opt-out toggle).

## Decision

- [x] accepted as complete

Reason: the three surfaces are pure, narrow, audit-friendly, and
preserve every doctrine non-negotiable (per-user via the input score,
no silent deletion via the floor, privacy-safe logging via band
strings). Engine math is unchanged — no duplication, no drift.
