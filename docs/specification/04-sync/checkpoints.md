# Sync Checkpoints

- Status: Draft
- Specification series: 4
- Specification version: 0.x
- Scope: compact sync positions, resume markers, and integrity checkpoints
- Profiles: Core, Messaging, Social, Offline, Availability
- Related:
  - `docs/specification/04-sync/selective-replica-sync.md`
  - `docs/specification/03-data/merkle-checkpoints.md`
  - `docs/specification/02-identity/replica-model.md`

## Purpose

This document defines Sync Checkpoints as compact markers for comparing, resuming, verifying, and auditing synchronization progress.

Checkpoints help peers avoid repeated full scans and support low-bandwidth sync. They do not replace record validation.

## Requirements

- A Checkpoint MUST NOT be treated as authority by itself.
- A Checkpoint MUST be scoped.
- A Checkpoint SHOULD identify the partition, range, peer/provider, or record family it summarizes.
- A Checkpoint SHOULD be idempotent and safe to compare repeatedly.
- A Checkpoint MUST NOT cause records to be applied without validating those records.

## Suggested checkpoint scope

A Checkpoint MAY cover:

- a User Data Root partition;
- a Device event stream;
- a Capability stream;
- a Space;
- a Channel;
- a Feed Collection;
- a mailbox inbox/outbox route;
- a provider batch;
- a Portable Sync Drop;
- an object bundle;
- a time window;
- a consistency-class family.

## Suggested fields

A future Checkpoint object may include:

- checkpoint identifier;
- scope;
- range start/end;
- previous checkpoint reference;
- root digest or summary digest;
- item count;
- byte count, if known;
- timestamp or sequence marker;
- issuer/peer/provider;
- signature, if required;
- consistency class context;
- expiration, if any.

## Checkpoint comparison

Peers MAY compare checkpoints before transferring records.

If checkpoints match, peers MAY skip record transfer for that scope.

If checkpoints differ, peers SHOULD narrow the difference by range, partition, record family, or digest tree before requesting large payloads.

## Provider checkpoints

Providers MAY publish service-scoped checkpoints for mailbox batches, bridge queues, relay buffers, feed candidate sets, cache contents, or object bundles.

A provider checkpoint is provider-scoped unless a specification grants stronger meaning.

Provider checkpoint presence MUST NOT imply durable user acceptance or global latest state.

## Replay and staleness

Checkpoints may be stale or replayed.

Implementations SHOULD track freshness where safety-sensitive decisions depend on recent state.

A stale checkpoint MUST NOT override newer valid authority state when that newer state is known.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD compare checkpoints before transferring broad ranges or large payloads.

Peers SHOULD be able to use checkpoint mismatch to request smaller ranges or headers-only diffs.

## Security considerations

Implementations MUST guard against:

- forged checkpoints;
- stale checkpoint replay;
- provider equivocation;
- mismatched scope;
- false item counts;
- malicious digest summaries;
- treating checkpoint equality as authorization;
- applying records solely because they were included in a checkpoint.

## Open questions

- Canonical Checkpoint object shape.
- Required digest algorithm set.
- Whether Core Profile checkpoints require signatures.
- Whether provider equivocation proofs are required in the first Availability Profile.
