# Phase Exit Report: Phase 1.66 — Labeler Runtime (Composable / Stackable Moderation)

- Status: Accepted as foundation-only / partial (see Decision)
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/labeler-runtime-doctrine.md` (new)
- Related implementation docs:
  - `docs/implementation/trust-safety-phase-plan.md`
  - `docs/implementation/phase-1.61-exit-report.md`
  - `docs/implementation/phase-1.62-exit-report.md`

## Phase scope

Phase 1.66 closes the first of the two doctrinal gaps identified after
Phase 1.65:

> **Gap A — Labeling / Tagger agent lifecycle events.** The Phase 1.61
> protocol core shipped the *shapes* for labels, labelers, and
> annotations, but not the lifecycle events that turn those shapes into
> a runtime composable moderation system. The `Event family
> reservations` section of `docs/protocol/trust-safety-event-policy.md`
> lists six events for this family; none had been shipped.

The phase also folds in an explicit product requirement raised in this
conversation: the labeler architecture must support *many labelers and
many types of labelers*, emulating ATProto's composable / stackable
moderation while structurally improving the parts ATProto has had
practical problems with (public subscription lists, weak per-namespace
trust, all-or-nothing per-labeler config, no kind taxonomy, no
first-class aggregator concept).

## Completed work

### Phase 1.61 shape extensions (backward-compatible)

`SafetyLabelerProfile` (`packages/trust-safety/src/labelers.ts`)
gained two optional fields under the existing
`lfp2p.safety-labeler-profile.v1` schema:

- **`kind: LabelerKind`** — self-declared taxonomy entry. Seven
  values: `human-curated`, `automated-classifier`, `hybrid`,
  `attestation`, `community-aggregator`, `media-scanner`, `unknown`.
  The default for v1 profiles emitted before this field existed is
  `unknown`. Advisory metadata only — the protocol does not infer
  authority from kind.
- **`aggregatorOf: ReadonlyArray<string>`** — for the
  `community-aggregator` kind, the list of source labelerIds whose
  streams the aggregator re-publishes. Cross-validated:
  - Required when `kind === 'community-aggregator'`.
  - Rejected when `kind` is anything else.
  - Must be non-empty.
  - Must not include the labeler's own id (trust-loop guard).

Both fields are optional. Existing v1 fixtures and tests continue to
pass unchanged (verified: the prior 829-test suite still passes).

### New sub-module `packages/trust-safety/src/labelers-runtime/`

#### `events.ts` — seven lifecycle event kinds

Pinned `lfp2p.labeler-event.v1`:

| Event | Payload |
|---|---|
| `safety.labeler.profile.published` | embeds `SafetyLabelerProfile`; re-publish supersedes prior under same `labelerId` |
| `safety.label-definition.published` | embeds `SafetyLabelDefinition`; append-only by `(namespace, labelKey)` |
| `safety.labeler.subscribed` | embeds `SafetyLabelerSubscription`; envelope scope must be `device-local` or `account-local` (Phase 1.62 doctrine) |
| `safety.labeler.unsubscribed` | references `subscriptionId` + `unsubscribedAt` + optional `reasonCode`; terminal |
| `safety.label.applied` | embeds `SafetyLabel`; rejected if `labelId` already exists |
| `safety.label.revoked` | references `labelId` + `revokedBy` authority + `revokedAt` + `reasonCode`; **rejected if the revoker's `actorId` does not match the original label's `issuer.actorId`** |
| `safety.annotation.created` | embeds `SafetyAnnotation`; append-only by `annotationId` (silent no-op on duplicate) |

The policy doc listed six event kinds for this family; I added a
seventh (`safety.label-definition.published`) because labels reference
their definition by `(namespace, labelKey)` and a runtime needs to
ingest definitions to resolve effective actions. This is additive to
the original list and documented in the doctrine doc.

#### `projection.ts` — `LabelersState` with composable stacking

Frozen snapshot with `labelerProfilesById`, `labelDefinitionsByKey`,
`subscriptionsById`, `labelsByLabelId`, `labelsBySubjectKey`,
`annotationsById`, `appliedEventIds`. Pure / deterministic /
idempotent / replay-equivalent.

State machine:
- Profile: re-publish supersedes (intentional, not a violation).
- Definition: append-only by `(namespace, labelKey)`; re-registration
  under existing key rejected.
- Subscription: `active → unsubscribed` (terminal); double-unsubscribe
  rejected; re-subscribe under existing `subscriptionId` rejected.
- Label: `active → revoked` (terminal); cross-labeler revoke rejected;
  re-apply under existing `labelId` rejected.
- Annotation: append-only; duplicate `annotationId` silent no-op.

#### Composable stacking: `effectiveLabelsForSubject`

The headline improvement. Returns a `ResolvedLabel[]` — one entry per
(labelKey × issuing labeler) for the given subject — with full
provenance:

```ts
ResolvedLabel {
  labelId, labelKey, namespace,
  issuerActorId, issuerLabelerId, labelerKind,  // who issued, what kind
  severity, confidence,
  effectiveAction,    // after applying subscriber's per-labeler overrides
  appliedAt
}
```

Filtering rules:
1. Revoked labels excluded.
2. Labels from labelers the subscriber doesn't subscribe to excluded.
3. Labels in namespaces the subscription doesn't trust excluded.
4. Labels in labelKeys the subscription's `trustedLabels` list
   doesn't include (when that list is set) excluded.
5. For each surviving label, the matching `actionOverride` derives
   `effectiveAction`. With no override, the
   `SafetyLabelDefinition.defaultAction` applies. With no definition
   either, severity-derived defaults apply.

Companion: `mostRestrictiveAction(stack)` picks the highest-rank
action across the stack as a default combiner; UI / policy / curation
layers may compose differently.

### Fixtures

6 valid + 3 invalid under `packages/trust-safety/fixtures/labelers/`:

| Valid | Invalid |
|---|---|
| `profile-published-automated.json` | `aggregator-without-sources.json` |
| `profile-published-aggregator.json` | `aggregator-self-loop.json` |
| `subscribed.json` | `non-aggregator-with-aggregatorOf.json` |
| `label-applied.json` | |
| `label-revoked.json` | |
| `annotation-created.json` | |

### Tests

27 new tests across 2 test files exercising:

- Two labelers stacking on the same subject (returns 2 resolved
  entries with distinct provenance + labeler kinds).
- Per-labeler `actionOverride` produces per-labeler `effectiveAction`
  (e.g. labeler A's spam = warn, labeler B's spam = hide).
- `mostRestrictiveAction` picks `hide` in that scenario.
- Cross-labeler revoke rejected.
- Same-labeler revoke succeeds; resolved stack drops the label.
- Unsubscribed mid-stack filters out that labeler.
- Per-namespace + per-label trust filters.
- Profile re-publish supersedes (kind change visible).
- Replay equivalence (seed = step-by-step).
- Aggregator field cross-checks (without-sources, self-loop, non-aggregator-with-field).
- Lifecycle illegal transitions (re-subscribe, double-unsubscribe, re-apply).

### New doctrine document

`docs/protocol/labeler-runtime-doctrine.md` with:
- ATProto-to-our-architecture mapping table.
- 12 explicit improvements over ATProto.
- State machine reference.
- "What the labeler runtime MUST NOT do" section.

## Tests and verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 856 passing (27 new for Phase 1.66)
pnpm build       # clean
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---:|---|
| All six Phase 1.61 reserved labeler/tagger event kinds shipped | ✓ | Plus 7th (`safety.label-definition.published`) folded in for runtime completeness |
| Subscriptions remain `device-local` / `account-local` private | ✓ | `SafetyLabelerSubscription.scope` enum was already restricted in Phase 1.61; no new public-scope leakage |
| Composable / stackable resolution shipped | ✓ | `effectiveLabelsForSubject` returns full stack per (labelKey × issuer) |
| Many labelers supported | ✓ | No upper bound on the number of subscribed labelers; per-labeler state independent |
| Many *types* of labelers supported | ✓ | 7-entry `LabelerKind` enum + `community-aggregator` first-class |
| Cross-labeler revoke rejected | ✓ | Structural enforcement at apply time |

## Security/privacy checks

- [x] No private plaintext in logs — package emits no logs.
- [x] Remote/untrusted input validation — every event has shape
  validation; unknown kinds, unknown versions, malformed labels,
  aggregator inconsistencies all fail closed.
- [x] Malicious/invalid input tests exist — cross-labeler revoke,
  re-subscribe, aggregator self-loop, aggregator-without-sources,
  non-aggregator-with-sources.
- [x] Revocation/permission behavior — revocation gated by
  `actorId` match; no impersonation path.
- [x] Derived state rebuild/delete behavior — `seedLabelersState` is
  the canonical rebuild; idempotent on `eventId`; annotations
  idempotent on `annotationId`.

## Deviations introduced or resolved

- Added a 7th event kind (`safety.label-definition.published`) beyond
  the Phase 1.61 reservation list. The runtime needs definitions to
  resolve effective actions; without an event for them, definitions
  would have to be assumed pre-existing in the projection. Documented
  as a deliberate extension in the doctrine doc.
- Re-subscribing under an existing `subscriptionId` is rejected.
  Alternative interpretation: "treat as update". Chose rejection
  because the policy doc treats subscriptions as auditable state and
  an "update" obscures intent. New subscription = new id.
- A *labeler authority's* `authorityId` is treated as the *labelerId*
  for purposes of cross-referencing subscriptions and labels. This
  matches the policy doc's convention that a labeler runs as an
  identity-controlled authority. The trust-policy engine (ADR-006) may
  later impose stricter checks.

## Remaining gaps

Out of scope for Phase 1.66, tracked downstream:

- **Labeler HTTP/WS API** — the wire format for publishing labels
  from a labeler service to subscribers. Belongs to a future
  `apps/labeler-service` or to `apps/bridge-service`.
- **Subscriber-side ingestion runtime** — fetching the labeler's
  stream and feeding events into `applyLabelerEvent`. Belongs to
  `packages/sync-client`.
- **Dexie persistence** for `LabelersState` — belongs to
  `packages/local-store`.
- **Trust-policy engine integration** (ADR-006) — the policy engine
  decides which labelers a community actually trusts; this slice
  records subscriptions but does not gate on a higher-level policy.

## Decision

This phase is:

- [ ] accepted as complete,
- [x] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason:

Phase 1.66 closes Gap A from the post-1.65 audit and ships a
composable / stackable labeler runtime that is strictly more
expressive than ATProto's: private-by-default subscriptions,
per-namespace and per-label trust, kind taxonomy, first-class
aggregators, full provenance preserved in the stack. The seven
lifecycle events plus the state machine plus the resolution function
plus the doctrine doc constitute a complete protocol foundation for a
future labeler API.

The phase is marked **foundation-only / partial** because the wire
API, sync-client ingestion, Dexie persistence, and trust-policy
engine integration are all intentionally deferred per the plan
boundary. Calling this "Complete" would overstate the integration
depth.
