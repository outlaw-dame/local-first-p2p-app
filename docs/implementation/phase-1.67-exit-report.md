# Phase Exit Report: Phase 1.67 — Moderation Runtime

- Status: Accepted as foundation-only / partial (see Decision)
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/moderation-runtime-doctrine.md` (new)
- Related implementation docs:
  - `docs/implementation/trust-safety-phase-plan.md`
  - `docs/implementation/phase-1.61-exit-report.md`
  - `docs/implementation/phase-1.63-exit-report.md`
  - `docs/implementation/phase-1.66-exit-report.md`

## Phase scope

Phase 1.67 closes the second of the two doctrinal gaps identified
after Phase 1.65:

> **Gap B — Policy and moderation decision lifecycle events.** Phase
> 1.61 shipped the `SafetyPolicyDecision` shape but not the events
> that turn it into a moderation workflow. The
> `Event family reservations / Policy and moderation decisions`
> section of `docs/protocol/trust-safety-event-policy.md` lists seven
> events; none had been shipped.

## Completed work

### New shape: `SafetyPolicy` (`packages/trust-safety/src/policies.ts`)

Pinned `lfp2p.safety-policy.v1`. Fields:

- `policyId`, `policyVersionNumber` (safe integer ≥ 1)
- `title`, `body` (length-bounded)
- `scope: EnforcementScope`
- `applicableActions: SafetyAction[]` (at least one)
- `createdBy: SafetyAuthority`, `createdAt`
- Optional `supersedesPolicyVersionNumber` — must be a positive safe
  integer strictly less than `policyVersionNumber`

The shape is what `safety.policy.created` and `safety.policy.updated`
embed. Decisions reference policies through their existing
`policyVersion: string` field (Phase 1.61); the convention is to use
`${policyId}::${policyVersionNumber}` strings, but the runtime does
not enforce the format — the `policyVersion` field is treated as an
opaque audit key.

### New sub-module: `packages/trust-safety/src/moderation-runtime/`

#### `events.ts` — seven lifecycle event kinds

Pinned `lfp2p.moderation-event.v1`:

| Event | Payload |
|---|---|
| `safety.policy.created` | embeds `SafetyPolicy`; requires `policyVersionNumber === 1` |
| `safety.policy.updated` | embeds the new version; cross-checked at apply time |
| `safety.policy.deprecated` | `policyId` + `deprecatedBy` + `deprecatedAt` + `reasonCode` + optional `replacementPolicyId` |
| `safety.policy.decision.recorded` | embeds existing `SafetyPolicyDecision` + optional `sourceQueueItemId` |
| `moderation.queue.item.created` | `queueItemId` + `ownerAuthority` + `sourceKind` (`report | label | annotation | manual`) + `sourceId` + `reasonCode` + optional `summary` |
| `moderation.queue.item.assigned` | `queueItemId` + `assignedTo` + `assignedAt` |
| `moderation.queue.item.resolved` | `queueItemId` + `resolvedBy` + `resolvedAt` + `resolution` (`acted | dismissed | duplicate | invalid | forwarded`) + `resolutionReasonCode` + optional `resolutionDecisionId` + optional `resolutionNotes` |

#### `projection.ts` — `ModerationState` with rich indexing

Frozen snapshot with:

- `policiesByPolicyIdAndVersion` keyed by `${policyId}::${versionNumber}` — every version preserved
- `activePolicyVersionByPolicyId` — pointer to the currently-active version (cleared on deprecation)
- `decisionsById`, `decisionsBySubjectKey`, `decisionsByPolicyId` — three cross-reference indexes
- `queueItemsById` and three queue indexes: `queueIdsByStatus`, `queueIdsByAssignee`, `queueIdsBySourceId`
- `appliedEventIds` for replay idempotency

State machines enforced at apply time:

- **Policy**: `absent → active@v1 → active@v2 → ... → deprecated@vN` (terminal). Updates must carry `policyVersionNumber = active + 1` AND `supersedesPolicyVersionNumber = active`. Skips, mismatched supersedes pointers, double-create, and re-create-after-deprecation are rejected with `TS_LIFECYCLE_TRANSITION`.
- **Queue item**: `open → assigned → resolved` with `open → resolved` skip-assignment permitted; terminal at `resolved`. Re-create, re-assign-resolved, re-resolve, and assign-resolved are rejected.
- **Decision**: append-only by `decisionId`; duplicate is silent no-op.

#### `queueItemsForSource(state, sourceKind, sourceId)` helper

Resolves the Phase 1.63 cross-reference: given a `reportId`, return the queue items that opened against it. Generalized to any `(sourceKind, sourceId)` pair so labeler-spawned and manual queue items work the same way.

### Fixtures

3 valid + 3 invalid under `packages/trust-safety/fixtures/moderation/`:

| Valid | Invalid (shape-level) |
|---|---|
| `policy-created.json` | `policy-version-zero.json` |
| `queue-item-created.json` | `policy-supersedes-not-less-than-version.json` |
| `decision-recorded.json` | `queue-resolved-unknown-resolution.json` |

Projection-level lifecycle violations are covered by the unit tests
in `moderation-runtime.test.ts` (not the fixtures-loader test).

### Tests

28 new tests across 2 test files exercising:

- Policy v1 creation, active pointer, version-key indexing.
- `safety.policy.created` rejection for `policyVersionNumber ≠ 1`,
  rejection for re-create under existing `policyId`.
- v1 → v2 update with matching supersedes; rejection for skip
  (e.g. v1 → v3); rejection for mismatched supersedes pointer.
- Deprecation marks the latest version deprecated and clears active
  pointer; past decisions remain queryable.
- Rejection for deprecating unknown / already-deprecated policy.
- Queue open → assigned → resolved happy path with bucket
  transitions verified.
- Queue open → resolved skip-assignment.
- Rejection for assigning unknown / resolved / already-assigned
  items; rejection for resolving unknown / already-resolved items;
  rejection for re-create under existing queue item id.
- Decision recording, subject + policyVersion cross-indexing,
  duplicate-decisionId silent no-op.
- Queue ↔ decision two-way linkage via `sourceQueueItemId` /
  `resolutionDecisionId`.
- `queueItemsForSource` returns the right set for each `reportId`.
- Replay equivalence (seed = step-by-step), eventId idempotency.

### New doctrine document

`docs/protocol/moderation-runtime-doctrine.md` with:
- What this is / what this is NOT (the moderation tools API is
  explicitly out of scope here).
- Five non-negotiable rules.
- State machine diagrams for policy / queue item / decision.
- Cross-reference index table.
- Integration points with Phase 1.61 / 1.63 / 1.66.
- "What the moderation runtime MUST NOT do" section.

## Tests and verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 884 passing (28 new for Phase 1.67)
pnpm build       # clean
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---:|---|
| All 7 Phase 1.61 reserved policy/moderation event kinds shipped | ✓ | Plus the new `SafetyPolicy` shape underpinning them |
| Policy versioning preserves audit chain | ✓ | Versions never overwritten; `decisionsByPolicyId` indexes by version string |
| Deprecation is not retroactive | ✓ | Direct test asserts decisions remain queryable after deprecation |
| Queue items are operator-scoped | ✓ | `ownerAuthority` field; `queueIdsByAssignee` indexes per authority |
| Queue open → resolved skip-assignment permitted | ✓ | Direct test |
| Cross-references queue ↔ decision both ways | ✓ | `sourceQueueItemId` and `resolutionDecisionId` round-trip verified |
| Phase 1.63 integration: `queueItemsForSource` for a reportId | ✓ | Direct test |

## Security/privacy checks

- [x] No private plaintext in logs — package emits no logs.
- [x] Remote/untrusted input validation — every event has shape
  validation; every state machine transition is enforced before
  mutation.
- [x] Malicious/invalid input tests exist — version-zero policy,
  supersedes ≥ versionNumber, unknown resolution enum, every illegal
  state transition.
- [x] Revocation/permission behavior — deprecation is the protocol
  way to "revoke" a policy without rewriting history.
- [x] Derived state rebuild/delete behavior — `seedModerationState` is
  the canonical rebuild; idempotent on `eventId` and `decisionId`.

## Deviations introduced or resolved

- Decision-recording does NOT verify that the `decision.policyVersion`
  string refers to a policy version that exists in this projection.
  The decision may have been issued under a policy held by a
  different operator's projection (cross-community moderation
  forwarding). The audit chain is preserved structurally even if the
  lookup returns empty.
- A `safety.policy.created` event for a `policyId` that has been
  previously deprecated is REJECTED. Rationale: re-using a deprecated
  policyId blurs the audit chain. A successor policy uses a fresh
  policyId, optionally citing the deprecated one via
  `replacementPolicyId` on the deprecation event.
- Re-resolving a resolved queue item is REJECTED rather than
  permitting "re-open." Re-litigation uses a fresh queue item that
  cites the prior outcome via its `summary`.

## Remaining gaps

Out of scope for Phase 1.67, tracked downstream:

- **Moderation tools API** — the HTTP/WS wire format for a
  moderator's UI to fetch the queue, claim items, and submit
  decisions. Belongs to a future `apps/moderation-tools` workspace.
- **Dexie persistence** for `ModerationState` — belongs to
  `packages/local-store`.
- **Cross-projection wiring** — when a `safety.report.acknowledged`
  fires (Phase 1.63), some host code must currently choose whether
  to emit a `moderation.queue.item.created`. A future automation
  layer can wire that up.
- **Trust-policy engine integration** (ADR-006) — the projection
  records decisions without judging whether the authority who issued
  them was actually entitled to act on the subject. That judgement
  belongs to the future trust-policy engine.

## Decision

This phase is:

- [ ] accepted as complete,
- [x] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason:

Phase 1.67 closes Gap B from the post-1.65 audit. Seven lifecycle
events ship with shape validation; the projection enforces every
state machine; the cross-reference indexes let a future moderator UI
or automation layer compose the workflow without re-discovering the
structure. 884 tests pass across the monorepo (28 new for Phase
1.67). Same boundary discipline as 1.6x: no HTTP, no Dexie, no UI.

The phase is marked **foundation-only / partial** because the actual
moderation tools API, persistence wiring, and cross-projection
automation are intentionally deferred per the plan boundary.
