# Curation and Reach Doctrine

- Status: Draft
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/bridge-admission-doctrine.md`
- Related implementation docs:
  - `docs/implementation/phase-1.61-exit-report.md`
  - `docs/implementation/phase-1.63-exit-report.md`
  - `docs/implementation/phase-1.64-exit-report.md`
- Package: `@lfp2p/trust-safety/curation-runtime`

## Five non-negotiable distinctions

1. **Downranking is NOT hiding.** A downranked item remains visible; only
   its position in a ranked list changes. An app that "downranks" by
   removing items from the surface entirely is doing moderation, not
   curation, and MUST issue a `SafetyPolicyDecision` instead.
2. **Search exclusion is NOT global deletion.** An item excluded from a
   search index is still discoverable through links, direct fetch, the
   author's feed, group threads, etc. The exclusion is local to the
   index that issued it.
3. **Recommendation exclusion is NOT account suspension.** Excluding one
   item from "recommended for you" does not suspend the author, does
   not stop their other content from being recommended, and does not
   affect their ability to publish.
4. **Feed grouping is NOT moderation.** Collapsing a thread or grouping
   related items is a presentation choice. It carries no enforcement
   weight and produces no audit obligation.
5. **Topic labels are NOT safety labels.** A `topic.sports.basketball`
   classification has no enforcement semantics. It becomes a safety
   signal only when a curation rule explicitly maps it (e.g. "downrank
   `topic.spoilers` on `community-feed` during playoffs").

## Surface gates

Curation surfaces split into two classes:

| Class  | Surfaces                                       | Audience scope                         |
| ------ | ---------------------------------------------- | -------------------------------------- |
| Public | `public-feed`, `search`, `recommendation`      | The broader network                    |
| Local  | `local-feed`, `community-feed`, `notification` | One user, one community, or one device |

**Public curation surfaces MUST NOT ingest:**

- Envelopes whose privacy scope is anything other than `public`.
  (`device-local`, `self`, `dm`, `group` never appear on public
  surfaces.)
- `SafetySubjectRef`s of private-by-nature types (`blob`, `media`,
  `thread`).
- `SafetyReport`s whose `classifyReportPrivacy` returns `private-only`.
  This is the structural answer to "reports about private content
  must not drive public curation" — Phase 1.63's deferral resolved
  by the Phase 1.65 surface gate.

The gate is structural and runs without decrypting anything.
`decideCurationSurfaceIngest` and `decideReportAsCurationSignal` are
the pure entry points; `assertCurationSurfaceIngest` and
`assertReportAsCurationSignal` are the throwing variants used at
boundaries where refusal must be a hard error.

## Rule lifecycle

```
created → disabled  (terminal)
```

There is no "re-enable". Disabling a rule is the canonical way to
neutralize its effect; resurrecting it would force consumers to
silently undo work they did while it was off. A replacement rule is
issued under a fresh `ruleId`.

`curation.rule.disabled` records:

- which rule (`ruleId`),
- who disabled it (`disabledBy: SafetyAuthority`),
- when (`disabledAt`),
- and the reason (`reasonCode`).

Item-level boosts / downranks / exclusions remain in the projection
even after their source rule is disabled — but
`computeItemRanking` filters them out at read time so a disabled
rule's effect is immediately reversed. This preserves a complete
audit trail without rewriting history.

## Item action accumulation

Multiple rules may target the same subject. Each item action records
its `sourceRuleId` and is appended (never replacing earlier actions).
`computeItemRanking` returns:

- `effectiveNetScoreDelta`: sum of boost deltas minus downrank deltas,
  **considering only actions whose source rule is currently active**.
- `isExcludedFromFeed | isExcludedFromSearch | isExcludedFromRecommendation`:
  true iff at least one currently-active exclusion targets the
  `excludeFrom` value.

Score deltas are bounded `[0, MAX_SCORE_DELTA = 100]` per event so a
single rule cannot dominate the ranking, and so an adversary cannot
push a ranking into an unrecoverable state. Aggregate net deltas are
unbounded — that is the surface's choice of weighting.

## Audit and explanation hygiene

`CurationExplanation` (Phase 1.61) is the structured rationale
attached to an item action. Doctrine constraints:

- `reasonCodes` MUST come from `SAFETY_REASON_CODES`. No free-form
  text — that goes in app-side audit logs, not protocol-level
  explanations, so analytics consumers can never inadvertently leak
  PII through the reason field.
- Explanations are idempotent on `explanationId`. Replay does not
  duplicate.

## Versioning and fail-closed semantics

- `lfp2p.curation-event.v1` is the pinned event version. Unknown
  versions fail closed (`TS_UNKNOWN_VERSION`).
- Unknown event kinds, unknown surfaces, unknown `excludeFrom`
  values, negative `scoreDelta`, and `scoreDelta` exceeding
  `MAX_SCORE_DELTA` all fail closed at validation time.
- Lifecycle violations (`disable` of unknown rule, double-disable,
  re-create under existing `ruleId`) throw `TS_LIFECYCLE_TRANSITION`
  without mutating state.

## What the curation runtime MUST NOT do

- **Issue `SafetyPolicyDecision` actions.** The curation runtime
  produces ranking adjustments and exclusions, never moderation
  decisions. A `CurationRule` whose action would be a moderation
  action (e.g. `hide`, `quarantine`, `reject-transport`) is rejected
  at validation time by `TS_CURATION_MASQUERADE` (Phase 1.61).
- **Touch private content directly.** Public surfaces work only on
  the structural metadata that's already public; private content
  passes through the bridge admission gate and never reaches public
  curation indexes.
- **Use private reports as signals for public ranking.** Even when
  the underlying report is authentic and the issuer is trusted,
  if the report's classification is `private-only`, the structural
  signal cannot inform `public-feed`, `search`, or `recommendation`.

## Implementation evidence

- Package: `packages/trust-safety/src/curation-runtime/`
- 829 tests pass across the monorepo; ~50 of those exercise the
  curation runtime directly.
- 6 valid + 3 invalid fixtures covering every event kind.
- Exit report: `docs/implementation/phase-1.65-exit-report.md`.
