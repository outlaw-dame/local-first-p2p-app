# Protocol Layer Model

- Status: Draft
- Specification series: 1
- Specification version: 0.x
- Scope: conceptual layer boundaries for the protocol
- Profiles: all
- Related:
  - `docs/specification/00-philosophy/protocol-philosophy.md`
  - `docs/specification/00-philosophy/protocol-design-principles.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines the protocol layer model used to separate authority, user data, availability, and transport.

The layer model helps prevent infrastructure or runtime adapters from drifting into protocol authority.

## Layer stack

```txt
Application Projection
  ↓
Social Primitives
  ↓
Authority Layer
  ↓
User Data / Replica Layer
  ↓
Availability Layer
  ↓
Transport / Runtime Adapter Layer
```

A higher layer may depend on services from a lower layer. A lower layer MUST NOT override validation rules from a higher authority layer.

## Application Projection

Application Projection is how an app presents protocol state to users.

Examples:

- Discord-like spaces/channels;
- Reddit-like communities/posts/comments;
- Twitter-like timelines;
- Facebook-like groups/feeds/events;
- forum-like categories/threads;
- chat-like DMs and group chats;
- media-first feeds.

Application projections MAY vary. They MUST NOT redefine core protocol semantics.

## Social Primitives

Social Primitives are shared protocol concepts that apps can project differently.

Examples:

- Space;
- Channel;
- Feed Collection;
- Feed Generator;
- Feed Projection;
- Thread;
- Message/Post/Comment;
- Reaction;
- Role;
- Membership;
- Presence;
- Report;
- Appeal;
- Moderation Label.

The protocol SHOULD define enough shared social primitives to avoid incompatible app conventions for common social behavior.

## Authority Layer

Authority Layer defines validity and authorization.

Examples:

- Identity Root;
- Controller;
- Device;
- Capability;
- signed event envelope;
- consistency class;
- MLS/group-control state;
- private payload envelope;
- signature verification;
- key epoch;
- deterministic projection;
- trust/safety policy;
- moderation authority;
- revocation.

Authority Layer validation MUST happen before records are applied to authority-sensitive state.

## User Data / Replica Layer

User Data / Replica Layer stores, organizes, and synchronizes user-owned portable state.

Examples:

- User Data Root;
- local device replica;
- data partitions;
- entities;
- components;
- snapshots;
- object references;
- content bundles;
- feed subscriptions;
- mailbox state;
- sync checkpoints;
- portable export/import state.

This layer may use content addressing, selective sync, entity snapshots, or Willow/Leaf-inspired organization. It MUST remain subordinate to Authority Layer rules for authority-sensitive state.

## Availability Layer

Availability Layer improves reachability, durability, discovery, search, feed generation, and catch-up.

Examples:

- Bridge;
- Relay;
- Super-Peer;
- Mailbox provider;
- Search provider;
- Feed Generator provider;
- Media cache;
- Storage provider;
- CDN;
- App view;
- Space-operated infrastructure.

Availability services MAY store, cache, relay, index, generate, or publish hints. They MUST NOT become identity, latest-state, membership, trust, moderation, or plaintext authorities unless a specific protocol capability grants a narrow role.

## Transport / Runtime Adapter Layer

Transport / Runtime Adapter Layer moves bytes and provides runtime integration.

Examples:

- HTTP bridge transport;
- WebRTC DataChannel;
- QUIC/TCP;
- Holepunch/HyperDHT;
- Hypercore/Corestore;
- mDNS/LSD/local discovery;
- Bluetooth/BLE;
- Wi-Fi Direct/local hotspot;
- USB/file import-export;
- QR/batch transfer;
- Tor/I2P;
- WebSocket/SSE/long-poll.

Transport adapters MUST NOT define protocol authority.

## Cross-layer rules

### Validate Before Apply

Records received through any availability or transport layer MUST be validated before application to authority-sensitive projections.

### Hints Are Not Truth

Storage hints, provider descriptors, DHT announcements, index hits, feed generator outputs, relay routes, and mailbox routes are hints or candidate sets. They MUST NOT be treated as proof of authority.

### Delivery Is Not Replication Success

Transport delivery or provider acceptance means bytes moved or were accepted for service-specific handling. It MUST NOT be interpreted as recipient acceptance of the payload into durable state.

### Projection Is Not Mutation

An application projection MAY display or rank a record differently. It MUST NOT mutate the underlying protocol record semantics.

### Availability May Be Redundant

Multiple availability providers MAY serve the same object, record, feed candidate set, or mailbox envelope. Clients SHOULD validate the content rather than trusting the provider.

## Examples

### Hosted mode

```txt
Application Projection
  uses feed generator and app view
  ↓
Social Primitives
  feeds, spaces, channels
  ↓
Authority Layer
  validates signatures/capabilities
  ↓
User Data / Replica Layer
  local replica + provider cache
  ↓
Availability Layer
  hosted mailbox + search + super-peer
  ↓
Transport
  HTTPS/WebRTC/HyperDHT
```

### Degraded P2P mode

```txt
Application Projection
  local chronological views
  ↓
Social Primitives
  local space/channel/message primitives
  ↓
Authority Layer
  validates signed records locally
  ↓
User Data / Replica Layer
  local replica + portable sync drop
  ↓
Availability Layer
  none or nearby peer cache
  ↓
Transport
  Bluetooth/file/local Wi-Fi
```

Both modes use the same authority rules. The experience differs; protocol validity does not.

## Security considerations

Layer confusion is a major threat.

Implementations MUST NOT treat lower-layer success as higher-layer authority.

Examples of unsafe layer confusion:

- treating a relay route as sender authenticity;
- treating mailbox acceptance as recipient acceptance;
- treating a feed generator result as canonical state;
- treating a public index as authorization;
- treating content addressing as permission;
- treating app-view display as moderation authority.

## Interoperability considerations

Independent implementations SHOULD use the same layer distinctions when exposing APIs and SDKs.

APIs SHOULD avoid names that imply provider authority where only availability or transport is being provided.
