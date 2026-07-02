# Phase Exit Report: Phase 1.69 — Content Categories, Labeler Capabilities, Overlap Detection

- Status: Accepted as complete
- Date: 2026-06-02

## Phase scope

Phase 1.69 closes four gaps in the labeler model that surfaced when
asking "how does a subscriber actually configure this stack the way
they configure Bluesky moderation?":

1. **Structured capability declaration on labeler profiles.**
   Without this, the UI cannot tell what a labeler actually does
   without inspecting `labelKey` strings.
2. **Standard content-category registry** matching Bluesky's
   built-in content filters (Adult Content, Violence, Hate, Spam,
   Misleading, etc.) so subscribers configure preferences against
   stable category keys, not labeler-specific `labelKey` strings.
3. **Adult-content master gate** matching Bluesky's child-safety
   default: adult categories force `hide` until the gate is opted in.
4. **Subscription overlap detection helper** so the UI can warn the
   subscriber before they subscribe to two labelers that do
   functionally the same job (e.g. two `classify.spam` labelers).

## Completed work

### `@lfp2p/trust-safety/labelers` — capability declaration

- New `LabelerCapability` shape:
  ```ts
  { capabilityId: string;
    description: string;
    producesLabels: ReadonlyArray<string>;
    mediaTypes?: ReadonlyArray<string>; }
  ```
- Optional `capabilities?: ReadonlyArray<LabelerCapability>` added to
  `SafetyLabelerProfile` (backward-compatible, additive in v1).
- `STANDARD_LABELER_CAPABILITIES` registry of 20 well-known IDs:
  - `detect.twitter-screenshot`, `detect.bluesky-screenshot`,
    `detect.crossplatform-screenshot`, `detect.profanity-en`,
    `detect.profanity-multilang`, `detect.malicious-link`,
    `detect.machine-generated`, `detect.duplicate`
  - `classify.spam`, `classify.toxicity`, `classify.topic`,
    `classify.sentiment`, `classify.adult-content`
  - `scan.media-csam`, `scan.media-violence`, `scan.media-nudity`
  - `attest.domain-ownership`, `attest.organization-affiliation`,
    `attest.account-age`
  - `aggregate.community-list`, `aggregate.multi-labeler`
- `validateLabelerCapability` cross-checks:
  - `capabilityId` matches
    `(detect|classify|scan|attest|aggregate|x).<segment>(.<segment>)*`.
  - `producesLabels` is non-empty and every entry appears in
    `profile.supportedLabels`.
  - `mediaTypes` (when present) match RFC 6838.
- `isStandardCapability` predicate.

### `@lfp2p/trust-safety/content-categories` — new module

- `CONTENT_CATEGORY_NAMESPACE = 'lfp2p.content-category.v1'`.
- 20 standard categories with `key`, `isAdult`, `defaultAction`,
  `description`. Defaults are conservative (spam → hide,
  violence.threat → hide, hate.\* → hide; ambiguous → warn or allow).
- `ADULT_CONTENT_CATEGORY_KEYS` set.
- `decideContentCategoryAction(category, userPreference, gateEnabled)`
  resolver:
  - Adult category + gate off → forces `hide` (cannot be overridden).
  - Adult category + gate on → user preference wins, else default.
  - Non-adult → user preference wins, else default.
- `getContentCategory(key)`, `isContentCategoryKey(key)`.

### `@lfp2p/trust-safety/local-controls` — adult-content gate

- New event kind `safety.adult-content.gate.set` (13th kind).
- Payload: `{ enabled: boolean; gatedAt: string }`.
- Projection field `LocalControlState.adultContentGate?: { enabled, gatedAt }`.
- `apply` records the gate; `revert` clears it.
- `assertLocalControlEnvelopeScope` already enforces the gate cannot
  ride on a public networked scope.

### `@lfp2p/trust-safety/labelers-runtime` — overlap detection

- `overlap.ts` with:
  - `findOverlappingSubscriptions(state, subscriberActorId)` →
    `ReadonlyArray<OverlappingPair>` with `level` of `full`,
    `partial`, `capability-only`, or `label-only`.
  - `detectRedundantSubscription(state, subscriberActorId, candidateLabelerId)` →
    `RedundancyAssessment` for the pre-subscribe UI warning.
- Pure functions. Stable, sorted ordering. Frozen outputs.

### Fixtures

- `fixtures/labelers/valid/profile-with-capabilities.json` —
  cross-platform screenshot detector with two declared capabilities.
- `fixtures/local-controls/valid/adult-content-gate-enabled.json` —
  gate-enable event.
- Both pass the existing `it.each` fixture validators.

### Tests

`packages/trust-safety/src/__tests__/phase-1.69.test.ts` —
27 new tests covering:

- Capability validation: valid profile accepted; rejection of
  `producesLabels` outside `supportedLabels`; rejection of malformed
  `capabilityId`; `x.*` custom namespace accepted; rejection of empty
  `producesLabels`; rejection of malformed `mediaType`;
  `isStandardCapability` registry behaviour.
- Content categories: namespace pinned; `ADULT_CONTENT_CATEGORY_KEYS`
  matches `isAdult`; getter / predicate; Bluesky-style conservative
  defaults pinned (spam=hide, violence.threat=hide,
  adult.sexually-explicit=hide, etc.).
- `decideContentCategoryAction` decision matrix:
  - adult category + gate off ⇒ `hide` regardless of user pref.
  - adult category + gate on ⇒ user pref wins, default fallback.
  - non-adult unaffected by gate.
- Adult-content gate event: apply records; revert clears; non-boolean
  `enabled` rejected.
- Overlap detection:
  - Disjoint capabilities + labels → no overlap.
  - Two `classify.spam` labelers → `full` overlap.
  - Legacy labelers (no capabilities), shared `labelKey` → `label-only`.
  - Shared one capability of many + shared labels → `partial`.
  - Unsubscribed pairs filtered out.
- `detectRedundantSubscription`:
  - Identical capability set → `isRedundant: true` with the
    matching labelerId reported.
  - Disjoint job → `isRedundant: false`, no overlapping label keys.
  - Partial capability overlap → not redundant, overlap reported.
- Bluesky-style scenarios from the user's request:
  - Twitter-screenshot labeler + profanity labeler ⇒ no warning.
  - Second spam labeler ⇒ warning with `classify.spam` flagged.

### Verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 913 passing (884 before + 27 phase-1.69 + 2 fixture-validator pickups)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                                                            | Status | Evidence                                                         |
| ---------------------------------------------------------------------------------------------------- | :----: | ---------------------------------------------------------------- |
| Labeler profile carries structured capabilities (additive, v1-compatible)                            |   ✓    | `SafetyLabelerProfile.capabilities`, `validateLabelerCapability` |
| Standard content-category registry exists and matches Bluesky's built-in filter set                  |   ✓    | `CONTENT_CATEGORIES` (20 entries)                                |
| Adult-content master gate is expressible and overrides user preference for adult categories when off |   ✓    | `safety.adult-content.gate.set`, `decideContentCategoryAction`   |
| Overlap detection between subscribed labelers is available as a pure helper                          |   ✓    | `findOverlappingSubscriptions`, `detectRedundantSubscription`    |
| New fixtures are validated by existing `it.each` validators                                          |   ✓    | 913 tests passing                                                |
| All new behaviours covered by adversarial tests                                                      |   ✓    | `phase-1.69.test.ts` (27 tests)                                  |
| Doctrine doc documents categories, gate, capabilities, and overlap                                   |   ✓    | `docs/protocol/content-categories-doctrine.md`                   |
| Local controls keep scope-leak protection (`TS_PRIVATE_LEAK`)                                        |   ✓    | unchanged `assertLocalControlEnvelopeScope`                      |

## Deferred work

- A labeler-API surface (HTTP / streaming endpoint). Phase 4.
- A community-list discovery / recommendation surface. Phase 5.
- Per-platform screenshot ML implementations (this slice only
  declares the capability IDs).
- Per-actor / per-thread overrides of the adult-content gate.

## Decision

This phase is:

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: All four user-surfaced gaps in the labeler model are
addressed at protocol-and-projection altitude with pure, frozen,
validated, adversarially-tested code. Downstream consumers (PWA
moderation UI, labeler implementations, moderation tools) can build
on the new shapes without further protocol churn.
