# Sync Checkpoints v1

- Status: Implemented first slice
- Date: 2026-05-24

Normative design decision is recorded in `docs/adr/003-sync-offsets-and-cursors-v1.md`.

## Scope

Sync checkpoints record the latest accepted reader position for a source, stream, and scope tuple.

They are local delivery state. They are not protocol events, signed event content, or canonical application state.

## Storage key

A checkpoint is keyed by:

- `sourceId`: the reader source, such as a bridge or future stream reader,
- `streamId`: the logical stream being consumed,
- `scope`: the local isolation boundary, such as an identity, feed, room, or future capability-bounded scope.

The stored `checkpointId` is derived from that tuple and is used as the Dexie primary key.

## Semantics

- Creating a checkpoint stores `cursor`, `sequence`, and `updatedAt`.
- Repeating the same sequence and cursor is idempotent.
- Advancing to a greater sequence updates the checkpoint.
- Moving to a lower sequence is rejected by default.
- Rewind requires `allowRewind: true` and should be reserved for controlled resync or recovery flows.
- The sync-client helper rejects same-sequence updates with a different cursor unless rewind is explicitly allowed.

## Boundaries

Checkpoint sequence values may help order local reader progress. They must not rewrite signed event content or prove that signed content is valid.

Event validity still depends on protocol validation, signature verification, and the relevant local application rules.

## Current implementation

The first slice adds:

- `syncCheckpoints` Dexie table in local-store schema v4,
- local-store checkpoint read and advance APIs,
- sync-client `acceptSyncCheckpoint` helper,
- tests for create, advance, idempotency, rewind blocking, explicit rewind, persistence across reopen, input validation, and source/stream/scope isolation.
