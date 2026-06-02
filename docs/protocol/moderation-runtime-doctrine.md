# Moderation Runtime Doctrine

- Status: Draft
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/labeler-runtime-doctrine.md`
  - `docs/protocol/curation-doctrine.md`
- Related implementation docs:
  - `docs/implementation/phase-1.61-exit-report.md`
  - `docs/implementation/phase-1.63-exit-report.md`
  - `docs/implementation/phase-1.67-exit-report.md`
- Package: `@lfp2p/trust-safety/moderation-runtime`

## What this is

The moderation runtime is the policy + decision + queue lifecycle that
turns the existing `SafetyPolicyDecision` shape (Phase 1.61) into a
working moderation workflow: communities author versioned policies,
moderators work a queue of items spawned from reports / labels /
manual triage, and decisions get recorded with full audit-traceability
back to the exact policy version under which they were made.

## What this is NOT

- **A moderation tools API.** The runtime is the protocol shape +
  projection; the wire format (HTTP/WS) for a moderator's UI to fetch
  the queue, claim items, and submit decisions belongs to a future
  `apps/moderation-tools` workspace.
- **A trust authority layer.** Whether a moderator's decision is
  honored is the trust-policy engine's job (ADR-006).
- **A labeler runtime.** Labelers publish advisory labels (Phase 1.66);
  moderators turn signals into enforcement (Phase 1.67). The two
  surfaces stay separate by doctrine.

## Five non-negotiable rules

1. **A `SafetyPolicy` is a versioned document.** `safety.policy.created`
   produces version 1. Each `safety.policy.updated` MUST carry
   `policyVersionNumber = active + 1` and
   `supersedesPolicyVersionNumber = active`. Skips, gaps, and
   mismatched supersedes pointers are rejected.

2. **Deprecation does NOT retroactively reverse decisions.** A
   `safety.policy.deprecated` event marks the policy retired but every
   `SafetyPolicyDecision` made under any of its versions remains
   intact in the projection. The audit trail "this decision was made
   under v3 of policy X, which was later deprecated" is preserved.

3. **Decisions cite a specific `policyVersion` string.** The
   `SafetyPolicyDecision.policyVersion` field (Phase 1.61) points to a
   specific version of the policy. Even when the policy text changes,
   the decision audit chain remains complete.

4. **Queue items are operator-scoped.** A community moderator's queue
   is not a bridge operator's queue. The `ownerAuthority` field on a
   `moderation.queue.item.created` event names the authority whose
   queue this item belongs to. The projection indexes by assignee so
   a moderator inbox view is O(1).

5. **Queue items may skip the assignment step.** Clear-cut cases
   (`duplicate`, `invalid`) can go directly from `open → resolved`.
   The normal flow is `open → assigned → resolved`. Terminal at
   `resolved`.

## State machines

### Policy

```
absent ──safety.policy.created (v=1)──▶ active@v1
active@v ──safety.policy.updated (v=active+1, supersedes=active)──▶ active@(v+1)
active@v ──safety.policy.deprecated──▶ deprecated@v (terminal)
```

After deprecation:
- Past decisions remain queryable by their `policyVersion` strings.
- New `safety.policy.created` under the same `policyId` is REJECTED
  (the projection keeps the deprecated record under that id). A
  successor policy uses a fresh `policyId`.

### Queue item

```
absent ──moderation.queue.item.created──▶ open
open    ──moderation.queue.item.assigned──▶ assigned
open    ──moderation.queue.item.resolved──▶ resolved (skip-assignment)
assigned──moderation.queue.item.resolved──▶ resolved
resolved is terminal.
```

Resolutions are one of `acted | dismissed | duplicate | invalid |
forwarded`. The `acted` resolution SHOULD cite the resulting
`SafetyPolicyDecision` via `resolutionDecisionId`; the projection
cross-references both ways (queue item ↔ decision).

### Decision

Append-only by `decisionId`. Duplicate `decisionId` is a silent no-op
(replay-safe).

## Cross-references the projection maintains

| Lookup | Source index |
|---|---|
| All decisions against subject S | `decisionsBySubjectKey` |
| All decisions made under policy version string V | `decisionsByPolicyId` |
| All queue items in a given status | `queueIdsByStatus` |
| All queue items assigned to authority A | `queueIdsByAssignee` |
| All queue items spawned from source `(kind, id)` | `queueIdsBySourceId` — used by Phase 1.63 cross-ref |
| Decision that resolved queue item Q | `queueItemsById[Q].resolutionDecisionId` |
| Queue item that produced decision D | `decisionsById[D].sourceQueueItemId` |

## Integration points

- **Phase 1.63 reports**: when a `safety.report.acknowledged` event
  fires, the host can emit `moderation.queue.item.created` with
  `sourceKind = 'report'` and `sourceId = reportId`. The projection's
  `queueItemsForSource('report', reportId)` returns the corresponding
  queue items.
- **Phase 1.66 labelers**: a high-severity automated label may
  spawn a queue item via `sourceKind = 'label'`, `sourceId = labelId`.
  The doctrine: labels remain advisory; spawning a queue item makes
  them actionable for a human moderator without elevating the label
  itself to enforcement.
- **Phase 1.61 decisions**: a moderator's `SafetyPolicyDecision`
  gets wrapped in `safety.policy.decision.recorded` so the audit
  chain (queue item → decision → subject → authority → policy
  version) is one projection lookup away.

## What the moderation runtime MUST NOT do

- **Erase past decisions on deprecation.** Even when the community
  decides a policy was wrong, the decisions stand; the next step is
  appeals (Phase 1.63), not retroactive erasure.
- **Reassign a resolved queue item.** Re-opening is not a
  state-machine transition. A new queue item is the way to
  re-litigate.
- **Allow a queue item's `resolutionDecisionId` to point to a
  non-existent decision.** The validator does not enforce existence
  (the decision may have been recorded in a different operator's
  projection), but the projection's cross-reference index will return
  no record for the back-pointer if the decision is missing.
- **Make decisions that the trust-policy engine has not authorized.**
  The projection records what authorities submit; the trust-policy
  engine (ADR-006) decides which authorities' decisions actually
  enforce at downstream surfaces.

## Implementation evidence

- Package: `packages/trust-safety/src/moderation-runtime/`
- 884 tests pass across the monorepo; 28 new for Phase 1.67 covering
  every legal and illegal transition, decision-recording, cross-
  reference helpers, replay equivalence, and queue/decision two-way
  linkage.
- 3 valid + 3 invalid fixtures.
- Exit report: `docs/implementation/phase-1.67-exit-report.md`.
