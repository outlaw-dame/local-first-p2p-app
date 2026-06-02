# Phase Exit Report: Phase 1.65 — Curation and Reach Controls

- Status: Accepted as foundation-only / partial (see Decision)
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/curation-doctrine.md` (new)
  - `docs/protocol/bridge-admission-doctrine.md`
- Related implementation docs:
  - `docs/implementation/trust-safety-phase-plan.md`
  - `docs/implementation/phase-1.61-exit-report.md`
  - `docs/implementation/phase-1.63-exit-report.md`
  - `docs/implementation/phase-1.64-exit-report.md`

## Phase scope

Phase 1.65 was meant to ship the curation/ranking/search/recommendation
safety controls before public feed/search/recommendation expansion.
The plan called for:

- Six curation lifecycle events.
- Five non-negotiable distinctions documented and structurally enforced:
  downrank ≠ hide, search exclusion ≠ deletion, recommendation exclusion
  ≠ account suspension, feed grouping ≠ moderation, topic labels ≠
  safety labels.
- Curation actions distinct from moderation actions.
- Explanation records that avoid private signal leakage.
- User-local curation preferences private by default (already shipped
  in Phase 1.62 as `safety.label.preference.set` and notification
  preferences).
- Public search/recommendation surfaces reject private-scope objects.
- Tests covering downrank vs hide, search exclusion vs deletion, and
  private curation signal leakage.

I also folded in the Phase 1.63 deferral ("Phase 1.65 curation runtime
must not ingest `private-only` reports") and did a hardening pass on
all three prior projections.

## Hardening pass (pre-1.65)

Before building 1.65 I audited the prior projections for prototype-
pollution exposure and tightened both the validator boundary and the
projection helpers:

- **`assertId` now rejects reserved property names** as opaque-id
  values: `__proto__`, `prototype`, `constructor`, `hasOwnProperty`,
  `isPrototypeOf`, `propertyIsEnumerable`, `toString`, `valueOf`.
  Throws `TS_FORBIDDEN_KEY` at the validation boundary so the bad
  key never reaches a projection record.
- **New shared module `packages/trust-safety/src/projection-helpers.ts`**
  centralizes the defensive Record helpers:
  - `withFrozenRecordSet`: uses `Object.defineProperty` with explicit
    data-descriptor flags so even a forbidden key bypassed somehow
    lands as an own-property rather than mutating the prototype chain.
  - `withFrozenRecordDelete`: own-property check + delete on a fresh
    own-property copy.
  - `withFrozenBucketAppend`: idempotent push to an array-valued
    bucket index.
  - `withFrozenAppliedEventId`: idempotent set add.
- **All three prior projections** (`local-controls`,
  `reports-appeals`, `transport-admission`) refactored to import from
  the shared helpers; the local copies are removed (no duplicate code).
- **New test file** `hardening-prototype-pollution.test.ts`:
  29 tests covering `isForbiddenIdKey`, the defensive Record helpers
  (set / delete / bucket-append, prototype-untouched assertion across
  a mass of operations), and per-projection rejection of every
  reserved id key via `applyLocalControlEvent`,
  `applyReportAppealEvent`, and `admitEnvelope`.

All 622 prior tests still pass with the new validation behavior; one
existing test that had documented the old "passthrough with no
pollution" semantics is updated to document the new "rejected at the
validator boundary" semantics.

## Phase 1.65 completed work

Added under `packages/trust-safety/src/curation-runtime/`:

- **`events.ts`** — six lifecycle event kinds with payload validators
  (`lfp2p.curation-event.v1`):
  - `curation.rule.created` embeds a `CurationRule` (Phase 1.61).
  - `curation.rule.disabled` carries `ruleId`, `disabledBy` authority,
    `disabledAt`, and `reasonCode`.
  - `curation.item.boosted` and `curation.item.downranked` carry
    `itemSubject`, `surface`, `sourceRuleId`, `scoreDelta` (bounded
    `[0, MAX_SCORE_DELTA = 100]` non-negative safe integer), and
    `reasonCode`.
  - `curation.item.excluded` carries `excludeFrom: 'feed' | 'search' |
    'recommendation'` so the same exclusion event cannot accidentally
    exclude from all surfaces at once.
  - `curation.explanation.recorded` embeds a `CurationExplanation`
    (Phase 1.61).
- **`projection.ts`** — `CurationState` frozen snapshot with
  `rulesById`, `itemsBySubjectKey`, `explanationsById`,
  `appliedEventIds`. `applyCurationEvent` is pure, deterministic,
  validates before mutating, and enforces the rule state machine
  (`active → disabled` terminal; re-creation under an existing
  `ruleId` is rejected; double-disable rejected; disable of unknown
  rule rejected, all via `TS_LIFECYCLE_TRANSITION`). Item-level
  actions accumulate; each carries its `sourceRuleId`.
  `seedCurationState` is the canonical store-reopen rebuild path.
  `subjectKey` stably encodes any `SafetySubjectRef` for use as a
  record key (private-by-nature subjects use the digest body, never
  the encryption key).
  `computeItemRanking` returns the effective net score delta and
  per-surface exclusion flags **filtered to currently-active source
  rules** — disabling a rule immediately removes its effect from the
  ranking view without rewriting history.
- **`surface-gate.ts`** — `decideCurationSurfaceIngest(surface,
  envelopeScope, subject)` returns one of:
  `allowed | private-envelope-scope | private-by-nature-subject |
  private-only-report-signal | unknown-surface`. Public surfaces
  (`public-feed`, `search`, `recommendation`) reject envelopes whose
  privacy scope is not `public` and reject private-by-nature subject
  types even when the envelope is public. Local surfaces
  (`local-feed`, `community-feed`, `notification`) accept any
  envelope scope.
  `decideReportAsCurationSignal(report, surface)` resolves the Phase
  1.63 deferral: a `private-only` report (per `classifyReportPrivacy`)
  cannot drive curation on a public surface.
  `assertCurationSurfaceIngest` and `assertReportAsCurationSignal`
  are the strict variants that throw `TS_PRIVATE_LEAK` at the
  boundary.
- 6 valid + 3 invalid fixtures under
  `packages/trust-safety/fixtures/curation/`.
- 60+ new tests across 4 test files:
  - `curation-events.test.ts`: shape validation for every kind,
    score-delta bounds, unknown `excludeFrom` rejection, unknown
    version rejection.
  - `curation-projection.test.ts`: rule lifecycle (legal and every
    illegal transition), distinctions (downrank ≠ hide, search ≠
    feed/recommendation, recommendation ≠ feed/search), accumulating
    actions, disabled-rule retracts its effect from the ranking view,
    disabled-rule lifts its exclusions, idempotency, replay
    equivalence, duplicate-`explanationId` silent no-op, subject-key
    distinctness across variants.
  - `curation-surface-gate.test.ts`: every public surface rejects
    every private envelope scope; every public surface rejects
    private-by-nature subjects even on a public envelope; every
    local surface accepts every envelope scope; the strict assert
    throws `TS_PRIVATE_LEAK`; private-only reports refused as a
    curation signal on public surfaces; public-routable reports
    accepted on public surfaces; private-only reports accepted on
    local surfaces.
  - `curation-fixtures.test.ts`: loader asserts every documented
    fixture exists and is accepted/rejected appropriately.

- **New doctrine document**: `docs/protocol/curation-doctrine.md` with
  the five non-negotiable distinctions, the surface gate spec, the
  rule lifecycle, item-action accumulation rules, audit/explanation
  hygiene, versioning, and "what the curation runtime MUST NOT do".

## Tests and verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 829 passing (94 new across hardening + 1.65)
pnpm build       # clean
```

Additional verification:

- Distinction tests are *direct*: each distinction has at least one
  test that flips one excludeFrom and asserts the others stay false.
- The disabled-rule retraction semantic is verified by applying a
  downrank, observing the score delta, disabling the source rule, and
  asserting the ranking view returns to zero.
- The Phase 1.63 deferral is verified by running
  `decideReportAsCurationSignal` against a private-blob-subject
  report and asserting refusal on every public surface plus
  acceptance on every local surface.
- The hardening pass is verified by stress-applying every forbidden
  key to every projection and asserting Object.prototype is
  untouched.

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---:|---|
| Curation actions are separate from moderation actions | ✓ | `TS_CURATION_MASQUERADE` (Phase 1.61) + event-kind disjoint from `SafetyAction` |
| Explanation records avoid private signal leakage | ✓ | `reasonCodes` constrained to `SAFETY_REASON_CODES`; no free-form text |
| User-local curation preferences remain private by default | ✓ | `safety.label.preference.set` and `safety.notification-preference.set` (Phase 1.62) are `device-local`/`account-local` only |
| Public search/recommendation surfaces reject private scope objects | ✓ | `decideCurationSurfaceIngest` rejects every non-public envelope scope on every public surface; tests enumerate the matrix |
| Tests cover downrank vs hide, search exclusion vs deletion, and private curation signal leakage | ✓ | 3 explicit distinction tests + private-only report refusal tests |

## Security/privacy checks

- [x] No private plaintext in logs — package emits no logs.
- [x] Remote/untrusted input validation exists — every event kind has
  shape validation; unknown kinds, surfaces, excludeFrom values,
  versions all fail closed.
- [x] Malicious/invalid input tests exist — score-delta bounds,
  forbidden-id-key rejection, lifecycle transitions, surface gate
  enumeration.
- [x] Revocation/permission behavior — `curation.rule.disabled`
  immediately retracts the rule's effect from `computeItemRanking`
  without rewriting history.
- [x] Derived state rebuild/delete behavior — `seedCurationState`
  is the canonical rebuild path; idempotent on `eventId` and on
  `explanationId`.

## Deviations introduced or resolved

- The plan listed `curation.item.boosted`, `.downranked`, and
  `.excluded` with no specific shape. This implementation pins
  score-delta to the non-negative integer range `[0, 100]` so a
  single event cannot dominate aggregate ranking and so an adversary
  cannot push the projection into a non-recoverable state. The
  ranking view's net score delta is unbounded as a downstream
  consumer choice.
- The plan did not specify what disabling a rule does to past item
  actions. This implementation keeps the audit trail (every action
  remains in `itemsBySubjectKey`) but filters at read time
  (`computeItemRanking`). Disabling is therefore reversible at the
  *audit* layer and irreversible at the *effect* layer, which is
  what the doctrine wants.
- `subjectKey` for blob subjects uses the source-digest body (or the
  CID for content-link sources) — never the encryption-key digest.

## Remaining gaps

Out of scope for Phase 1.65, tracked downstream:

- **`@lfp2p/search` and a future feed runtime** would consume
  `computeItemRanking` to materialize a ranked feed; that wiring is a
  later slice.
- **Dexie persistence** for `CurationState` belongs to the
  local-store package.
- **Cross-rule attribution analytics** (which rules cumulatively
  affected a given item) — Phase 1.65 records the audit data; the
  analytics surface is downstream UX work.
- **Trust-policy integration** (ADR-006) — a future trust-policy
  engine may choose which rules to apply per surface based on
  capability/credential evaluation.

## Decision

This phase is:

- [ ] accepted as complete,
- [x] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason:

The Phase 1.65 plan deliverables are met: six lifecycle events ship
with validators and a state machine; the five doctrine distinctions
are documented and structurally enforced; `decideCurationSurfaceIngest`
refuses private content on public surfaces; the Phase 1.63 deferral
is resolved by `decideReportAsCurationSignal`. The hardening pass
strengthens the prior three projections against prototype pollution
at both the validator boundary and the projection-helper layer.
829 tests pass across the monorepo (94 new for the hardening +
Phase 1.65 work).

The phase is marked **foundation-only / partial** because actual
search/feed runtime wiring, Dexie persistence, and cross-rule
attribution analytics are intentionally deferred per the plan
boundary. Calling this "Complete" would overstate the integration
depth.
