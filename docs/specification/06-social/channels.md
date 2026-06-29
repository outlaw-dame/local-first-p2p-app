# Channels

- Status: Draft
- Specification series: 6
- Specification version: 0.x
- Scope: scoped streams and contexts inside Spaces
- Profiles: Social, Messaging, Offline
- Related:
  - `docs/specification/06-social/spaces.md`
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/04-sync/selective-replica-sync.md`

## Purpose

This document defines Channels as scoped streams or contexts inside a Space.

Channels support Discord-like text channels, announcements, private rooms, moderation channels, forum-style threads, voice/video signaling contexts, and other application projections.

## Requirements

- A Channel MUST belong to a Space or another explicitly defined container.
- Channel authority MUST be derived from Space authority or a valid delegated capability.
- Channel membership and visibility MUST be explicit where privacy matters.
- A Channel SHOULD define mailbox-compatible delivery semantics.
- Private Channel payloads MUST remain encrypted across untrusted providers and transports.
- A Channel MUST NOT rely on one hosted provider as latest-state authority.

## Channel types

A future registry may define Channel types such as:

- text;
- announcement;
- private;
- moderation;
- forum/threaded;
- voice/video signaling;
- media;
- read-only;
- ephemeral;
- local-nearby.

These names are Draft until registered.

## Channel state

A Channel may include or reference:

- Channel identity;
- parent Space;
- visibility policy;
- membership policy;
- write policy;
- moderation policy;
- Feed Collection;
- mailbox route;
- retention policy;
- recent heads/checkpoints;
- optional infrastructure descriptors.

## Channel feeds

A Channel SHOULD have an associated Feed Collection or chronological stream definition so apps can present unread views, timelines, forum lists, or media views consistently.

Feed generation may be infrastructure-assisted. Channel ownership and membership MUST NOT depend on feed infrastructure.

## Channel delivery

Channel delivery may use:

- local append/projection;
- mailbox routes;
- Space mailbox routes;
- direct P2P sync;
- bridge/relay support;
- super-peer availability;
- Portable Sync Drops.

Delivery success MUST NOT be treated as durable acceptance until validation and apply occur.

## Validation

Before applying a Channel record, implementations MUST validate:

- parent Space authority;
- Channel authority;
- signer authority;
- membership/write permission;
- capability scope;
- encryption/key epoch where applicable;
- consistency class;
- replay/idempotency behavior;
- local policy.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD prioritize Channel identity, membership checkpoints, recent heads, mailbox headers, recent small records, and object references.

Large payloads, old history, generated feed state, and media SHOULD be lazy.

## Security considerations

Implementations MUST guard against:

- unauthorized Channel creation/deletion;
- stale membership state;
- private Channel leakage;
- provider-controlled latest state;
- malicious feed projections;
- replayed messages;
- unauthorized writer capabilities;
- voice/video signaling metadata leakage.

## Open questions

- Canonical Channel object shape.
- Initial Channel type registry.
- Relationship between Channel heads and Feed Collections.
- Retention defaults for private versus public Channels.
