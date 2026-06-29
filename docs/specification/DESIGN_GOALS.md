# Design Goals

- Status: Draft
- Specification series: 0
- Scope: protocol-wide goals and non-goals

## Purpose

This document defines the design goals used to evaluate protocol proposals, specification changes, implementation plans, and future extensions.

Every protocol feature should be evaluated against these goals. A feature does not need to optimize all goals equally, but it should not silently undermine them.

## Primary goals

### Local-first operation

Users MUST be able to create, read, and manage local state without requiring a hosted service to be available at the moment of interaction.

Local writes SHOULD be accepted locally first, then synchronized when a suitable path becomes available.

### P2P survivability

The protocol is hybrid, but its survivability model is P2P-first.

Hosted infrastructure MAY improve the experience. Hosted infrastructure MUST NOT be required for protocol validity, identity continuity, local reads/writes, or eventual peer-to-peer exchange of valid portable records.

If bridges, relays, super-peers, mailboxes, public indexes, app views, search services, or hosted storage disappear or are blocked, the experience MAY degrade. Identity, portable data, and basic communication MUST NOT evaporate solely because optional infrastructure is unavailable.

### User-owned portable data

Users SHOULD have a logical User Data Root replicated across authorized devices and optional providers.

User data MUST NOT be bound to one hosted provider, runtime, mailbox, bridge, relay, or app view as the sole canonical location.

### Cryptographic authority

Protocol authority MUST derive from cryptographic identity, signed records, capability proofs, encryption state, and deterministic validation/projection rules.

Transport success, provider acceptance, byte availability, indexing, or hosting MUST NOT imply authority.

### Infrastructure as optimization

Infrastructure is encouraged.

Bridges, relays, super-peers, mailboxes, search services, feed generators, media caches, app views, CDNs, and hosted providers MAY improve availability, discoverability, performance, moderation workflows, developer experience, and user experience.

Infrastructure MUST remain subordinate to protocol authority.

### Strong interoperability

The protocol SHOULD define enough shared primitives to support interoperable Discord-like, Reddit-like, Twitter-like, Facebook-like, forum-like, chat-like, and feed-driven applications.

The protocol SHOULD avoid excessive ambiguity where implementations appear compatible but disagree on core semantics.

### Flexible product projections

The protocol SHOULD define shared primitives. Applications SHOULD define projections over those primitives.

The protocol MUST NOT force one user interface, one app shape, one ranking algorithm, one storage provider, or one runtime architecture.

### Graceful degradation

Features SHOULD have explicit degraded behavior.

When infrastructure is unavailable, implementations SHOULD fall back to local chronological views, cached records, direct peer exchange, local discovery, portable sync drops, or constrained sync profiles where possible.

### Low-bandwidth viability

The protocol SHOULD support constrained environments such as Bluetooth, local Wi-Fi, unstable mobile networks, censored networks, high-latency paths, and intermittent connectivity.

Implementations SHOULD support headers-first sync, lazy payload fetch, selective replication, bounded sync interests, and media deferral.

### Privacy by design

Private payloads MUST remain encrypted across transports and providers.

Providers SHOULD learn only what they need to perform their advertised capability.

Metadata exposure SHOULD be minimized, especially for sealed recipients, private channels, mailbox delivery, local discovery, and low-bandwidth nearby sync.

### Content-addressed integrity

The protocol SHOULD use content-addressed identifiers, hashes, digests, Merkle proofs, or equivalent integrity structures where they improve verification, chunking, dedupe, export/import safety, or provider independence.

Content addressing MUST NOT replace authorization, capability validation, signature verification, or consistency-class rules.

### Deterministic behavior where required

Authority-sensitive state MUST use deterministic validation and projection rules.

CRDT-style merging, last-writer-wins, mutable paths, or generic app storage semantics MUST NOT be used for authority, lifecycle, revocation, key epoch, moderation, report/appeal, or security-critical state unless a specification explicitly permits it.

### Multi-device consistency

A user MAY have multiple authorized devices.

Devices SHOULD converge through signed records, capability rules, sync checkpoints, deterministic projection, and selective replication.

Device authorization, revocation, recovery, and key rotation MUST be authority-layer operations, not provider-local mailbox or storage decisions.

### Extensibility without fragmentation

The protocol SHOULD support extensions and capability negotiation.

Extensions MUST be registered or namespaced. Extensions MUST NOT silently redefine core semantics.

### Developer experience

The protocol SHOULD be understandable and implementable by independent developers.

Specification documents SHOULD provide clear object models, validation rules, state machines, failure behavior, examples, and conformance expectations.

### Affordable deployment

The protocol SHOULD allow useful deployments without expensive centralized infrastructure.

Communities MAY run additional infrastructure for better UX, moderation, search, feeds, and availability, but ordinary users SHOULD be able to participate without operating servers.

## Non-goals

The protocol does not aim to:

- require all users to run servers;
- prohibit hosted infrastructure;
- require one global app view;
- require one personal repository model;
- copy ActivityPub, ATProto, Solid, Nostr, Willow, Leaf, Matrix, SSB, email, or IPFS wholesale;
- force one UI or social product shape;
- force all implementations to support every feature;
- make all data public;
- make all data globally searchable;
- treat provider acceptance as user consent;
- treat relay/mailbox/bridge delivery as replication success;
- use content addressing as a substitute for authorization;
- use LWW as a default authority conflict rule;
- make AI or semantic infrastructure part of the required core.

## Design tension handling

Some goals conflict in practice. The specification should resolve tradeoffs explicitly.

Examples:

- Better UX may require infrastructure, but infrastructure must not become authority.
- Better privacy may reduce discoverability.
- Better low-bandwidth operation may defer rich media or search.
- Stronger moderation workflows may require optional infrastructure, while local controls must remain available.
- Flexible app projections must not become incompatible object semantics.

When a proposal creates a tradeoff, the document introducing it SHOULD name the tradeoff and justify the selected balance.
