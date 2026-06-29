# Selective Replica Sync

- Status: Draft
- Specification series: 4
- Specification version: 0.x
- Scope: transport-agnostic selective synchronization over validated protocol records
- Profiles: Core, Messaging, Social, Offline, Availability
- Related:
  - `docs/specification/02-identity/user-data-root.md`
  - `docs/specification/02-identity/replica-model.md`
  - `docs/specification/03-data/data-partitions.md`
  - `docs/specification/03-data/object-references.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines the target Selective Replica Sync model.

Selective Replica Sync is the protocol-level synchronization layer for moving signed records, partition state, mailbox state, feed state, object references, checkpoints, and payload hints across devices, peers, providers, and transports.

## Current implementation relationship

The current reference implementation includes checkpointed signed-event bridge sync through `@lfp2p/sync-client`.

That implementation is a valid step toward the target model, but it is not the complete protocol sync engine.

The target model is transport-agnostic and should support local stores, bridge transport, mailbox fetch, direct P2P, WebRTC, Hypercore/Corestore-style replication, Portable Sync Drops, low-bandwidth local transfer, and future availability providers.

## Requirements

- Sync MUST NOT bypass authority-layer validation.
- Sync delivery MUST NOT be treated as durable acceptance until records are validated and applied.
- Sync SHOULD be selective by partition, Space, Channel, feed, mailbox scope, time window, payload size, object type, and privacy scope.
- Sync SHOULD support complete and partial replicas.
- Sync SHOULD support idempotent replay of already-seen records.
- Sync MUST treat provider locations, feed outputs, mailbox routes, and storage hints as hints rather than authority.

## Sync pipeline

A typical sync pipeline is:

```txt
Discover peer/provider/transport
  ↓
Negotiate capabilities and sync interests
  ↓
Compare checkpoints or compact state
  ↓
Exchange record headers and object references
  ↓
Fetch required records and payloads
  ↓
Validate authority and integrity
  ↓
Apply according to consistency class
  ↓
Persist checkpoint / ACK / diagnostic state
```

## Selectivity dimensions

Sync MAY be scoped by:

- Identity Root;
- Device;
- User Data Root partition;
- Space;
- Channel;
- Feed Collection;
- mailbox inbox/outbox state;
- record type;
- consistency class;
- time window;
- checkpoint range;
- payload size;
- privacy scope;
- object availability;
- low-bandwidth priority.

## Record headers before payloads

Sync SHOULD exchange small verifiable headers, object references, digests, and checkpoints before large payloads.

Large payloads SHOULD be fetched lazily unless required for validation or user-visible interaction.

## Validation before apply

Before applying synced data, implementations MUST validate:

- signatures;
- signer authority;
- Device authorization;
- Capability scope;
- revocation state;
- consistency class;
- key epoch or MLS state where applicable;
- object/reference integrity;
- replay/idempotency behavior;
- local privacy/safety policy.

## Sync adapters

A sync engine MAY use adapters for:

- local store;
- event log;
- User Data Root partition;
- mailbox;
- bridge;
- direct P2P;
- WebRTC DataChannel;
- Hypercore/Corestore-like replication;
- Portable Sync Drop;
- Bluetooth/local-nearby transfer;
- super-peer availability;
- provider cache.

Adapters move records or payloads. They MUST NOT redefine validation.

## Conflict behavior

Conflict behavior is determined by the relevant consistency class and object specification.

The sync engine MUST NOT apply a generic LWW rule across all synced data.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD prioritize:

- identity/device/capability state;
- revocations;
- key epochs;
- membership checkpoints;
- mailbox headers;
- recent small text/control records;
- object refs/digests;
- compact feed or Channel heads.

Large media, generated metadata, embeddings, search indexes, and long history windows SHOULD be deferred.

## Provider behavior

Availability providers MAY help sync by storing records, publishing checkpoints, serving objects, forwarding mailbox records, or providing candidate sets.

Provider sync assistance MUST remain subordinate to protocol validation.

## Security considerations

Implementations MUST guard against:

- malicious checkpoints;
- stale revocation state;
- replayed grants;
- provider equivocation;
- payload substitution;
- sync-interest privacy leakage;
- oversized range requests;
- storage exhaustion;
- treating provider acceptance as durable apply.

## Open questions

- Canonical sync session handshake.
- Initial sync checkpoint format.
- How much of selective sync is Core Profile versus Offline Profile.
- Whether provider equivocation proofs are required in the first Availability Profile.
