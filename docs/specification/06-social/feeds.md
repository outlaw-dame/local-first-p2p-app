# Feeds

- Status: Draft
- Specification series: 6
- Specification version: 0.x
- Scope: first-class feed collections, generators, projections, subscriptions, and candidate sets
- Profiles: Social, Availability, Offline
- Related:
  - `docs/specification/06-social/collections.md`
  - `docs/specification/06-social/channels.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines feeds as first-class protocol primitives.

Feeds MUST NOT be only app UI conventions. The protocol should support apps that rely on feeds while preserving local-first and P2P survivability.

## Feed doctrine

```txt
Feed ownership and subscriptions are protocol state.
Feed generation may be infrastructure-assisted.
Feed projection is app presentation.
```

If feed infrastructure disappears, users should retain local chronological feeds, Channel feeds, saved feed definitions, subscribed collections, and cached candidate sets where policy allows.

## Feed layers

### Feed Collection

A signed, portable definition of a set or stream of feed-relevant objects.

### Feed Generator

A local algorithm, rule, function, or provider service that selects candidates.

### Feed Projection

Application-specific presentation of feed candidates.

### Feed Subscription

A user-owned or Space-owned record declaring interest in a Feed Collection or generator.

### Feed Candidate Set

A bounded result set from a generator or local query, with provenance and checkpoint information where applicable.

## Requirements

- Feed ownership MUST be explicit.
- Feed subscriptions SHOULD be portable user or Space state.
- Feed generators MUST NOT become canonical social state merely by including or excluding records.
- Feed candidate sets MUST be treated as candidates unless a later specification defines stronger meaning.
- Feed projections MUST NOT mutate underlying protocol semantics.
- Feed infrastructure MUST degrade to local or cached behavior when unavailable.

## Feed types

A future registry may define:

- following feed;
- Space feed;
- Channel feed;
- topic/hashtag feed;
- list feed;
- saved/bookmarked feed;
- moderation-review feed;
- media feed;
- local-nearby feed;
- search-backed feed;
- semantic feed.

## Generator modes

Feed generation may be:

- local chronological;
- local weighted;
- user-authored rule-based;
- Space-operated;
- friend-operated;
- super-peer-assisted;
- public-index-assisted;
- search-backed;
- semantic/AI-assisted;
- offline cached.

Optional infrastructure can improve ranking and discovery. It MUST NOT own user subscriptions or canonical object validity.

## Candidate set behavior

A Feed Candidate Set SHOULD declare:

- generator identity;
- feed/collection reference;
- cursor or checkpoint;
- candidate object references;
- ranking metadata where safe;
- generation time or range;
- filtering policy;
- signature/proof where applicable;
- expiry or freshness hint.

Candidate sets SHOULD be bounded and cacheable where privacy policy permits.

## Degraded behavior

When feed infrastructure is unavailable, implementations SHOULD fall back to:

- local chronological following feed;
- local Space/Channel chronological feeds;
- cached candidate sets;
- subscribed Feed Collections;
- saved/bookmarked feeds;
- locally evaluable rules;
- low-bandwidth Channel heads.

## Privacy

Feeds can leak interests, membership, social graph, private Spaces, private Channels, and moderation preferences.

Feed subscriptions and generator queries SHOULD be private unless explicitly shared.

## Validation

Before using feed records as protocol state, implementations MUST validate:

- owner authority;
- subscription signer authority;
- generator capability where applicable;
- referenced object validity before display/application where needed;
- privacy policy;
- replay/idempotency behavior;
- local controls and moderation filters.

## Security considerations

Implementations MUST guard against:

- malicious feed generators;
- ranking manipulation;
- feed inclusion treated as endorsement;
- private membership inference;
- stale candidate sets presented as fresh;
- unsafe external references;
- bypassing local moderation controls;
- generator infrastructure becoming app-wide authority.

## Open questions

- Canonical Feed Collection object shape.
- Candidate set format.
- Whether custom feed generators are Social Profile core or extension.
- How much ranking provenance is required.
