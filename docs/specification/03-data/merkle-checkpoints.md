# Merkle Checkpoints

- Status: Draft
- Specification series: 3
- Specification version: 0.x
- Scope: Merkle-style integrity structures for batches, bundles, checkpoints, and payload chunks
- Profiles: Core, Messaging, Social, Offline, Availability
- Related:
  - `docs/specification/03-data/content-refs.md`
  - `docs/specification/03-data/object-references.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines where Merkle-style structures are useful and where they must not be used as protocol authority.

Merkle-style structures can verify batches, chunks, bundles, receipts, and sync positions. They do not replace signatures, capabilities, consistency classes, or authority-layer validation.

## Requirements

- Merkle roots MUST NOT be treated as global latest-state authority.
- Merkle inclusion MUST NOT be treated as authorization.
- Merkle checkpoints MUST NOT replace signed-event validation or capability checks.
- Merkle structures SHOULD be used where they improve integrity, partial verification, dedupe, sync comparison, or import safety.
- Any record referenced by a Merkle proof MUST still be validated according to its object type and authority rules.

## Appropriate uses

Merkle-style structures are appropriate for:

- mailbox batch roots;
- receipt inclusion proofs;
- delivery checkpoints;
- bridge or provider audit compaction;
- Portable Sync Drop integrity;
- large attachment chunk verification;
- Content Bundle manifests;
- sync-set comparison;
- feed candidate set integrity;
- provider availability attestations where specified.

## Inappropriate uses

Merkle structures MUST NOT be used as the sole basis for:

- Identity Root authority;
- Device authorization;
- Capability grants;
- latest-state selection;
- Space membership;
- moderation authority;
- user consent;
- replacing signed records;
- replacing key-epoch validation.

## Checkpoint behavior

A checkpoint is a compact marker used to compare, resume, or verify synchronization progress.

A checkpoint MAY include:

- partition identifier;
- record range or time window;
- root digest;
- item count;
- previous checkpoint reference;
- provider or peer identifier;
- signature, if required;
- consistency-class context.

## Validation

Before trusting checkpoint contents, implementations MUST validate:

- checkpoint signature where required;
- partition scope;
- digest algorithm;
- inclusion or consistency proof;
- referenced record validation;
- replay/idempotency behavior;
- applicable authority and consistency rules.

## Provider checkpoints

Providers MAY publish checkpoints for batches, mailboxes, bridges, feeds, stores, or caches.

Provider checkpoints MUST be scoped to provider behavior unless a separate authority capability grants more.

A provider checkpoint MUST NOT be represented as user-state acceptance or global truth.

## Portable Sync Drops

Portable Sync Drops SHOULD include integrity roots or equivalent manifests so importers can verify bundle completeness and reject corrupted or malicious data.

Importers MUST still validate each record according to its object type and authority rules.

## Low-bandwidth behavior

Checkpoints can reduce bandwidth by allowing peers to compare compact state before transferring records.

Low-bandwidth peers SHOULD prefer checkpoint comparison before requesting large payload ranges where safe.

## Security considerations

Implementations MUST guard against:

- forged roots;
- replayed old checkpoints;
- provider equivocation;
- mismatched partition scope;
- malformed proof data;
- inclusion proofs for invalid records;
- treating batch integrity as user consent;
- storage exhaustion through large proof sets.

## Open questions

- Canonical checkpoint object shape.
- Required digest algorithm set.
- Whether provider checkpoints require signatures in the first Availability Profile.
- Whether equivocation proofs are required for mailbox or bridge providers.
