# Protocol Philosophy

- Status: Draft
- Specification series: 1
- Specification version: 0.x
- Scope: constitutional protocol philosophy
- Profiles: all
- Related:
  - `docs/specification/DESIGN_GOALS.md`
  - `docs/specification/SECURITY_MODEL.md`
  - `docs/specification/CONFORMANCE.md`

## Purpose

This document defines the constitutional philosophy of the protocol.

It is intentionally high-level and should change rarely. Later specifications for identity, data, sync, mailbox, social primitives, availability providers, and security mechanisms MUST remain consistent with this philosophy unless a later constitutional update explicitly changes it.

## Core statement

The protocol is a local-first, hybrid P2P social protocol designed for portable identity, portable user data, interoperable social primitives, optional infrastructure, and graceful degradation under network failure, service loss, or censorship.

Infrastructure is encouraged because it improves experience. Infrastructure MUST NOT establish protocol authority.

## Principles

### 1. Infrastructure Improves Experience, Not Authority

Bridges, relays, super-peers, hosted mailboxes, public indexes, app views, search services, feed generators, media caches, CDNs, and storage providers MAY improve availability, performance, discoverability, moderation workflows, developer experience, and user experience.

They MUST NOT become identity, membership, latest-state, moderation, trust, mailbox-acceptance, or plaintext authority unless a specific protocol capability grants a narrowly scoped authority role.

### 2. Hybrid Does Not Mean Server-Dependent

The protocol MAY feel like a polished hosted social system when infrastructure is available.

When infrastructure disappears, is blocked, is degraded, or becomes unaffordable, users SHOULD retain useful protocol function through local state, direct P2P, nearby sync, portable sync drops, or other improvised peer paths.

Degraded operation is acceptable. Evaporation of identity, portable data, or basic communication solely because optional infrastructure is unavailable is not acceptable.

### 3. Authority Is Cryptographic And Deterministic

Protocol authority MUST derive from cryptographic identity, signed records, capabilities, encryption state, key epochs, and deterministic validation/projection rules.

Provider acceptance, relay delivery, mailbox storage, index visibility, transport success, or byte availability MUST NOT imply authority.

### 4. Users Own Portable Data

A user SHOULD have a logical User Data Root replicated across authorized devices and optional providers.

The User Data Root is not a single server, repository, pod, mailbox, bridge, relay, super-peer, app view, or storage provider. Those may host, cache, relay, sync, or help recover user data, but they are not automatically canonical.

### 5. Delivery Is Separate From Persistence

Mailbox is delivery infrastructure.

User Data Root is durable user-owned state.

A mailbox delivery record, provider acceptance, ACK, or receipt MUST NOT be treated as durable user-state acceptance unless the relevant mailbox or sync state machine says so.

### 6. The Protocol Defines Social Primitives; Apps Define Projections

The protocol SHOULD define interoperable primitives such as identity, devices, capabilities, spaces, channels, feeds, threads, messages, reactions, roles, mailbox delivery, receipts, object references, and portable sync drops.

Applications MAY project those primitives into Discord-like, Reddit-like, Twitter-like, Facebook-like, forum-like, chat-like, media-first, or other product experiences.

The protocol SHOULD be opinionated enough to avoid ambiguous incompatibility while remaining flexible enough to support multiple app shapes.

### 7. Local-First Before Network-First

Implementations SHOULD prioritize local reads, local writes, local projections, and local user control.

Network synchronization SHOULD improve convergence and availability. It SHOULD NOT be required for every local interaction.

### 8. Privacy Is A Protocol Concern

Private payloads MUST remain encrypted across providers and transports.

Providers SHOULD learn only what they need to perform an advertised capability.

Mailbox routing, sealed recipients, local discovery, low-bandwidth sync, and provider logs SHOULD minimize metadata exposure.

### 9. Low-Bandwidth And Nearby Operation Are First-Class

The protocol SHOULD support constrained sync modes such as headers-first exchange, lazy payload fetch, selective replication, local discovery, Bluetooth/local-network transfer, file import/export, and portable encrypted sync drops.

Low-bandwidth support is not only an optimization; it is part of resilience.

### 10. Content Addressing Supports Integrity, Not Authority

Content-addressed identifiers, digests, Merkle proofs, bundle manifests, and chunk hashes SHOULD be used where they improve integrity, dedupe, verification, partial transfer, or provider independence.

Content addressing MUST NOT replace authorization, signatures, key-epoch validation, capability checks, or consistency-class rules.

### 11. Consistency Is Type-Specific

The protocol MUST NOT use last-writer-wins or generic CRDT merging as a default authority rule.

Each protocol object or event family SHOULD declare its consistency model.

Authority, lifecycle, revocation, key-epoch, moderation, report/appeal, and security-critical state MUST use stricter deterministic rules than generic app data.

### 12. Extensibility Must Not Create Fragmentation

Extensions are encouraged, but they MUST NOT silently redefine core semantics.

Extensions SHOULD be registered, namespaced, capability-gated, and profile-aware.

### 13. Implementations Should Be Independently Buildable

The protocol SHOULD be implementable outside this TypeScript repository.

The reference implementation demonstrates behavior. The specification defines interoperable requirements.

### 14. Safety And Abuse Resistance Are Compatibility Concerns

Moderation, local controls, reports/appeals, provider admission, spam resistance, abuse handling, and safety signals are part of protocol interoperability.

A protocol that moves bytes but cannot express trust/safety state consistently is not sufficient for the intended social use cases.

## Non-goals

The protocol does not seek to:

- prohibit hosted infrastructure;
- require users to run servers;
- force a single app view;
- force one runtime, transport, storage engine, or provider model;
- copy ActivityPub, ATProto, Solid, Nostr, Willow, Leaf, Matrix, SSB, email, IPFS, or Holepunch wholesale;
- make every implementation support every feature;
- make all data public or globally searchable;
- make AI/semantic infrastructure mandatory;
- treat provider convenience as user ownership.

## Requirement summary

- Protocol authority MUST remain separate from availability and transport.
- Infrastructure MAY improve UX/DX but MUST remain subordinate to validation.
- User data SHOULD be portable across authorized replicas.
- Mailbox delivery MUST remain separate from durable user persistence.
- Application projections MAY vary, but shared primitives SHOULD remain interoperable.
- Degraded P2P operation SHOULD preserve useful identity, data, and communication behavior.

## Open questions

- Whether `User Data Root` remains the final stable term.
- Which primitives become Core Profile requirements versus Social/Messaging requirements.
- How much of the initial feed model belongs in Core versus Social.
- Which low-bandwidth transports become required for Offline Profile conformance.
