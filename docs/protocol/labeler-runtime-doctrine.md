# Labeler Runtime Doctrine

- Status: Draft
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/local-controls-portability.md`
  - `docs/protocol/curation-doctrine.md`
- Related implementation docs:
  - `docs/implementation/phase-1.61-exit-report.md`
  - `docs/implementation/phase-1.62-exit-report.md`
  - `docs/implementation/phase-1.66-exit-report.md`
- Package: `@lfp2p/trust-safety/labelers-runtime`

## Goal

Emulate the composable / stackable labeler model popularized by
ATProto, while structurally improving on the parts that have caused
practical problems there: public subscription lists, weak per-namespace
trust, all-or-nothing per-labeler configuration, no kind taxonomy, and
no first-class aggregator concept.

## How ATProto's model maps to ours

| ATProto concept                           | Our equivalent                                                                      | Notes                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Labeler service (DID + endpoint)          | `SafetyLabelerProfile`                                                              | Profile carries `labelerId`, `serviceEndpoint`, supported namespaces / labels, and now `kind`.                   |
| Label value                               | `SafetyLabel.labelKey` + `namespace`                                                | Two-part name avoids collisions across labelers.                                                                 |
| User subscribes to a labeler              | `safety.labeler.subscribed` (envelope scope: `device-local` / `account-local` only) | Private by default; never public.                                                                                |
| Per-label-value config (ignore/warn/hide) | `SafetyLabelerSubscription.actionOverrides`                                         | Wider action set: `allow`, `warn`, `collapse`, `blur-media`, `downrank`, `hide`.                                 |
| Composable stacking in the AppView        | `effectiveLabelsForSubject` returning a `ResolvedLabel[]`                           | One entry per (labelKey × issuing labeler). Caller chooses the combiner; `mostRestrictiveAction` is the default. |
| Labeler publishes labels via HTTP         | Out of scope for this protocol slice                                                | Belongs to a future labeler API (Phase 4 territory).                                                             |

## Improvements over ATProto

1. **Subscriptions are private by default.** A `safety.labeler.subscribed`
   event must use `device-local` or `account-local` envelope scope.
   Public discovery of "who trusts which labeler" is structurally
   prevented at the protocol layer.

2. **Cross-app subscription portability.** Inherited from Phase 1.62:
   `safety.preferences.snapshot` carries labeler subscriptions so a
   user's other apps adopt them automatically.

3. **Per-namespace trust.** `SafetyLabelerSubscription.trustedNamespaces`
   filters labels at the namespace level. Optional `trustedLabels`
   further filters at the `labelKey` level. ATProto subscriptions are
   all-or-nothing per labeler.

4. **Hard-safety labels cannot be silently downgraded.** Phase 1.61's
   `SafetyLabelDefinition.hardSafety` and `userConfigurable=false`
   rules apply: a user override cannot bypass a hard-safety label.

5. **Allowlist suppression for non-hard-safety labels.** Phase 1.62.1:
   a user can allowlist a trusted actor; the labeler runtime's stack
   resolution is the same, but the visibility selector
   (`@lfp2p/trust-safety/local-controls`) drops non-hard-safety stack
   entries for allowlisted actors.

6. **Public-flow isolation.** Phase 1.65 surface gate: a private-only
   report or a private-by-nature subject cannot become a curation
   signal on a public surface, no matter what a labeler claims.

7. **Bundled subscriptions via policy lists.** Phase 1.62.1:
   `safety.policy-list.subscribed` lets a user subscribe to a community-
   maintained list of labelers (and other rules) with one event.

8. **Labeler kind taxonomy.** Self-declared `kind` field on the
   profile:
   - `human-curated`
   - `automated-classifier`
   - `hybrid`
   - `attestation`
   - `community-aggregator`
   - `media-scanner`
   - `unknown` (default when absent)

   Advisory metadata. The protocol does not infer authority from kind.
   Downstream trust-policy engines (ADR-006) may.

9. **First-class aggregators.** A `community-aggregator` labeler
   declares `aggregatorOf: string[]` listing the source labelerIds
   whose streams it re-publishes. Subscribing to an aggregator
   transitively trusts its _curation_ of which sources to include —
   not the source labelers themselves for their other work.
   - Aggregator self-loops are rejected (`labelerId` cannot appear in
     its own `aggregatorOf`).
   - Aggregator-without-sources is rejected.
   - Non-aggregator with `aggregatorOf` is rejected.

10. **Explicit stacking semantics.** `effectiveLabelsForSubject`
    returns the full stack of `(labelKey, issuingLabeler) → effectiveAction`,
    not a single winning action. The caller (UI, policy engine, curation
    runtime) decides how to combine. Default helper `mostRestrictiveAction`
    picks the highest-rank action. The full provenance — which labeler
    issued each label, with their kind — is preserved for transparency.

11. **Cross-labeler revocation is rejected.** A label can only be
    revoked by an authority whose `actorId` matches the original
    label's `issuer.actorId`. Cross-labeler disagreement is expressed
    by _issuing an opposing label_, not by trying to revoke the other
    labeler's signal.

12. **Append-only annotations.** No `safety.annotation.revoked` event:
    annotations are signed statements about a moment in time;
    superseding is done with a new annotation.

## State machine

| Object                | Transitions                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LabelerProfile`      | Re-publish supersedes prior profile under the same `labelerId`. No "withdraw" — to stop offering labels, the labeler simply stops applying them and the subscriber-side TTL / lack-of-fresh-events handles it. |
| `LabelDefinition`     | Append-only by `(namespace, labelKey)`. To change a definition, register a new key.                                                                                                                            |
| `LabelerSubscription` | `active → unsubscribed` (terminal). New subscriptions require a fresh `subscriptionId`.                                                                                                                        |
| `Label`               | `active → revoked` (terminal). Re-applying the same `labelId` is rejected.                                                                                                                                     |
| `Annotation`          | Append-only by `annotationId`. Duplicate id silently no-op (replay-safe).                                                                                                                                      |

## What the labeler runtime MUST NOT do

- **Decrypt private content.** The runtime operates on protocol shapes
  only. Labels about private content are produced by labelers who
  have access to the content through other means; the runtime does
  not assist or require decryption.
- **Promote labels to enforcement decisions.** A label is an advisory
  signal. To produce enforcement, a moderator's `SafetyPolicyDecision`
  is required (Phase 1.61 + Phase 1.67 lifecycle).
- **Trust an aggregator's claim about its sources without verification.**
  The aggregator declares `aggregatorOf`, but consumers should
  cross-check: do the source labelerIds actually exist? Are they
  themselves trustworthy? The runtime exposes the declaration; trust
  policy decides what to do with it.
- **Override hard-safety labels.** `SafetyLabelDefinition.hardSafety`
  rules (Phase 1.61) constrain how user `actionOverrides` are
  resolved; the runtime preserves the hard-safety constraint.

## Implementation evidence

- Package: `packages/trust-safety/src/labelers-runtime/`
- 856 tests pass across the monorepo; 27 new for Phase 1.66 directly
  exercising the stacking matrix, kind taxonomy, aggregator
  cross-checks, lifecycle illegal transitions, replay equivalence.
- 6 valid + 3 invalid fixtures covering every event kind and every
  aggregator failure mode.
- Exit report: `docs/implementation/phase-1.66-exit-report.md`.
