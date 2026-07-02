# Phase Exit Report: Phase 1.8.1 — Reputation graph events (protocol layer)

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

First implementation slice of the Phase 1.8 reputation-graph doctrine.
Ships the five canonical event kinds (per
`docs/protocol/reputation-graph-doctrine.md`) and the pure validator,
with zero runtime / projection / algorithm work — those land in
1.8.2 (local computer), 1.8.3 (surface integration), 1.8.4
(aggregator labeler kind), 1.8.5 (sybil hardening).

The doctrine's non-negotiable #5 ("observations carry counts and
stable tags only, never payload bytes") is enforced HERE at the
validator boundary: every string-typed field on every reputation
event is one of a bounded enum frozen at module load. Free-form text
is never accepted.

## Completed work

### `packages/trust-safety/src/reputation-graph/` (new sub-module)

- `constants.ts` — five bounded enums + the hard-cap record, all
  `Object.freeze`d at module load:
  - `OBSERVATION_KINDS` (7 values across outbox / bridge / media)
  - `ATTESTATION_VALENCES` (`positive` / `negative` / `dispute`)
  - `ATTESTATION_CONTEXT_TAGS` (10 values across contact / community
    / commercial, both positive and adverse mirrors)
  - `AGGREGATOR_REMOVAL_REASONS` (4 values: revoked / expired /
    superseded / algorithm-changed)
  - `REPUTATION_ALGORITHMS` (3 values: local personalized EigenTrust,
    OpenRank adapter, community-curated; explicitly versioned per
    doctrine — `v1` and `v2` are non-comparable to consumers)
  - `REPUTATION_LIMITS` (`maxSubjectsPerAggregatorBatch: 10_000`,
    `maxWindowMs: 365 days`, `maxObservationCount: 1_000_000`)
- `events.ts` — five event payload types + `validateReputationEvent`
  pure function. Top-level discriminator + per-kind switch with full
  type narrowing.
- `index.ts` — sub-module re-export.

### `packages/trust-safety/src/errors.ts` (extended)

- Added `TS_INVALID_REPUTATION` for reputation-specific composite-
  shape failures (window > maxWindowMs, both counts zero, empty
  aggregator batch, etc.). Enum / number-range / id / timestamp /
  forbidden-key failures continue to use the existing generic codes
  so the package namespace stays small (one new code, not eleven).

### `packages/trust-safety/src/index.ts` (extended)

- `export * from './reputation-graph/index.js';` so callers import
  from `@lfp2p/trust-safety` directly per the package surface
  convention.

### Validator invariants

- Top-level payload + every nested object (subject, aggregator
  subjects) passes through `assertPlainObject` (prototype-pollution
  defense matching Phase 1.71 + Phase 2.1).
- Every string field is `assertOneOf` against a frozen enum tuple.
- Every numeric field is `assertFiniteNumberInRange` (NaN / Infinity
  / out-of-band rejected as `TS_INVALID_NUMBER`).
- ISO-8601 timestamps require explicit timezone designator; pre-2020
  and > now+100yr rejected as garbage (reuse of existing helper).
- Lifecycle: `windowStart ≤ windowEnd`, window duration ≤
  `maxWindowMs`, `expiresAt ≥ createdAt`, `revokedAt ≥ createdAt`,
  `computedAt ≤ createdAt` (the aggregator must have computed AT or
  BEFORE signing — a future-dated `computedAt` is a forged-clock
  signal).
- Both `satCount === 0` AND `unsatCount === 0` is rejected — an
  observation with no observations is meaningless and would waste
  storage.
- Empty aggregator subjects array is rejected for the same reason.
- Aggregator batch capped at `maxSubjectsPerAggregatorBatch`.
- Output deep-frozen at every level (Phase 3.2 frozen-walk
  discipline).
- Subject ref delegated to `validateSafetySubjectRef` — unknown
  subject types (e.g. `wallet`) fail closed with `TS_INVALID_SUBJECT`.

### Fixtures: 20 valid + 10 invalid

`packages/trust-safety/fixtures/reputation-graph/`:

| Kind                                  | Valid                                                                                           | Invalid                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `reputation.observation.recorded`     | outbox-useful / bridge-misbehaved / mixed-counts / domain-media-correct                         | unknown-kind / window-inverted              |
| `reputation.attestation.published`    | positive-verified-in-person / positive-with-expiry / negative-bad-actor / dispute-strength-zero | strength-above-one / expires-before-created |
| `reputation.attestation.revoked`      | basic / delayed / iso-with-offset / much-later                                                  | before-created / missing-attestation-id     |
| `reputation.aggregator.published`     | single-subject / batch / zero-confidence / domain-subject                                       | score-above-one / empty-subjects            |
| `reputation.aggregator.score.removed` | revoked / expired / superseded / algorithm-changed                                              | unknown-reason / unknown-subject-type       |

### 79 new adversarial tests

`packages/trust-safety/src/__tests__/reputation-graph-events.test.ts`

Coverage:

- **Fixture coverage** (32 cases): 20 valid pass + 10 invalid throw
  `TrustSafetyError` + cardinality assertions.
- **Bounded enums** (2): every enum is `Object.isFrozen` at module
  load; no enum has duplicates.
- **Forward-compat rejection** (6): unknown kind / observationKind /
  valence / contextTag / algorithm / reason all reject with
  `TS_INVALID_ENUM`. No partial accept.
- **Numeric range hardening** (parameterized — 16 cases): NaN,
  Infinity, -Infinity, out-of-[0,1] for `strength` / `score`;
  -1 / 1.5 / NaN / overflow for counts; both-zero rejection;
  negative `observationCount`.
- **Timestamp + lifecycle** (7): inverted windows; oversized window
  vs `maxWindowMs`; `expiresAt` before `createdAt`; `revokedAt`
  before `createdAt`; **`computedAt` after `createdAt`
  (clock-skew sentinel)**; missing timezone; pre-2020.
- **Prototype-pollution defense** (5): top-level + nested `__proto__`
  injection via `JSON.parse` does NOT pollute `Object.prototype`;
  non-record subject / array payload / null payload all rejected.
- **Subject-list cap** (3): exactly `maxSubjectsPerAggregatorBatch`
  accepted, one over rejected, empty array rejected.
- **Output integrity** (2): observation + aggregator outputs frozen
  at every level (`Object.isFrozen` walk).
- **Replay determinism** (2): same input twice → byte-identical
  `JSON.stringify`; every valid fixture round-trips through
  validate → stringify → parse → validate.
- **Version pinning** (2): future major version and malformed
  version string both rejected.
- **Subject ref delegation** (2): unknown subject types fail closed;
  actor / bridge / domain / community variants all accepted.
- **Doctrine #5 cross-check** (1): every accepted fixture's string
  fields are members of the documented enums.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1318 passing (1239 → 1318, +79)
pnpm build       # clean
```

## Acceptance criteria (mapped to the Phase 1.8 doctrine)

| Criterion                                                                                             |        Status         | Evidence                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | :-------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New event kinds added with bounded enums for kind / contextTag / valence / algorithm / removal-reason |           ✓           | 5 enums + `REPUTATION_EVENT_KINDS`, all frozen at module load                                                                                                                         |
| Validation rejects free-form text                                                                     |           ✓           | every string field uses `assertOneOf` against a frozen enum                                                                                                                           |
| Validation rejects unknown enums (deterministic, not partial)                                         |           ✓           | 6 dedicated tests; doctrine #5 cross-check                                                                                                                                            |
| Validation rejects window violations                                                                  |           ✓           | inverted window + oversized window tests                                                                                                                                              |
| Validation rejects strengths outside [0, 1]                                                           |           ✓           | parameterized test with NaN / Inf / oob values                                                                                                                                        |
| Validation rejects score / confidence outside [0, 1]                                                  |           ✓           | parameterized test on aggregator subject score                                                                                                                                        |
| Validation rejects counts outside [0, maxObservationCount]                                            |           ✓           | parameterized test                                                                                                                                                                    |
| Phase 3.2 frozen-walk + replay-equivalence pinned                                                     |           ✓           | dedicated `Object.isFrozen` walks + round-trip fixture test                                                                                                                           |
| Fixtures: 4 valid + 2 invalid per kind                                                                |           ✓           | 20 valid + 10 invalid; cardinality test                                                                                                                                               |
| Prototype-pollution defense at every payload object boundary                                          |           ✓           | 5 dedicated tests using `JSON.parse` delivery                                                                                                                                         |
| Aggregator subject-list cap                                                                           |           ✓           | exact-cap accept + one-over reject + empty reject                                                                                                                                     |
| Default privacy = `device-local` for observation + attestation                                        | n/a at protocol layer | Privacy is enforced at the SignedEventEnvelope layer, not on the inner payload — doctrine #2 lives at the envelope boundary, enforced when these payloads are emitted by Phase 1.8.2+ |

## Deferred work (post-1.8.1)

- **Phase 1.8.2** — `packages/trust-safety/reputation-graph` local
  personalized EigenTrust computer. Pure module operating on a
  frozen `ReputationGraphInputs` projection seeded from the Phase 2.3
  contact graph.
- **Phase 1.8.3** — Surface integration. Wires the score into the
  Phase 1.64 / 4.1 admission rate-limit-bucket parameter table
  (modulating, not duplicating, engine math) + Phase 1.65 curation
  downrank input + new spam-gate emitter at Phase 1.66 labeler
  priority #0.
- **Phase 1.8.4** — `labeler.kind: reputation-aggregator` for the
  optional OpenRank integration point, as ONE labeler among many in
  the Phase 1.66 stack.
- **Phase 1.8.5** — Sybil-hardening layers (clique penalty, path-
  quality damping, time-windowed aggregation, fingerprint
  amplifier).
- **Privacy enforcement at the SignedEventEnvelope layer.** Phase 1.8.1
  emits the payload types; the doctrine's "default privacy =
  device-local" rule is enforced at envelope construction time by
  Phase 1.8.2 emitters and the upstream sync-client / bridge surfaces.
- **PWA emit wiring** parallel to Phase 1.70 — UI for users to opt
  into publishing observations / attestations + an aggregator
  subscription surface. Pairs with Phase 1.8.4.

## Decision

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: protocol-layer slice is structurally complete — every
documented event kind has a typed payload, a pure validator with
fail-closed enum / range / lifecycle checks, prototype-pollution
defense, fixture coverage at the contract rate the doctrine
specified (4 valid + 2 invalid per kind), and adversarial tests
pinning every non-negotiable rule that applies at the protocol
layer. All acceptance criteria that map to the protocol layer are
satisfied; downstream criteria (privacy enforcement, surface
integration) land in their respective Phase 1.8.2+ slices and are
explicitly listed as deferred.
