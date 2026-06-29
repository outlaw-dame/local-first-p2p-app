# Glossary

- Status: Draft
- Specification series: 0
- Scope: initial protocol terminology

## Purpose

This glossary provides canonical definitions for first-class protocol terms.

Later specification documents may refine these definitions, but they should not redefine terms incompatibly without updating this glossary.

## Terms

### ACK

An acknowledgement that a recipient, device, group epoch, or provider has observed or processed a delivery or sync item according to a specified state machine.

An ACK is not automatically acceptance into durable local state unless the relevant specification says so.

### Application Projection

A user-facing product interpretation of protocol state.

Examples include Discord-like spaces/channels, Reddit-like communities/posts/comments, Twitter-like timelines, Facebook-like groups/feeds, forum views, and chat views.

### Authority Layer

The protocol layer that defines validity through cryptographic identity, signatures, capabilities, encryption state, consistency classes, and deterministic validation/projection rules.

### Availability Provider

A service or peer that improves reachability, delivery, storage durability, discovery, search, feed generation, media caching, or relay behavior.

Availability providers do not become protocol authority merely by hosting, relaying, indexing, or generating data.

### Bridge

An infrastructure surface that helps constrained peers submit, receive, or catch up on signed protocol records while remaining subordinate to protocol validation.

### Capability

A signed or otherwise verifiable permission, authority, or supported feature declaration.

Capabilities may authorize actions, advertise provider behavior, or negotiate optional features.

### Channel

A scoped stream or context inside a Space.

A channel may represent text messages, announcements, private discussion, moderation/admin traffic, voice/video signaling, or other scoped social activity.

### Checkpoint

A compact sync position or integrity marker used to resume, compare, or verify synchronization progress.

A checkpoint is not a substitute for validating the records it references.

### Component

A content-addressed or otherwise referenced data piece attached to an Entity.

Components may be public, private, encrypted, or selectively replicated.

### Conformance Profile

A named set of required protocol primitives, behaviors, and interoperability expectations.

Examples include Core, Messaging, Social, Availability, Offline, and Security profiles.

### Content Bundle

A bounded collection of content-addressed blocks, payloads, manifests, or object references packaged for transfer, storage, verification, or import.

A Content Bundle may support sync, mailbox, media, portable-drop, or provider-availability workflows. It is not protocol authority by itself.

### Controller

The cryptographic authority root for a user or another governed identity.

A controller authorizes devices, capabilities, and high-risk identity actions according to protocol rules.

### Data Partition

A scoped area of a User Data Root or Space data model with its own privacy, consistency, replication, retention, and sync behavior.

### Device

An authorized local actor capable of signing, storing, decrypting, projecting, or synchronizing protocol records within the authority granted to it.

### Entity

A portable data object that may be composed from components and represented by snapshots.

Entities are intended for app data modeling, not for replacing authority-layer state machines.

### Feed Collection

A signed, portable definition of a set or stream of feed-relevant objects.

Examples include following feeds, space feeds, channel feeds, list feeds, saved feeds, topic feeds, moderation-review feeds, and local-nearby feeds.

### Feed Generator

A rule, local algorithm, or service that selects feed candidates from available protocol records.

Feed generators may use infrastructure, but feed ownership and subscriptions remain user-controlled protocol state.

### Feed Projection

The application-specific presentation of feed candidates.

Examples include chronological timelines, ranked feeds, unread channel views, forum thread lists, media grids, or mixed social feeds.

### Identity Root

The root cryptographic identity from which controller authority, device authorization, and recovery behavior derive.

### Inbox

The receive-side mailbox state for encrypted delivery pickup, verification, decryption, rejection, acknowledgement, and local acceptance.

Inbox state is mailbox/delivery state, not the complete User Data Root.

### Infrastructure Surface

One of the three canonical protocol-aware provider roles: `bridge`, `relay`, or `super-peer`.

Other provider capabilities (mailbox hosting, search, feed generation, media caching, storage) are advertised as capability identifiers by these surfaces, not as independent surfaces. See `docs/protocol/infrastructure-capability-surfaces.md`.

### Mailbox

A first-class delivery primitive for encrypted store-and-forward behavior, receipts, acknowledgements, retry, expiry, and catch-up.

Mailbox is delivery infrastructure. It is not the durable source of user-owned state.

### Mailbox Delivery

A mailbox-scoped delivery record or envelope used to route, store, fetch, retry, expire, or acknowledge encrypted payload delivery.

Mailbox Delivery records do not prove that a recipient accepted the payload into durable local state unless the mailbox specification explicitly says so.

### Mailbox Receipt

A mailbox-scoped receipt that records provider, recipient, device, group, expiry, rejection, or acceptance observations according to a mailbox state machine.

A Mailbox Receipt is not automatically proof of user-visible delivery.

### Object Reference

A protocol reference to signed, content-addressed, encrypted, or externally stored data.

Object References help separate identity, integrity, storage location, and payload retrieval.

### Outbox

The send-side mailbox or mutation state for queued delivery, retries, provider acceptance, conflicts, expiry, failure, and sender-side delivery tracking.

### Portable Sync Drop

A bounded, encrypted, verifiable sync bundle that can be transferred over any medium, including file export/import, USB, Bluetooth, QR batches, local Wi-Fi, messaging attachments, torrents, Hypercore feeds, or IPFS-compatible block bundles.

A Portable Sync Drop is an import/export and transport mechanism, not protocol authority.

### Projection

A deterministic or application-defined view derived from protocol records.

Authority-sensitive projections must obey consistency-class and validation rules.

### Receipt

A delivery, processing, acceptance, rejection, expiry, or provider-observation record produced by a mailbox, recipient, device, group, or provider according to a specified state machine.

A Receipt is not automatically proof of user-visible delivery unless specified.

### Relay

An infrastructure surface that moves bytes or forwards traffic without becoming the authority for the records it carries.

### Replica

A local or hosted copy of some portion of a User Data Root, Space, mailbox queue, feed cache, object store, or sync partition.

Replicas may be complete or partial. A Replica is not automatically canonical.

### Snapshot

A stable representation of an Entity, Component set, object graph, feed candidate set, or sync state at a specific point or content-addressed digest.

Snapshots can support quote/forward references, moderation evidence, feed result stability, export/import, and audit workflows. A Snapshot is not a replacement for authority-layer validation.

### Space

A scoped social container with identity, membership, roles, policy, channels, data partitions, and optional infrastructure descriptors.

A Space may operate without dedicated infrastructure, but may also publish optional signed infrastructure descriptors for improved availability or control.

### Super-Peer

A high-availability infrastructure surface that may provide authorized availability, replication assistance, introductions, cache hints, relay-compatible services, or other advertised capabilities.

A Super-Peer is not a central server and does not own latest state.

### Sync Interest

A declared scope of records, partitions, channels, feeds, mailbox items, or payloads that a peer wants to synchronize.

Sync Interests should support selective, private, and low-bandwidth operation.

### User Data Root

The logical, portable, user-owned data space replicated across authorized devices and optional providers.

The User Data Root is not a single physical server, mailbox, repository, pod, bridge, relay, super-peer, app view, or storage provider.

## Naming status

Some terms are intentionally Draft and may be renamed before stable API exposure.

Terms that especially need continued review:

- User Data Root;
- Portable Sync Drop;
- Availability Provider;
- Feed Collection;
- Feed Generator;
- Feed Projection;
- Space;
- Channel.
