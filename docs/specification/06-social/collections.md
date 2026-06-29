# Collections

- Status: Draft
- Specification series: 6
- Specification version: 0.x
- Scope: portable social collections and ordered/unordered object sets
- Profiles: Social, Core, Offline
- Related:
  - `docs/specification/06-social/feeds.md`
  - `docs/specification/03-data/entity-component-snapshots.md`
  - `docs/specification/04-sync/selective-replica-sync.md`

## Purpose

This document defines Collections as portable sets or ordered streams of protocol objects.

Collections provide a shared primitive for lists, bookmarks, saved items, Channel streams, feed collections, moderation queues, media sets, and other app projections.

## Requirements

- Collection ownership MUST be explicit.
- Collection membership changes MUST validate against owner authority and policy.
- Collections MUST declare whether they are ordered, unordered, append-only, mutable, or projection-derived.
- Collections SHOULD support selective sync and partial replication.
- Private Collections MUST avoid leaking membership to unauthorized peers/providers.

## Collection kinds

A future registry may define:

- following collection;
- follower collection;
- Space membership collection;
- Channel membership collection;
- bookmark collection;
- saved collection;
- list collection;
- moderation queue;
- report queue;
- media collection;
- Feed Collection;
- Channel stream;
- thread reply collection.

## Ordering

Collections may be:

- unordered;
- insertion ordered;
- chronological;
- ranked;
- pinned/manual;
- projection-derived;
- checkpointed.

Ordering rules MUST be explicit where interoperability matters.

## Collection membership

Collection entries SHOULD reference objects by stable Object Reference, Entity Reference, Snapshot Reference, or signed record reference.

Snapshot references SHOULD be used where later mutation would undermine meaning, evidence, forwarding, quotes, or moderation state.

## Privacy

Collection names, membership, ordering, and changes may be sensitive.

Private lists, bookmarks, moderation queues, sealed recipients, private Space/Channel membership, and trust/safety collections SHOULD be protected from unnecessary provider or peer exposure.

## Sync behavior

Collections SHOULD support selective sync by:

- owner;
- collection type;
- partition;
- time window;
- cursor/checkpoint;
- maximum item count;
- headers-only mode;
- entry type;
- privacy scope.

## Validation

Before applying a Collection change, implementations MUST validate:

- owner authority;
- signer authority;
- capability scope;
- visibility policy;
- entry reference integrity;
- ordering rule;
- consistency class;
- replay/idempotency behavior.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD support collection heads, cursors, checkpoints, and bounded entry ranges before full history.

Large referenced payloads SHOULD be lazy.

## Security considerations

Implementations MUST guard against:

- unauthorized membership changes;
- private collection leakage;
- malicious ordering manipulation;
- stale collection heads;
- treating derived projections as source-of-truth collections;
- entry reference substitution;
- unbounded collection DoS.

## Open questions

- Canonical Collection object shape.
- Initial collection type registry.
- Relationship between Collection and Feed Collection naming.
- Required ordering models for Social Profile.
