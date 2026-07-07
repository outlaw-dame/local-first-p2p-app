# Phase 5 Foundation Roadmap

- Status: Draft
- Date: 2026-06-29
- Scope: doctrine and planning order for User Data Root, selective sync, feeds, mailbox, spaces/channels, and threshold authority
- Related doctrine: `docs/protocol/protocol-architecture-synthesis.md`
- Specification reconciliation: this roadmap predates the `docs/specification/` series. Its exit-criteria paths under `docs/protocol/` should now be read as satisfied or superseded by the matching `docs/specification/*` documents listed in `docs/implementation/specification-reconciliation.md`.

## Purpose

This roadmap captures the next architecture/documentation sequence before implementation widens into mailbox, spaces/channels, feeds, super-peer availability, and full P2P runtimes.

It intentionally does not replace `docs/implementation/roadmap-ordering.md`. It is an additive Phase 5 foundation plan that can be reconciled into the main ordering doc after the open roadmap and consistency-class PRs settle.

## Current implementation baseline

The repository already has:

- signed protocol events;
- controller/device identity foundations;
- capability proofs and verifier direction;
- local Dexie store;
- mutation outbox;
- checkpointed sync-client primitives;
- HTTP bridge transport;
- bridge admission and Durable Streams work;
- content-addressing primitives;
- private payload envelope work;
- MLS group keying doctrine and group-control record work;
- trust/safety and local-control portability work.

The repository does not yet have first-class implementations for:

- User Data Root;
- data partitions/subspaces;
- Leaf-inspired entity/component/snapshot model;
- spaces/channels;
- encrypted mailbox actor;
- feed collections/generators/projections;
- low-bandwidth sync profile;
- portable encrypted sync drops;
- FROST/threshold authority.

## Ordering principle

Do not implement mailbox, spaces/channels, feeds, super-peer availability, or full runtime adapters before the User Data Root and sync doctrines are clear.

Build in this order:

```txt
User Data Root
→ selective replica sync doctrine
→ Willow/Leaf-inspired partition + entity snapshot model
→ low-bandwidth sync + portable drops
→ feed primitives
→ first-class encrypted mailbox
→ spaces/channels
→ threshold authority / FROST ADR
→ mailbox + spaces/channels implementation plans
```

## Specification mapping

The roadmap's original `docs/protocol/*` exit criteria now map to the specification tree:

| Roadmap topic                      | Specification home                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User Data Root / personal replicas | `docs/specification/02-identity/user-data-root.md`, `docs/specification/02-identity/replica-model.md`                                                                           |
| Selective replica sync             | `docs/specification/04-sync/selective-replica-sync.md`, `docs/specification/04-sync/sync-interests.md`, `docs/specification/04-sync/checkpoints.md`                             |
| Data partitions                    | `docs/specification/03-data/data-partitions.md`                                                                                                                                 |
| Entity / Component / Snapshot      | `docs/specification/03-data/entity-component-snapshots.md`                                                                                                                      |
| Low-bandwidth sync                 | `docs/specification/04-sync/low-bandwidth-profile.md`                                                                                                                           |
| Portable Sync Drops                | `docs/specification/04-sync/portable-sync-drops.md`                                                                                                                             |
| Feeds                              | `docs/specification/06-social/feeds.md`, `docs/specification/06-social/collections.md`                                                                                          |
| Mailbox                            | `docs/specification/05-mailbox/mailbox.md`                                                                                                                                      |
| Spaces / Channels                  | `docs/specification/06-social/spaces.md`, `docs/specification/06-social/channels.md`                                                                                            |
| Threshold authority / FROST        | `docs/adr/014-threshold-authority-and-frost-v1.md` (shipped); a Series 8 threshold-authority spec is still future (`docs/specification/08-security/` exists, MLS specs shipped) |

## Phase 5.1 — User Data Root / Personal Replica Doctrine

### Goal

Define the protocol equivalent of an ATProto repo or Solid Pod without copying either architecture too literally.

The User Data Root is a logical, portable, user-owned data space replicated across authorized devices and optional infrastructure providers.

### Required decisions

- Define `UserDataRoot` as logical, not physical.
- Define relationship to controller identity.
- Define relationship to authorized devices.
- Define relationship to local stores.
- Define relationship to optional hosted providers.
- Define relationship to mailbox.
- Define relationship to content-addressed objects.
- Define export/import expectations.
- Define minimum portable user state.

### Required doctrine

- One cryptographic identity root, many authorized replicas.
- Mailbox delivers; User Data Root persists.
- Local device replicas are first-class.
- Infrastructure may host/cache/relay/index but not own canonical truth.
- Cross-device convergence comes from signed events, deterministic projection, consistency classes, and selective sync.

### Exit criteria

- `docs/specification/02-identity/user-data-root.md` exists.
- The doc distinguishes Identity Root, User Data Root, mailbox, local store, and infrastructure provider.
- The doc defines the minimum data that must be portable.
- The doc defines cross-device replica semantics.

## Phase 5.2 — Selective Replica Sync Engine Doctrine

### Goal

Define the target sync engine beyond the current checkpointed HTTP bridge sync.

Current `@lfp2p/sync-client` behavior remains valid, but the target engine must support multiple transports and selective User Data Root partitions.

### Required decisions

- Define `SelectiveReplicaSyncEngine` as a protocol sync layer, not a runtime SDK.
- Define sync interests.
- Define partition-scoped checkpoints.
- Define headers-first sync.
- Define payload eagerness.
- Define transport-agnostic adapter contract.
- Define rollback/rewind constraints.
- Define privacy-safe sync diagnostics.

### Required adapters in doctrine

- local store adapter;
- event log adapter;
- User Data Root partition adapter;
- mailbox adapter;
- bridge adapter;
- WebRTC DataChannel adapter;
- Hypercore/Corestore adapter;
- portable sync drop adapter;
- Bluetooth/local-nearby adapter;
- super-peer availability adapter.

### Exit criteria

- `docs/specification/04-sync/selective-replica-sync.md` exists.
- It clearly maps current `@lfp2p/sync-client` into the target architecture.
- It preserves the rule that delivery success is not replication/apply success.
- It includes low-bandwidth and infrastructure-degraded modes.

## Phase 5.3 — Willow-Inspired Data Partitioning

### Goal

Use Willow's namespace/subspace/path lessons to organize portable user and space data without importing Willow's authority semantics wholesale.

### Required decisions

- Define top-level data partitions.
- Define partition metadata requirements.
- Define safe path rules.
- Define which partitions may use mutable path semantics.
- Define which partitions must remain signed-event projections.
- Define partition-scoped sync policies.

### Suggested partitions

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

### Exit criteria

- `docs/specification/03-data/data-partitions.md` exists.
- The doc explicitly warns against using generic LWW/path overwrite for Class B/C/D authority events.
- The doc ties partition policy back to consistency classes.

## Phase 5.4 — Leaf-Inspired Entity / Component / Snapshot Model

### Goal

Define portable data objects that can support Discord-like, Reddit-like, Twitter-like, Facebook-like, forum-like, and chat-like applications while sharing common lower-level semantics.

### Required decisions

- Define `EntityRef`.
- Define `ComponentRef`.
- Define `EntitySnapshotRef`.
- Define `LinkRef`.
- Define schema/specification registry expectations.
- Define encrypted component rules.
- Define snapshot-pinned references.
- Define safe path rules inspired by Leaf's prefix-pruning avoidance.
- Define where this model is allowed and where signed authority events remain required.

### Use cases

- profile with public and private components;
- post/message body and attachments;
- comments/replies;
- quote posts;
- forwards;
- feed items;
- moderation evidence;
- reports/appeals;
- saved/bookmarked objects;
- portable export/import snapshots.

### Exit criteria

- `docs/specification/03-data/entity-component-snapshots.md` exists.
- The doc distinguishes app data modeling from authority-layer state.
- The doc defines snapshot-pinned references for evidence/quote/forward/feed use cases.

## Phase 5.5 — Low-Bandwidth Sync Profile

### Goal

Make Bluetooth/nearby/improvised constrained sync first-class instead of a later emergency add-on.

### Required decisions

- Define low-bandwidth sync profile.
- Define headers-first mode.
- Define maximum payload eagerness rules.
- Define text/control-event priority.
- Define lazy media fetch.
- Define chunking guidance.
- Define safe retry/resume.
- Define privacy constraints for nearby discovery.

### Sync first

- identity/contact proofs;
- device/capability state;
- membership checkpoints;
- recent channel heads;
- small text events;
- mailbox receipts/ACKs;
- object refs/content digests;
- tiny previews only when allowed.

### Sync later

- large media;
- thumbnails unless requested;
- embeddings;
- search indexes;
- large history windows;
- nonessential generated metadata.

### Exit criteria

- `docs/specification/04-sync/low-bandwidth-profile.md` exists.
- The doc includes Bluetooth/local-nearby constraints.
- The doc defines how normal UX degrades rather than evaporates.

## Phase 5.6 — Portable Encrypted Sync Drops

### Goal

Define an offline/intermittent transfer format inspired by Willow Drop Format.

A Portable Sync Drop is a bounded encrypted sync bundle that can be moved over any medium.

### Required transfer media

- Bluetooth/local-nearby transfer;
- local Wi-Fi/hotspot transfer;
- file export/import;
- USB/sneakernet;
- QR batches for very small data;
- email/message attachment;
- torrent-like distribution;
- Hypercore feed;
- IPFS-compatible block bundle.

### Required decisions

- Drop manifest shape.
- Included partition declarations.
- Included events/records/objects.
- Payload inclusion vs refs only.
- Encryption requirements.
- Recipient binding.
- Replay/idempotency behavior.
- Expiry and tombstone handling.
- Merkle/checkpoint integrity.
- Import validation.

### Exit criteria

- `docs/specification/04-sync/portable-sync-drops.md` exists.
- The doc treats drops as transport/import media, not authority.
- The doc ties drops to low-bandwidth and degraded-infrastructure operation.

## Phase 5.7 — Feed Collections / Feed Generators / Feed Projections

### Goal

Make feeds first-class protocol objects while preserving P2P and local-first resilience.

### Required doctrine

```txt
Feed generation may depend on infrastructure. Feed ownership and feed subscriptions must not.
```

### Required primitives

- `FeedCollection` — signed portable collection definition.
- `FeedGenerator` — rule/function/service that selects candidates.
- `FeedProjection` — application presentation of candidates.
- `FeedSubscription` — user-owned subscription record.
- `FeedCandidateSet` — bounded result set with provenance.
- `FeedCursor` — resume/pagination cursor.

### Required feed types

- following feed;
- space feed;
- channel feed;
- topic/hashtag feed;
- list feed;
- saved/bookmarked feed;
- moderation-review feed;
- media feed;
- local-nearby feed.

### Required generator modes

- local chronological generator;
- local weighted generator;
- space-operated generator;
- friend-operated generator;
- super-peer-assisted generator;
- public-index generator;
- semantic/AI generator.

### Required failure behavior

If feed infrastructure disappears, users retain:

- local following feed;
- local chronological space/channel feeds;
- saved/bookmarked feed definitions;
- subscribed collection definitions;
- portable feed generator configuration;
- cached candidate sets where policy allows.

### Exit criteria

- `docs/specification/06-social/feeds.md` exists.
- The doc borrows ActivityStreams collection lessons without inheriting ambiguous feed semantics.
- The doc borrows ATProto custom-feed lessons without requiring a centralized AppView architecture.

## Phase 5.8 — First-Class Encrypted Mailbox Doctrine

### Goal

Define mailbox as a first-class protocol delivery component.

### Required doctrine

- Mailbox is delivery, not durable user truth.
- Inbox/outbox are protocol state machines.
- Provider cannot decrypt private payloads.
- Provider cannot decide latest state.
- Delivery success is not replication success.
- Receipt is not acceptance.
- ACK is per recipient/device/group epoch.
- Sealed/BCC-like recipients must not leak to visible recipients.
- Forwarding creates a new signed event or delivery record; it does not mutate the original.
- Expiry deletes availability, not history already received.

### Required objects

- `MailboxDeliveryEnvelope`;
- `MailboxRecipient`;
- `MailboxReceipt`;
- `MailboxAck`;
- `MailboxForward`;
- `MailboxTombstone`;
- `MailboxCheckpoint`.

### Required addressing semantics

- visible required recipients;
- visible secondary recipients where product semantics require it;
- sealed recipients for BCC-like delivery;
- sender vs author distinction;
- reply-to / conversation references;
- forwarding references;
- group/MLS epoch binding.

### Exit criteria

- `docs/specification/05-mailbox/mailbox.md` exists.
- The doc is explicitly below User Data Root and selective sync doctrine.
- The doc defines provider, recipient, sender, device, group, and space/channel behavior.

## Phase 5.9 — Spaces and Channels Protocol Primitives

### Goal

Define Discord-like spaces/channels and generalize them for Reddit-like, Facebook-like, forum-like, and chat-like apps.

### Required primitives

- `Space`;
- `Channel`;
- `Role`;
- `Membership`;
- `SpacePolicy`;
- `ChannelPolicy`;
- `SpaceInfrastructureDescriptor`;
- `ChannelFeedRef`;
- `ChannelMailboxRoute`;
- `VoiceVideoRoomRef`.

### Required doctrines

- Users can create spaces/channels without running infrastructure.
- Spaces have mailbox-compatible delivery semantics even when they do not run mailbox infrastructure.
- Spaces can optionally publish signed infrastructure descriptors.
- Space infrastructure is capability-bound and non-authoritative.
- MLS group state protects private/group payloads; delivery services must not see plaintext.
- Space/channel feeds are first-class feed collections.

### Exit criteria

- `docs/specification/06-social/spaces.md` and `docs/specification/06-social/channels.md` exist.
- The docs clearly separate space authority, optional infrastructure, mailbox routes, feed collections, and runtime transports.

## Phase 5.10 — Threshold Authority / FROST ADR

### Goal

Decide how threshold signing fits account recovery, space governance, and high-risk authority events.

### Required decisions

- FROST as optional threshold authority primitive.
- Ordinary event signing remains single-device signing.
- Threshold signatures are for high-risk authority events.
- Recovery threshold models.
- Space governance threshold models.
- Infrastructure operator threshold models.
- Dealer vs DKG decision deferred or decided.
- Share storage guidance.
- Lost/stolen device behavior.
- UX and audit requirements.

### Allowed uses

- account recovery;
- controller key rotation;
- emergency recovery;
- space governance key actions;
- moderator council actions;
- high-value capability grants;
- shared infrastructure operator authority.

### Disallowed default uses

- every post;
- every chat message;
- every mailbox envelope;
- every ordinary local event.

### Exit criteria

- `docs/adr/014-threshold-authority-and-frost-v1.md` exists or a Series 8 security draft explicitly defers FROST.
- The ADR/draft defines allowed/disallowed usage and implementation deferrals.

## Phase 5.11 — Implementation Planning Pass

### Goal

After the doctrine docs above land, create focused implementation plans.

### Required implementation plans

- User Data Root storage/projection plan;
- selective sync engine plan;
- feed primitive schema plan;
- mailbox schema/state-machine plan;
- spaces/channels schema plan;
- portable sync drop plan;
- threshold authority prototype plan.

### Exit criteria

- Implementation phases are small enough for reviewable PRs.
- No runtime dependency crosses protocol package boundaries without an ADR.
- Existing bridge, sync-client, trust-safety, content-addressing, MLS, and consistency-class constraints remain intact.

## Conflict-avoidance notes

This roadmap is additive and deliberately avoids editing existing roadmap files while related PRs are open.

After the open documentation PRs settle, this roadmap should be reconciled into:

- `docs/implementation/roadmap-ordering.md`;
- `docs/implementation/phase-map.md`;
- `docs/README.md`, if a docs index update is desired.
