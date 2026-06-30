# Feed Runtime Implementation Plan

- Status: Draft
- Date: 2026-06-30
- Scope: implementation plan for first-class feed runtime after Series 6 feed/collection specs, content-addressing promotion, sync promotion, availability promotion, and Trust & Safety promotion
- Related specifications:
  - `docs/specification/06-social/feeds.md`
  - `docs/specification/06-social/collections.md`
  - `docs/specification/03-data/object-references.md`
  - `docs/specification/04-sync/selective-replica-sync.md`
  - `docs/specification/07-availability/`
- Related promotion docs:
  - `docs/implementation/content-addressing-spec-promotion.md`
  - `docs/implementation/sync-client-spec-promotion.md`
  - `docs/implementation/trust-safety-spec-promotion.md`
  - `docs/implementation/availability-surfaces-spec-promotion.md`

## Purpose

Feeds are first-class protocol objects, not only UI timelines or provider-generated lists.

This plan defines the first runtime slice for feed collections, feed subscriptions, candidate sets, local generators, and provider-assisted generators without making any feed infrastructure mandatory authority.

## Non-negotiable boundaries

- Feed ownership and subscription state are user-owned protocol state.
- Feed generation may be infrastructure-assisted, but feed ownership must not depend on infrastructure.
- Feed candidates are not automatic display consent.
- Feed ranking is not moderation enforcement.
- Feed provider output must be locally filtered by visibility, local controls, labels, and policy.
- Feed candidate objects should use Object References or Snapshot References where exactness matters.
- If infrastructure disappears, local chronological and saved feed definitions must remain usable.

## Runtime primitives

### `FeedCollection`

Portable collection definition.

Minimum fields:

- `collectionId`;
- `ownerId`;
- `collectionType`;
- `visibility`;
- `ordering`;
- `membershipPolicy`;
- `createdAt`;
- `updatedAt`;
- `version`.

### `FeedSubscription`

User-owned subscription record.

Minimum fields:

- `subscriptionId`;
- `subscriberId`;
- `feedRef`;
- `createdAt`;
- `visibility`;
- `localDisplayPrefs`;
- `syncPolicy`.

### `FeedGeneratorDescriptor`

Describes how candidates are generated.

Initial modes:

- local chronological;
- local filtered;
- collection-backed;
- Space/Channel-backed;
- provider-assisted;
- search-backed;
- future semantic/AI-assisted.

### `FeedCandidateSet`

Bounded candidate output with provenance.

Minimum fields:

- `candidateSetId`;
- `generatorRef`;
- `scope`;
- `generatedAt`;
- `cursor`;
- `candidates`;
- `provenance`;
- `policyHints`.

### `FeedCursor`

Resume/pagination marker scoped to a generator, collection, or provider.

It must not be treated as global latest state.

## Implementation phases

### Phase FD-1 — Types and validators

Add feed runtime types and validators:

- Feed Collection;
- Feed Subscription;
- Feed Generator Descriptor;
- Feed Candidate Set;
- Feed Cursor;
- feed reference types.

Tests:

- malformed feed refs rejected;
- candidate with missing object reference rejected;
- provider cursor scoped to provider/generator;
- subscription does not grant access to private content.

### Phase FD-2 — Local chronological generator

Implement the first local generator over validated local records:

- following/local known records;
- Space/Channel records where available;
- saved/bookmarked collection entries;
- local chronological ordering;
- visibility and local-control filtering.

Tests:

- blocked/muted sources filtered locally;
- private records excluded without authorization;
- ordering deterministic across replay;
- local generator works without provider availability.

### Phase FD-3 — Collection-backed feeds

Implement collection-backed feed generation:

- list feed;
- saved/bookmarked feed;
- moderation-review feed where applicable;
- Channel feed head projection;
- cursor/replay behavior.

Tests:

- collection membership changes update feed deterministically;
- private collection membership does not leak through public feed metadata;
- duplicate object references are handled consistently;
- Snapshot Reference pins exact state where required.

### Phase FD-4 — Provider-assisted generator adapter

Add provider-assisted feed adapter without making provider output authoritative:

- provider descriptor reference;
- request scope;
- candidate-set validation;
- local post-filtering;
- provider cursor scoping;
- degraded local fallback.

Tests:

- provider candidate output is filtered locally;
- provider cursor cannot override local checkpoint state;
- provider candidate does not grant access;
- provider unavailable falls back to local feed.

### Phase FD-5 — Sync integration

Expose feed state to Selective Replica Sync:

- Feed Collection Sync Interest;
- Feed Subscription Sync Interest;
- candidate-set cache policy;
- cursor/checkpoint boundaries;
- low-bandwidth feed heads before full history.

Tests:

- feed subscription sync is idempotent;
- candidate-set cache expiry does not delete feed definition;
- Sync Interest does not grant private collection access;
- low-bandwidth mode syncs feed definitions before candidate payloads.

### Phase FD-6 — Trust & Safety integration

Integrate safety/curation rules:

- local controls;
- labels;
- curation/reach decisions;
- advisory reputation hints;
- report/moderation review feeds where applicable.

Tests:

- local controls outrank provider candidate ranking;
- labels are signals, not universal truth;
- curation hiding does not delete records;
- moderation-review feed uses Object References for subjects/evidence.

## Exit criteria

Feed runtime is ready for product/UI expansion when:

- feed runtime types exist;
- local chronological generator works offline;
- collection-backed generator works;
- provider-assisted generator is locally filtered;
- feed subscriptions are user-owned and syncable;
- candidate sets use Object References / Snapshot References;
- Trust & Safety filtering is applied after candidate generation and before display;
- degraded local-first behavior is tested.

## Follow-up work

After this plan lands, the next implementation docs should be:

1. Space/Channel runtime implementation plan;
2. feed provider descriptor conformance plan;
3. feed UI integration plan;
4. semantic/AI-assisted feed generator plan.
