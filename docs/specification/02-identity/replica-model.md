# Replica Model

- Status: Draft
- Specification series: 2
- Specification version: 0.x
- Scope: replicas, partial replicas, and cross-device convergence
- Profiles: Core, Messaging, Social, Offline, Availability
- Related:
  - `docs/specification/02-identity/user-data-root.md`
  - `docs/specification/02-identity/device-model.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines replicas as copies of protocol state or protocol-adjacent availability state.

The replica model supports portable user data, multi-device consistency, optional providers, P2P survivability, and low-bandwidth selective sync.

## Definition

A Replica is a copy of some portion of a User Data Root, Space, mailbox queue, feed cache, object store, sync partition, provider cache, or portable sync bundle.

A Replica may be complete or partial.

A Replica is not automatically canonical.

## Requirements

- A Replica MUST NOT be treated as authority merely because it stores data.
- A Replica MUST remain subordinate to validation rules for the records it contains.
- A Replica MAY be local, hosted, peer-assisted, provider-assisted, or portable.
- A Replica SHOULD declare or imply its sync scope.
- A Replica SHOULD support idempotent import or sync where practical.
- A Replica MUST NOT turn provider storage into Identity Root, device, membership, moderation, or latest-state authority.

## Replica locations

Replicas may exist on or in:

- user phone;
- user laptop/desktop/tablet;
- home server;
- personal VPS;
- friend device;
- Space-operated provider;
- bridge backlog;
- mailbox provider;
- super-peer cache;
- relay/cache provider;
- Hypercore/Corestore-backed store;
- IPFS-compatible provider;
- local database;
- OPFS/IndexedDB/native file store;
- portable sync drop;
- backup/export archive.

## Replica scopes

A Replica may cover:

- full User Data Root;
- selected partitions;
- identity/device/capability state only;
- one Space;
- one Channel;
- recent mailbox deliveries;
- feed subscriptions;
- feed candidate cache;
- media/object blocks;
- low-bandwidth control headers;
- a bounded time window.

## Replica vs Device

A Device is an authorized actor.

A Replica is data.

A device may hold replicas. A provider may hold replicas. A portable sync drop may contain a replica subset.

A Replica MUST NOT be treated as a Device unless it is bound to valid device authorization and signer authority.

## Replica vs Provider

A provider may host a Replica.

Hosting a Replica MUST NOT imply authority over the Replica contents.

Provider deletion, expiration, or refusal affects availability. It MUST NOT be represented as global deletion or user-state revocation unless a valid authority-layer record says so.

## Sync and convergence

Replicas SHOULD converge through:

- signed records;
- deterministic projection;
- selective sync;
- checkpoints;
- idempotent import;
- consistency-class-specific conflict handling;
- authority validation.

Replicas MAY remain intentionally partial.

Full convergence is not always required for useful operation.

## Staleness

Replicas may be stale.

Implementations SHOULD track sync checkpoints, observed revocation state, and freshness where safety-sensitive decisions depend on recency.

A stale Replica MUST NOT be allowed to override newer valid authority state when that state is known.

## Portable sync drops

A Portable Sync Drop is a bounded transferable replica subset.

Portable sync drops SHOULD include enough metadata to validate, deduplicate, and import records idempotently.

Portable sync drops MUST NOT bypass authority validation.

## Low-bandwidth behavior

Low-bandwidth replicas SHOULD prefer small high-value state first:

- identity proofs;
- device state;
- capability state;
- revocations;
- key epochs;
- object references;
- mailbox headers;
- recent small records;
- checkpoints.

Large payloads SHOULD be lazy or omitted unless explicitly requested.

## Security considerations

Replica poisoning is a major threat.

Implementations MUST validate imported or synced records before applying them.

Implementations SHOULD guard against:

- stale authority state;
- replayed revocations or grants;
- malicious portable sync drops;
- provider equivocation;
- partial payload substitution;
- false checkpoint claims;
- storage exhaustion;
- metadata leakage from replica descriptors.

## Interoperability considerations

Independent implementations SHOULD preserve the distinction between:

- record validity;
- byte availability;
- provider acceptance;
- replica freshness;
- durable local acceptance;
- application projection.

APIs SHOULD avoid calling a provider-hosted Replica "the account" or "the source of truth" unless the relevant specification grants explicit authority.

## Open questions

- Initial replica descriptor object shape.
- Checkpoint format.
- Portable sync drop encoding.
- Staleness warning requirements for offline mode.
- Whether provider equivocation proofs are required in the first Availability Profile.
