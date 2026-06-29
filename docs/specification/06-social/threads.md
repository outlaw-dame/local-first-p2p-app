# Threads

- Status: Draft
- Specification series: 6
- Specification version: 0.x
- Scope: threaded conversation and reply graph primitives
- Profiles: Social, Messaging, Offline
- Related:
  - `docs/specification/06-social/collections.md`
  - `docs/specification/06-social/channels.md`
  - `docs/specification/03-data/entity-component-snapshots.md`

## Purpose

This document defines Threads as conversation structures over posts, messages, comments, replies, and related objects.

Threads should support Twitter-like replies, Reddit-like comment trees, forum threads, Channel conversations, and moderation/report discussion without forcing one UI shape.

## Requirements

- A Thread MUST have explicit root or parent reference semantics.
- Reply references MUST be validated before authority-sensitive use.
- Thread ordering and projection rules SHOULD be explicit where interoperability matters.
- Thread records MUST respect Space, Channel, privacy, and membership policy.
- Private Thread payloads MUST remain encrypted across untrusted providers and transports.

## Thread forms

Threads may be projected as:

- flat chronological reply list;
- tree of replies;
- forum topic;
- Channel conversation segment;
- comment hierarchy;
- moderation discussion;
- quote/reply graph;
- inbox conversation.

## Root and reply references

A Thread may reference:

- root object;
- parent object;
- previous message;
- Channel;
- Space;
- Feed Collection;
- Snapshot-pinned object;
- external compatibility URI.

Snapshot-pinned references SHOULD be used where later mutation would change evidence, moderation, quote, or appeal meaning.

## Ordering

Thread projections may order by:

- chronological order;
- parent/child tree order;
- ranking;
- moderation state;
- pinned/manual order;
- local unread state.

The underlying reference graph MUST remain distinguishable from app projection order.

## Validation

Before applying a Thread or reply record, implementations MUST validate:

- signer authority;
- write permission;
- parent/root reference integrity;
- Space/Channel membership where applicable;
- capability scope;
- consistency class;
- replay/idempotency behavior;
- local policy.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD support Thread heads, bounded reply windows, recent replies, and object references before full history.

Large payloads and deep history SHOULD be lazy.

## Security considerations

Implementations MUST guard against:

- forged reply relationships;
- thread hijacking;
- private Thread leakage;
- stale parent references;
- malicious ranking projections;
- unbounded reply graph DoS;
- quote/reference mutation without Snapshot pinning where evidence matters.

## Open questions

- Canonical Thread object shape.
- Whether replies are Entities, signed events, Collection entries, or all three depending on use case.
- Required ordering semantics for Social Profile.
- How Thread projections interact with Feed Candidate Sets.
