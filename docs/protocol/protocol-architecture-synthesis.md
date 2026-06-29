# Protocol Architecture Synthesis

- Status: Draft
- Date: 2026-06-29
- Scope: local-first hybrid P2P protocol architecture doctrine
- Related docs:
  - `docs/protocol/p2p-runtime-adapter-boundaries.md`
  - `docs/protocol/infrastructure-capability-surfaces.md`
  - `docs/protocol/operation-consistency-classes.md`
  - `docs/protocol/mls-group-keying.md`
  - `docs/implementation/roadmap-ordering.md`

## Purpose

This document consolidates the architecture decisions surfaced during the super-peer, mailbox, user-data, Willow/Leaf, FROST, sync-engine, and feed-design review.

It is intentionally additive. It does not replace the existing bridge, relay, super-peer, MLS, sync-client, content-addressing, or trust-safety docs. It defines the higher-level doctrine those pieces must continue to obey as the protocol expands into user data roots, spaces, channels, mailboxes, feed primitives, selective sync, and optional infrastructure.

## Core doctrine

Infrastructure exists to improve availability, performance, discoverability, moderation operations, developer experience, and user experience. Infrastructure does not establish protocol authority or protocol validity.

The protocol is hybrid, but remains P2P-first in its survivability model:

- hosted services are first-class optimizations, not first-class dependencies;
- bridges, relays, super-peers, public indexes, hosted mailboxes, search services, app views, CDNs, and storage providers may improve the experience;
- if those services disappear, are blocked, or become unavailable, users should still be able to identify each other, communicate, exchange portable data, and synchronize over direct or improvised peer paths;
- degraded operation is acceptable; evaporation of identity, data, or communication is not.

The user experience may feel as polished as large hosted social systems when infrastructure is available. The protocol must still retain useful function when only user devices and local/nearby transports remain.

## Layer model

```txt
Application projection
  ↓
Social primitives
  ↓
Authority layer
  ↓
User Data Root / personal replica layer
  ↓
Availability layer
  ↓
Transport/runtime adapters
```

### Application projection

Application projections are UI/product interpretations of shared protocol primitives.

Examples:

- Discord-like: spaces, channels, messages, voice/video rooms;
- Reddit-like: communities, boards, posts, comments, ranked feeds;
- Twitter-like: actor timelines, posts, reposts, replies, quote posts;
- Facebook-like: profiles, friends, groups, pages, events, mixed feeds;
- forum-like: categories, threads, replies;
- chat-like: DMs, group chats, unread streams.

Applications may innovate freely, but should map product concepts onto common protocol primitives where interoperability matters.

### Social primitives

The protocol should be opinionated enough to avoid ActivityPub-style ambiguity while not forcing one ATProto-style app shape.

Canonical primitives should include:

- identity;
- devices;
- capabilities;
- User Data Root;
- data partitions;
- entities/components/snapshots/links;
- spaces;
- channels;
- threads;
- posts/messages/comments;
- reactions;
- roles and membership;
- mailbox delivery;
- inbox/outbox semantics;
- reports/appeals;
- moderation labels and local controls;
- media/object references;
- feed collections;
- feed generators;
- feed projections;
- presence/rich activity;
- receipts/acks;
- portable sync drops.

Doctrine:

```txt
The protocol defines interoperable social primitives; apps define projections.
```

### Authority layer

Authority is defined by protocol-controlled cryptographic and deterministic state:

- controller identity;
- device identity and authorization;
- identity-control events and projections;
- capability grants/revocations;
- signed event envelopes;
- content/object references;
- private payload encryption envelopes;
- MLS group-control state;
- trust and safety policy;
- consistency-class-specific apply rules.

No runtime adapter, mailbox provider, bridge, relay, super-peer, Hypercore feed, IPFS provider, public index, or app server can override authority-layer validation.

### User Data Root / personal replica layer

A user has one cryptographic identity root and may have many authorized device replicas.

The User Data Root is the logical, portable user-owned data space. It is not a single physical server, mailbox, repository, pod, or feed. It may be replicated across:

- the user's phone;
- the user's laptop/desktop/tablet;
- a home server;
- a personal VPS;
- a friend-operated availability peer;
- a space-operated provider;
- a bridge/mailbox/super-peer provider;
- a Hypercore/Corestore-backed store;
- an IPFS-compatible provider;
- portable encrypted sync drops.

None of those storage locations is automatically canonical. They are replicas, caches, delivery queues, availability helpers, or export/import media.

A User Data Root should contain or reference:

- identity/control log;
- device registry;
- capability grants;
- personal event log;
- local/private records;
- contact data and petnames;
- trust/safety preferences;
- mailbox inbox/outbox state;
- sync checkpoints;
- content-addressed object index;
- space/channel memberships;
- feed subscriptions and feed definitions;
- portable export/import bundles.

Doctrine:

```txt
Mailbox is delivery. User Data Root is durable user-owned state.
```

### Availability layer

Availability services improve reachability, catch-up, latency, storage durability, searchability, and feed quality.

Examples:

- bridges;
- relays;
- mailboxes;
- super-peers;
- public indexes;
- search services;
- feed generators;
- CDNs;
- storage providers;
- space-operated services;
- organization-operated services.

Availability services may cache, index, relay, store encrypted delivery records, publish storage hints, provide feed candidates, or assist discovery. They must not become latest-state, identity, membership, moderation, trust, or plaintext-message authorities.

### Transport/runtime adapters

Transports move bytes. They do not define authority.

Examples:

- WebRTC;
- QUIC/TCP;
- Holepunch/HyperDHT;
- Hypercore/Corestore;
- mDNS/LSD/local discovery;
- Bluetooth/BLE;
- Wi-Fi Direct/local hotspot;
- USB/file export/import;
- QR/batch transfer;
- Tor/I2P or other optional privacy transports;
- HTTP bridge transport;
- WebSocket/SSE/long-poll transports.

All transports must remain subordinate to protocol validation.

## Identity and multi-device consistency

Portable identity should be implemented as:

```txt
controller identity
  ↓
authorized devices
  ↓
per-device local replicas
  ↓
signed events / encrypted records
  ↓
selective sync
  ↓
deterministic projection
  ↓
converged user state
```

A device may write only within the authority granted to it. Device authorization, revocation, rotation, and high-risk recovery are authority-layer events, not mailbox/provider decisions.

A mailbox can help deliver updates to offline devices. It must not be the user's identity or data root.

## User Data Root and partitioning

The protocol should define a logical User Data Root with partitioned data spaces inspired by Willow namespaces/subspaces/paths and Leaf's entity/component model.

Suggested top-level partitions:

```txt
/identity/
/devices/
/capabilities/
/personal/
/contacts/
/preferences/
/mailbox/inbox/
/mailbox/outbox/
/spaces/{spaceId}/
/spaces/{spaceId}/channels/{channelId}/
/feeds/
/media/
/trust-safety/
/sync/checkpoints/
```

Each partition should declare:

- privacy scope;
- consistency class;
- allowed writers;
- allowed readers;
- replication policy;
- retention policy;
- payload eagerness;
- mailbox eligibility;
- portable-drop eligibility;
- infrastructure-surface eligibility.

Authority-sensitive records remain signed-event projections governed by consistency classes. Generic path overwrite or last-writer-wins storage must not be used for authority, lifecycle, key-epoch, moderation, report/appeal, or revocation state.

## Willow/Leaf-inspired data model guidance

Willow is useful as inspiration for:

- partitioned data spaces;
- selective sync;
- low-bandwidth sync;
- drop/export format;
- capability-bounded read/write access;
- infrastructure-optional survivability.

Leaf is useful as inspiration for:

- entity/component modeling;
- schema and semantic specification separation;
- content-addressed components;
- entity snapshots;
- snapshot-pinned links;
- per-component encryption;
- safe path conventions that avoid accidental prefix-pruning behavior.

The protocol should not adopt Willow or Leaf wholesale. Their flexible storage semantics are useful for data organization and app-level objects, but not for protocol authority.

Recommended primitives:

- `EntityRef`;
- `ComponentRef`;
- `EntitySnapshotRef`;
- `LinkRef`;
- `SchemaRef`;
- encrypted component descriptors;
- snapshot-pinned references;
- safe path rules.

Use cases:

- profiles with mixed public/private components;
- posts/messages with content-addressed attachments;
- quote posts and forwards with snapshot-pinned references;
- moderation evidence preserved against later mutation/deletion;
- feed items that reference exact object snapshots;
- portable user data exports.

## Mailbox doctrine summary

Mailbox is a first-class protocol component, but it is delivery infrastructure, not durable user truth.

A mailbox may be implemented by:

- a local device;
- a friend device;
- a bridge;
- a super-peer;
- a space operator;
- a personal VPS;
- a home server;
- an organization;
- a hosted cloud provider;
- a Hypercore-backed service;
- a portable sync drop import path.

The mailbox protocol should define:

- inbox/outbox state machines;
- delivery envelopes;
- visible recipients;
- sealed/BCC-like recipients;
- reply/forward semantics;
- per-device/per-recipient ACKs;
- receipts;
- expiry;
- retry;
- garbage collection;
- mailbox provider admission;
- mailbox retention;
- Merkle batch/checkpoint integrity;
- no-plaintext-provider rule;
- delivery-is-not-replication-success rule.

A Space should always define mailbox-compatible delivery semantics. A Space should not require dedicated mailbox infrastructure to exist.

## Spaces and channels

A Space is a scoped social container with identity, membership, roles, capabilities, policy, data partitions, and optional infrastructure descriptors.

A Channel is a scoped stream/context inside a Space.

```txt
Space
  ├── identity/control records
  ├── roles/capabilities
  ├── membership
  ├── policy
  ├── channels
  │    ├── text
  │    ├── announcement/broadcast
  │    ├── private
  │    ├── voice/video signaling context
  │    └── moderation/admin
  └── optional infrastructure descriptors
       ├── mailbox
       ├── relay
       ├── super-peer availability
       ├── media cache
       ├── search/index
       └── feed generator
```

A Space can be infrastructure-free by default. Users should be able to create spaces/channels without running servers.

A Space can also publish optional signed infrastructure descriptors when a community wants more control, availability, retention, search, moderation workflows, or feed generation.

Space infrastructure is similar in motivation to Nostr relays but must remain narrower: it is a capability-bound provider, not the source of social truth.

## Feeds as first-class primitives

Feeds should be protocol-level primitives, not only app UI conventions.

The protocol should define three layers:

```txt
Feed Collection
Feed Generator
Feed Projection
```

### Feed Collection

A signed, portable collection definition.

Examples:

- following feed;
- space feed;
- channel feed;
- topic/hashtag feed;
- list feed;
- saved/bookmarked feed;
- moderation-review feed;
- media feed;
- local-nearby feed.

### Feed Generator

A rule, service, function, or local algorithm that selects candidate objects.

Examples:

- local chronological generator;
- local weighted generator;
- space-operated generator;
- friend-operated generator;
- super-peer-assisted generator;
- public-index generator;
- semantic/AI generator.

### Feed Projection

The app-specific presentation of feed candidates.

Examples:

- Twitter-like timeline;
- Reddit-like ranked community feed;
- Facebook-like mixed social feed;
- Discord-like channel unread feed;
- forum-like thread list;
- media-first feed;
- RSS-like chronological feed.

Doctrine:

```txt
Feed generation may depend on infrastructure. Feed ownership and feed subscriptions must not.
```

If feed services disappear, users should still retain local following feeds, space/channel chronological feeds, saved feeds, subscribed collection definitions, and portable feed generator configs.

## Sync engine direction

The current repository implements checkpointed signed-event bridge sync via `@lfp2p/sync-client`.

Target direction:

```txt
Selective Replica Sync Engine
  ├── local store adapter
  ├── event log adapter
  ├── User Data Root partition adapter
  ├── mailbox adapter
  ├── bridge adapter
  ├── WebRTC DataChannel adapter
  ├── Hypercore/Corestore adapter
  ├── portable sync drop adapter
  ├── Bluetooth/local-nearby adapter
  └── super-peer availability adapter
```

The sync engine should support:

- checkpointed signed-event sync;
- identity/device/capability projection sync;
- partition-scoped sync interests;
- mailbox fetch/catch-up;
- feed subscription sync;
- space/channel sync;
- lazy payload fetch;
- Merkle checkpoint/batch integrity;
- low-bandwidth headers-first mode;
- portable encrypted sync drops;
- direct P2P and infrastructure-assisted modes.

It should not become a transport-specific dependency. Runtime SDKs belong in runtime adapter packages or applications.

## Low-bandwidth and degraded-infrastructure profile

The protocol should support a low-bandwidth profile suitable for Bluetooth, unstable networks, censored networks, or improvised local transfer.

Low-bandwidth mode should prefer:

- small signed headers/control events first;
- identity/contact proofs;
- device/capability state;
- membership checkpoints;
- recent channel heads;
- small text events;
- mailbox receipts and ACKs;
- object refs and content digests;
- optional tiny previews.

Low-bandwidth mode should defer:

- large media;
- thumbnails unless explicitly requested;
- embeddings;
- search indexes;
- long history windows;
- nonessential analytics/telemetry;
- payloads above negotiated caps.

Portable encrypted sync drops should allow users to move bounded data over USB, file export/import, QR batches, Bluetooth, local Wi-Fi, torrents, or other available channels.

## Merkle/hash structure use

Merkle structures are valuable for integrity and reconciliation but should not become the core user repository authority.

Allowed uses:

- mailbox batch roots;
- delivery inclusion proofs;
- receipt checkpoints;
- bridge/super-peer audit log compaction;
- portable export/drop integrity;
- large attachment chunk verification;
- sync-set comparison;
- content-addressed bundle manifests.

Forbidden uses:

- global latest-state authority;
- replacement for signed-event validation;
- replacement for capability checks;
- forced ATProto-style personal repo model;
- treating byte availability as authorization.

## FROST / threshold authority direction

FROST-style threshold signatures are relevant for high-risk authority actions, not ordinary messages.

Good uses:

- multi-device account recovery;
- controller key rotation;
- emergency recovery;
- space governance keys;
- moderator council decisions;
- organization/community admin actions;
- high-value capability grants;
- shared infrastructure operator authority.

Bad default uses:

- every post;
- every chat message;
- every mailbox envelope;
- every normal local event.

Threshold authority should be introduced by ADR before implementation. The ADR should define:

- allowed authority events;
- forbidden ordinary-event usage;
- threshold policies;
- device-share storage;
- recovery UX;
- lost-device behavior;
- stolen-device behavior;
- dealer vs DKG decision;
- audit and rollback boundaries.

## Non-goals

This doctrine does not require the protocol to:

- be serverless-only;
- reject hosted infrastructure;
- copy ATProto repositories;
- copy Solid Pods;
- copy ActivityPub inbox/outbox semantics exactly;
- copy Willow/Leaf wholesale;
- require every app to expose every primitive;
- require every user to run infrastructure.

The goal is survivable, portable, efficient, scalable, affordable, developer-friendly social infrastructure with P2P continuity when optional infrastructure degrades.

## Decision summary

```txt
identity-rooted
  + event-sourced where authority matters
  + partitioned where sync matters
  + entity/snapshot-based where portable data matters
  + content-addressed where payload integrity matters
  + mailbox-assisted where delivery matters
  + threshold-secured where recovery/governance matters
  + infrastructure-optional where resilience matters
```
