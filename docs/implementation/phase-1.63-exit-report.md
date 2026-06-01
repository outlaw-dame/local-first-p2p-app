# Phase Exit Report: Phase 1.63 — Reports, Appeals, and Encrypted Evidence Refs

- Status: Accepted as foundation-only / partial (see Decision)
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
- Related implementation docs:
  - `docs/implementation/trust-safety-phase-plan.md`
  - `docs/implementation/phase-1.61-exit-report.md`
  - `docs/implementation/phase-1.62-exit-report.md`
- Related threat models:
  - `docs/threat-model/trust-safety-and-abuse.md`

## Phase scope

Phase 1.63 was meant to ship the five lifecycle events around reports
and appeals, the deterministic projection that tracks their state, and
the structural privacy/encryption guards required when a report
references private-by-nature subjects.

Per the plan, the required outputs were:

- Event kinds: `safety.report.created`, `safety.report.acknowledged`,
  `safety.report.resolved`, `safety.appeal.created`,
  `safety.appeal.resolved`.
- Dependencies on private payload envelope rules, `ObjectRef` /
  `BlockRef` evidence refs, idempotency keys, target authority
  resolution, and bridge log privacy rules.
- Privacy doctrine: report bodies encrypted when they carry sensitive
  details; evidence bundles encrypted by default; bridges deliver
  encrypted packages without decrypting them; private dm/group reports
  do not enter public flows.

The plan's exit criteria:

- Reports require subject, reason, authority, idempotency, and scope.
- Appeals target policy decisions.
- Public labels cannot expose private evidence refs.
- Tests cover duplicate reports, private evidence routing, and
  malformed encrypted refs.

## Completed work

Added under `packages/trust-safety/src/reports-appeals/`:

- **`events.ts`** — five lifecycle event kinds with payload-level cross-
  checks:
  - `safety.report.created` embeds a `SafetyReport` (Phase 1.61) and is
    validated end-to-end through the existing shape validator.
  - `safety.report.acknowledged` carries `reportId`, the
    acknowledging `SafetyAuthority`, `acknowledgedAt`, and optional
    `ackReasonCode`.
  - `safety.report.resolved` carries `reportId`, `resolvedBy`,
    `resolvedAt`, `resolution: 'upheld' | 'dismissed' | 'duplicate' |
    'invalid' | 'escalated'`, `resolutionReasonCode`, optional
    `resolutionDecisionId` (linking to a `SafetyPolicyDecision`), and
    optional `escalatedTo` authority. The validator enforces:
    `escalatedTo` REQUIRED iff `resolution === 'escalated'`.
  - `safety.appeal.created` embeds a `SafetyAppeal` (Phase 1.61).
  - `safety.appeal.resolved` carries `appealId`, `resolvedBy`,
    `resolvedAt`, `resolution: 'overturned' | 'upheld' | 'dismissed' |
    'invalid'`, `resolutionReasonCode`. `newDecisionId` REQUIRED iff
    `resolution === 'overturned'`.
  - Pinned version: `lfp2p.report-appeal-event.v1`. Unknown versions
    fail closed (TS_UNKNOWN_VERSION).
- **`projection.ts`** — `ReportsAppealsState` frozen snapshot with six
  serializable indexes plus `appliedEventIds`:
  - `byReportId` / `byAppealId`: primary records (each carries the full
    embedded report/appeal, current status, and lifecycle metadata).
  - `byReportIdempotencyKey` / `byAppealIdempotencyKey`: dedup indexes.
    A repeat `safety.report.created` whose embedded report carries an
    already-seen `idempotencyKey` is silently no-op; the eventId is
    still recorded so replay does not loop.
  - `byTargetAuthority`: reportIds grouped per `authorityId` for
    moderator-inbox surfaces downstream.
  - `byAppealedDecisionId`: appealIds grouped by the decisionId they
    target, for surfacing all appeals against a decision.
  - State machine enforced at apply time:
    - Report: `submitted → acknowledged → resolved`. `submitted →
      resolved` (skip ack) is permitted per the doctrine that an
      authority may resolve immediately for clear cases.
    - Appeal: `submitted → resolved`.
    - Every illegal transition (ack of unknown report, ack of
      already-acked report, resolve of already-resolved report or
      appeal, resolve of unknown id) throws
      `TS_LIFECYCLE_TRANSITION` without mutating state.
  - `applyReportAppealEvent` is pure, deterministic, validates before
    mutating, freezes the result, and is idempotent on `eventId`.
  - `seedReportsAppealsState` replays an event log producing equal
    state on every call (store-reopen rebuild path).
- **`privacy.ts`** — structural privacy guards:
  - `classifyReportPrivacy(report)` returns `'public-routable'` or
    `'private-only'` based on whether the subject type is in
    `PRIVATE_BY_NATURE_SUBJECTS` (`blob`, `media`, `thread`).
  - `assertPrivateEvidenceOnPrivateSubject(report)` enforces, when the
    subject is private-by-nature:
    - Every `evidenceRefs[i]` of kind `media` MUST reference a
      `BlockRef` with `privacy === 'private'` AND a defined
      `encryption` descriptor.
    - Every `evidenceRefs[i]` of kind `bundle` MUST have
      `bundle.encrypted === true`.
    - The optional `encryptedBodyRef` MUST NOT be an identity-kind
      `ObjectRef` (`actor` / `community` / `infrastructure`); those
      cannot carry a private report body.
    - Violations throw `TS_PRIVATE_LEAK`.
    - The projection invokes this guard BEFORE writing a
      `safety.report.created` record, so unsafe events cannot land in
      the store.
  - `canBridgeForwardReport(report)` returns a boolean structural
    pre-check usable by Phase 1.64 bridge admission code without
    invoking validators imperatively.
- **New stable error code**: `TS_LIFECYCLE_TRANSITION` (illegal
  state-machine transitions).
- 5 valid + 4 invalid fixtures under
  `packages/trust-safety/fixtures/reports-appeals/`. Fixtures loader
  test asserts every documented fixture exists and is accepted/rejected
  appropriately.
- 50 new tests across 4 test files exercising every event kind,
  lifecycle transition (legal + every illegal one), idempotency-key
  dedup, replay equivalence, store-reopen rebuild, privacy
  classification, evidence-encryption enforcement on private subjects,
  and the bridge-forwarding pre-check.

### Drive-by fix

While wiring the projection I caught a discriminated-union narrowing
bug in `@lfp2p/content-addressing/object-ref.ts`: the `'media'` value
appeared in both `ContentBackedKind` (digest-backed) and
`MediaObjectRef` (block-backed), which prevented `if (ref.kind ===
'media')` from narrowing cleanly. Fixed by removing `'media'` from
`ContentBackedKind` — the runtime validator already special-cases media
before the content-backed branch, so the dead code is gone. All 622
prior tests still pass.

## Tests and verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 672 passing (287 in trust-safety, 50 new for 1.63)
pnpm build       # clean
```

Additional verification:

- Replay equivalence verified: `seedReportsAppealsState(events)` and
  step-by-step `applyReportAppealEvent` produce equal snapshots.
- Idempotency verified: same `eventId` twice returns the same reference
  (short-circuit via `appliedEventIds`); duplicate `idempotencyKey` on
  a new `safety.report.created` is a silent no-op that still records
  the `eventId`.
- State machine verified by direct positive and negative tests
  per transition.
- Encrypted-evidence enforcement verified at both the helper
  (`assertPrivateEvidenceOnPrivateSubject`) and projection layer
  (`safety.report.created` with unsafe evidence rejected before mutating).

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---:|---|
| Reports require subject, reason, authority, idempotency, and scope | ✓ | Phase 1.61 `validateSafetyReport`; reused unchanged inside `safety.report.created` validator |
| Appeals target policy decisions | ✓ | `SafetyAppeal.decisionId` is required; `safety.appeal.created` embeds the validated appeal and the projection indexes by `byAppealedDecisionId` |
| Public labels cannot expose private evidence refs | ✓ | `assertPrivateEvidenceOnPrivateSubject` rejects public media / unencrypted bundle / identity-ref body when the subject is private-by-nature; projection enforces at apply time |
| Tests cover duplicate reports, private evidence routing, and malformed encrypted refs | ✓ | idempotency-key dedup test + `safety.report.created`-with-unsafe-evidence rejection test + appeal-resolved-without-decision tests + the encrypted-evidence test matrix |

## Security/privacy checks

- [x] No private plaintext in logs — package emits no logs.
- [x] Remote/untrusted input validation exists — every public entry
  uses `assertPlainObject` first; unknown kinds, unknown actions,
  unknown versions, and unknown enums all fail closed.
- [x] Malicious/invalid input tests exist — illegal lifecycle
  transitions, escalated-without-target, overturned-without-newDecisionId,
  public-evidence-on-private-subject, identity-ref-as-body, unknown
  resolutions, unknown version.
- [x] Revocation/permission behavior — the lifecycle accepts whatever
  `SafetyAuthority` is on the event. Signature verification belongs
  to the envelope layer; this projection assumes authenticated
  delivery. Future authority-resolution will plug in here without
  state-shape changes.
- [x] Derived state rebuild/delete behavior —
  `seedReportsAppealsState` is the rebuild path; revert is intentionally
  not supported for reports/appeals because the lifecycle's terminal
  states are doctrine-required.

## Deviations introduced or resolved

- The plan listed `byReportId`, `byIdempotencyKey`, `byTargetAuthority`
  as projection structures. This implementation additionally exposes
  `byAppealId`, `byAppealIdempotencyKey`, and `byAppealedDecisionId`
  for symmetry and to surface "appeals against decision X" cheaply.
- The plan does not specify whether `submitted → resolved` (skipping
  ack) is allowed. This implementation allows it on the doctrine basis
  that an authority MAY resolve immediately for clear-cut cases (e.g.
  `duplicate`, `invalid`). `acknowledged → resolved` remains the
  normal path.
- Per-event `revert` actions are intentionally NOT supported on this
  state machine — terminal states (`resolved`) are doctrine-required.
  A new report or a new appeal is the way to re-litigate.
- The encrypted-evidence guard is enforced structurally on the
  ObjectRef shape only. Verifying that an underlying envelope ACTUALLY
  encrypts content belongs to ADR-002 and the envelope-layer code; this
  package can only enforce that the *declared* privacy and encryption
  descriptors are present.

## Remaining gaps

Out of scope for Phase 1.63, tracked downstream:

- Phase 1.64 bridge admission runtime — must call
  `canBridgeForwardReport` before forwarding, and must NOT decrypt
  encrypted bodies / evidence.
- Phase 1.65 curation runtime — must NOT ingest reports whose
  `classifyReportPrivacy === 'private-only'`.
- Dexie persistence for the projection (local-store).
- Signature verification on lifecycle events (envelope layer).
- A configurable "authority resolution policy" — today the lifecycle
  accepts whichever authority is on the event; a future capability/
  revocation policy can refuse acks/resolves from authorities that
  are not actually entitled to act for the report's target authority.
  This belongs to the trust-policy engine (ADR-006).
- Cross-event linking from a `safety.report.resolved` to its
  produced `SafetyPolicyDecision` runtime row (only the id is stored
  here; consumption belongs to a future query/index slice).

## Decision

This phase is:

- [ ] accepted as complete,
- [x] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason:

The Phase 1.63 plan deliverables are met: the five lifecycle events
are shipped with state-machine enforcement, the projection is
deterministic and replayable, idempotency-key dedup is structural, and
the encrypted-evidence guard is enforced at both the helper and
projection layers. 672 tests pass across the monorepo (287 in
trust-safety, 50 new for 1.63). The package boundary set in 1.61 / 1.62
is preserved (no Dexie, no PWA, no bridge runtime, no ML).

The phase is marked **foundation-only / partial** because Dexie
persistence, bridge admission integration, curation integration, and
the trust-policy authority-resolution layer are intentionally deferred
per the plan. Calling this "Complete" would overstate the depth.
