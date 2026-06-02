# Content Categories Doctrine

- Status: Draft
- Date: 2026-06-02
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related protocol docs:
  - `docs/protocol/labeler-runtime-doctrine.md`
  - `docs/protocol/local-controls-portability.md`
- Related implementation docs:
  - `docs/implementation/phase-1.66-exit-report.md`
  - `docs/implementation/phase-1.69-exit-report.md`
- Packages:
  - `@lfp2p/trust-safety/content-categories`
  - `@lfp2p/trust-safety/labelers-runtime`
  - `@lfp2p/trust-safety/local-controls`

## Goal

Make the labeler ecosystem usable by everyday subscribers — not just by
moderation hobbyists who can read raw `labelKey` strings. We do this
the way Bluesky does, with three additions:

1. A **fixed registry of content categories** (`lfp2p.content-category.v1`)
   that every well-behaved labeler emits labels under when applicable.
2. A **structured capability declaration** on every
   `SafetyLabelerProfile` so the UI knows what each labeler does
   without having to infer it from `labelKey` strings.
3. An **adult-content master gate** that overrides per-category
   preferences for adult categories until the subscriber explicitly
   opts in — matching Bluesky's child-safety default.

A user subscribes to one or more labelers. Each labeler declares its
**capabilities** (what jobs it can do, e.g. `classify.spam`,
`detect.twitter-screenshot`). The UI uses capability overlap to warn
the subscriber before they redundantly subscribe to two labelers that
do the same thing. Their per-category preferences then apply across
all subscribed labelers uniformly.

## How Bluesky's model maps to ours

| Bluesky concept | Our equivalent | Notes |
|---|---|---|
| Built-in content filters (Adult Content, Violence, Hate, etc.) | `CONTENT_CATEGORIES` registry | 20 categories under namespace `lfp2p.content-category.v1`. |
| Per-category Show / Warn / Hide preference | `safety.label.preference.set` with category key under `lfp2p.content-category.v1` | Same 3-action UI; uses our existing 7-action `LabelPreferenceAction` space (`allow` ≡ Show). |
| Adult-content master gate | `safety.adult-content.gate.set` | New Phase 1.69 local-control kind. |
| Default-to-hide for adult content on new accounts | `decideContentCategoryAction` | Adult categories force `hide` when the gate is `false` or undefined, regardless of user preference. |
| Labeler service declares which categories it labels | `LabelerCapability.producesLabels` | Cross-validated as a subset of profile.supportedLabels. |
| User subscribes to one or more labelers | `safety.labeler.subscribed` (envelope scope: device-local / account-local) | Inherited from Phase 1.66, private by default. |

## The standard categories

| Category key                       | Adult? | Default | Description |
|------------------------------------|:------:|:-------:|-------------|
| `adult.sexually-explicit`          | ✓      | `hide`  | Pornographic or sexually explicit content. |
| `adult.sexually-suggestive`        | ✓      | `warn`  | Suggestive but not explicit. |
| `adult.nudity-artistic`            | ✓      | `warn`  | Artistic or non-sexual nudity. |
| `violence.gore`                    |        | `warn`  | Graphic depictions of injury or death. |
| `violence.graphic`                 |        | `warn`  | Other graphically violent content. |
| `violence.threat`                  |        | `hide`  | Credible threats of violence. |
| `self-harm`                        |        | `warn`  | Self-harm imagery or discussion. |
| `eating-disorder`                  |        | `warn`  | Pro-eating-disorder content. |
| `hate.iconography`                 |        | `hide`  | Hate-group iconography. |
| `hate.slur`                        |        | `hide`  | Slurs targeting protected groups. |
| `intolerance.targeted`             |        | `warn`  | Targeted intolerance toward a person or group. |
| `spam`                             |        | `hide`  | Bulk unsolicited content. |
| `impersonation`                    |        | `hide`  | Impersonating another person or organization. |
| `misleading-claim`                 |        | `warn`  | Factually misleading claim. |
| `misleading-context`               |        | `warn`  | Manipulated or out-of-context media. |
| `bot-account`                      |        | `warn`  | Automated / non-human account. |
| `political`                        |        | `allow` | Political content. |
| `religion`                         |        | `allow` | Religious content. |
| `gambling`                         |        | `warn`  | Gambling-related content. |
| `screenshot.crossplatform`         |        | `allow` | A screenshot of content from another platform (e.g. X/Bluesky). |

Defaults are intentionally conservative: anything that has historically
caused user harm (spam, impersonation, violence-threat, hate) defaults
to `hide`; ambiguous "depends on the viewer" categories (political,
religion, screenshots) default to `allow`.

## The adult-content master gate

`safety.adult-content.gate.set` carries a single boolean `enabled` and
a `gatedAt` timestamp. It is projected onto
`LocalControlState.adultContentGate`.

Semantics, applied by `decideContentCategoryAction`:

- If `category.isAdult === true` AND the gate is `false` (or absent):
  the effective action is **forced to `hide`**, regardless of any
  per-category preference the user may have stored. This is the
  Bluesky-style child-safety default for fresh accounts.
- If `category.isAdult === true` AND the gate is `true`: the user's
  per-category preference applies, falling back to
  `category.defaultAction` when no preference is set.
- If `category.isAdult === false`: the gate has no effect.

The gate is **never** carried in `safety.preferences.snapshot`'s
public-facing surface — it remains a `device-local` /
`account-local` event like every other local control.

## Labeler capability declaration

`SafetyLabelerProfile.capabilities` (optional, additive in v1) is an
array of `LabelerCapability` entries. Each entry has:

- `capabilityId` matching the pattern
  `(detect|classify|scan|attest|aggregate|x).<segment>(.<segment>)*`.
- `description` — human-readable.
- `producesLabels` — non-empty list of `labelKey`s, every one of
  which MUST appear in the enclosing profile's `supportedLabels`.
  (Cross-checked at validation time.)
- `mediaTypes` (optional) — RFC-6838 media types this capability
  applies to. Useful for image-only or text-only capabilities.

The capability ID namespaces:

- `detect.*` — yes/no detection (e.g. `detect.twitter-screenshot`,
  `detect.profanity-en`, `detect.malicious-link`).
- `classify.*` — ML classifier producing a label + confidence
  (e.g. `classify.spam`, `classify.toxicity`, `classify.adult-content`).
- `scan.*` — heavier media analysis (e.g. `scan.media-csam`,
  `scan.media-violence`).
- `attest.*` — proof-of-something (e.g. `attest.domain-ownership`,
  `attest.account-age`).
- `aggregate.*` — re-publishing labels from upstream labelers
  (e.g. `aggregate.community-list`, `aggregate.multi-labeler`).
- `x.*` — custom / community-defined extensions. The runtime allows
  these but `isStandardCapability` returns `false`.

`STANDARD_LABELER_CAPABILITIES` is the registry of well-known IDs.

## Subscription overlap detection

`@lfp2p/trust-safety/labelers-runtime` exports two pure helpers:

- `findOverlappingSubscriptions(state, subscriberActorId)` returns
  every pair of *active* subscriptions whose capabilities or
  `supportedLabels` overlap, with a `level` of:
  - `full` — one side's declared capabilities is a subset of (or equal
    to) the other side's. Strong duplicate signal.
  - `partial` — both shared capabilities AND shared label keys but
    neither side is a subset.
  - `capability-only` — shared capabilities, no shared label keys.
  - `label-only` — no declared capabilities; only shared label keys
    (fallback signal for legacy labelers).
- `detectRedundantSubscription(state, subscriberActorId, candidateLabelerId)`
  is the "should I subscribe to this candidate" check, designed for a
  UI's pre-subscribe warning. `isRedundant` is true when capabilities
  overlap and one side's capabilities are a subset of the other's.

Behavioural examples (verified by `phase-1.69.test.ts`):

- Subscribing to `detect.twitter-screenshot` labeler + a
  `detect.profanity-en` labeler ⇒ no warning. Different jobs.
- Subscribing to a second `classify.spam` labeler when one is already
  active ⇒ `isRedundant: true`, with the existing labeler reported.

## Wire format

- Capabilities ride inside the existing
  `SafetyLabelerProfile` shape (`profile.capabilities`); no new
  envelope. The `lfp2p.safety-labeler-profile.v1` version is unchanged
  because the field is additive and optional.
- The adult-content gate ships as
  `kind: 'safety.adult-content.gate.set'` under the existing
  `lfp2p.local-control-event.v1` envelope.

## Privacy stance

- The categories themselves are public protocol constants.
- The user's per-category preferences and the adult-content gate are
  **local controls** — `device-local` or `account-local` scope only.
  Public networking-layer scopes (`community-local`, `bridge-local`,
  `relay-local`, `super-peer-local`, `index-local`,
  `app-surface-local`, `network-advisory`) are structurally rejected
  by `assertLocalControlEnvelopeScope` with `TS_PRIVATE_LEAK`.

## Out of scope for Phase 1.69 (deferred)

- A labeler-API surface (HTTP / streaming endpoint). Phase 4 territory.
- A community-list discovery / recommendation surface for labelers.
  Phase 5 territory.
- Per-platform screenshot detection ML models. Belongs to a separate
  labeler implementation, not to this protocol slice.
- Per-actor / per-thread overrides of the adult-content gate. We
  keep the gate global to match Bluesky; per-target overrides remain
  expressible via `safety.account.muted` / per-thread mutes.
