# Sync Client → Protocol Specification Promotion

- Status: Draft
- Date: 2026-06-30
- Scope: map the existing checkpointed sync-client and bridge sync behavior into the newer Series 4 Selective Replica Sync specification model
- Related implementation:
  - `packages/sync-client`
  - `packages/local-store`
  - `docs/adr/003-sync-offsets-and-cursors-v1.md`
  - `docs/implementation/next-development-path.md`
  - `docs/implementation/phase-5-foundation-roadmap.md`
  - `docs/implementation/specification-reconciliation.md`
- Related specifications:
  - `docs/specification/04-sync/selective-replica-sync.md`
  - `docs/specification/04-sync/sync-interests.md`
  - `docs/specification/04-sync/checkpoints.md`
  - `docs/specification/04-sync/low-bandwidth-profile.md`
  - `docs/specification/04-sync/portable-sync-drops.md`
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/07-availability/`

## Purpose

The current sync-client and checkpoint work predates the implementation-independent Series 4 sync specifications.

This document promotes the existing implementation into the newer model so current checkpointed bridge sync remains valid foundation work while the target expands toward Selective Replica Sync, Sync Interests, partition checkpoints, headers-first transfer, low-bandwidth behavior, and Portable Sync Drops.

## Current implemented / planned slice

The current slice includes:

- checkpointed bridge sync;
- local-store checkpoint persistence;
- mutation outbox integration;
- signed-event verification before projection;
- deterministic local projection assumptions;
- stale, replay, and rewind concerns captured in ADR and implementation planning.

## Specification mapping

| Existing area          | Specification owner                                                     | Promotion rule                                                                                    |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| HTTP bridge sync       | `04-sync/selective-replica-sync.md`, `07-availability/bridges.md`       | Bridge sync is one transport adapter, not the whole sync model.                                   |
| Sync offsets / cursors | `04-sync/checkpoints.md`                                                | Existing offsets become provider-scoped or partition-scoped checkpoint material.                  |
| Local checkpoint store | `04-sync/checkpoints.md`                                                | Checkpoints resume comparison and replay; they are not authority by themselves.                   |
| Mutation outbox        | `04-sync/selective-replica-sync.md`                                     | Outbox records are candidate outbound records that still require validation and transport policy. |
| Inbound pull           | `04-sync/selective-replica-sync.md`                                     | Inbound records must be validated before apply.                                                   |
| Private payload sync   | `04-sync/selective-replica-sync.md`, `04-sync/low-bandwidth-profile.md` | Sync can carry encrypted payload refs/bytes but must not require provider plaintext.              |
| Portable import/export | `04-sync/portable-sync-drops.md`                                        | Offline bundles are import media, not authority or consent.                                       |
| Mailbox catch-up       | `05-mailbox/mailbox.md`, `04-sync/selective-replica-sync.md`            | Mailbox delivery/catch-up is related to sync but not durable User Data Root state by itself.      |

## Required boundaries

- Sync transport success is not durable apply success.
- Provider checkpoints are scoped to that provider and route.
- A checkpoint does not prove global latest state.
- Sync Interests request data; they do not grant access.
- Records received through sync must still pass signature, capability, privacy, consistency-class, and local-policy validation.
- Payload fetch can be lazy and must not be required for header validation where headers are sufficient.
- Low-bandwidth sync should prioritize authority/control state before large payloads.
- Portable Sync Drops must be idempotent and bounded.

## Promotion stages

### Stage SY-P1 — Documentation promotion

Status: this document.

Exit criteria:

- Existing sync-client behavior is mapped into Series 4 specs.
- Current checkpointed bridge sync is treated as one adapter.
- Future sync work cites this promotion document or the Series 4 specs.

### Stage SY-P2 — Sync Interest runtime plan

Define runtime support for Sync Interests:

- partition scope;
- Space/Channel scope;
- mailbox scope;
- time/checkpoint range;
- headers-only mode;
- payload eagerness;
- low-bandwidth priority;
- privacy constraints.

### Stage SY-P3 — Partition checkpoint implementation plan

Expand checkpoint support beyond bridge offsets:

- partition checkpoints;
- peer/provider checkpoints;
- mailbox route checkpoints;
- Channel/feed checkpoints;
- object bundle checkpoints;
- Portable Sync Drop checkpoints.

### Stage SY-P4 — Adapter model

Define adapter contracts for:

- local store;
- event log;
- mailbox;
- bridge;
- direct P2P;
- WebRTC DataChannel;
- Hypercore/Corestore-style replication;
- Portable Sync Drop import/export;
- local-nearby transfer;
- super-peer availability assistance.

### Stage SY-P5 — Low-bandwidth and headers-first runtime

Implement constrained sync behavior:

- identity and Device state first;
- Capability state before social payloads;
- membership and Channel heads before large history;
- mailbox headers before payloads;
- Object References before object bytes;
- lazy media and large-payload fetch;
- resumable import/export.

## Deferred work

Known deferrals preserved by this promotion:

- generalized Selective Replica Sync engine;
- Sync Interest runtime structures;
- partition checkpoint schema;
- headers-first transfer;
- lazy payload fetch;
- mailbox adapter;
- direct P2P adapter;
- WebRTC adapter;
- Hypercore/Corestore adapter;
- Portable Sync Drop adapter;
- local-nearby adapter;
- super-peer-assisted adapter;
- conformance tests for replay, rewind, stale checkpoints, and partial replicas.

## Immediate engineering gates

Before expanding sync behavior, future PRs should ensure:

1. each sync path declares the adapter and checkpoint scope;
2. provider success is not represented as durable apply;
3. Sync Interests do not grant access;
4. validation occurs before apply;
5. payload fetch can be delayed where the spec allows it;
6. local policy and privacy constraints are applied after receipt and before projection;
7. low-bandwidth behavior has a documented fallback.

## Current status

The existing sync-client remains valid foundation work.

It should be promoted into a transport-adapter slice of Selective Replica Sync rather than treated as the complete long-term sync engine.
