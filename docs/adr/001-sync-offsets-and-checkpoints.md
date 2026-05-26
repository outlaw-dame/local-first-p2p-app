# ADR-001: Sync Offsets and Checkpoints

- Status: Accepted
- Date: 2026-05-26
- Supersedes: none
- Related docs:
  - docs/implementation/sync-checkpoints.md
  - docs/implementation/schema-and-storage-versioning.md
  - docs/implementation/bridge-inbound-read-transport.md

## Context

Inbound sync readers need durable local progress markers so reconnect and resume behavior remains deterministic, idempotent, and safe across process restarts.

Without a durable checkpoint contract:

- reader restarts may replay or skip records unpredictably,
- stale responses may overwrite fresher local state,
- transport-level cursor handling may drift across implementations.

## Decision

Adopt a tuple-scoped durable checkpoint model keyed by:

- `sourceId`
- `streamId`
- `scope`

Store checkpoint records with:

- `cursor` (opaque reader position string)
- `sequence` (non-negative integer monotonic ordering value)
- `updatedAt` (ISO timestamp)

### Advance semantics

1. First checkpoint for a tuple is created.
2. Same tuple + same sequence + same cursor is idempotent (no-op).
3. Same tuple + same sequence + different cursor is rejected by default.
4. Higher sequence advances the checkpoint.
5. Lower sequence is rejected by default.
6. Controlled rewind is allowed only with explicit `allowRewind: true`.

## Non-authority boundary

Checkpoint state is local delivery progress metadata only.

Checkpoint values must not be treated as proof of:

- signed event authenticity,
- event authorization,
- canonical protocol state.

Signed event validity remains governed by protocol validation, signature checks, and local policy rules.

## Persistence and isolation requirements

- Checkpoints must persist across store reopen.
- Checkpoints must be isolated by `(sourceId, streamId, scope)`.
- Updating one tuple must not mutate another tuple.

## Error handling and safety

- Invalid tuple keys, cursors, sequences, and timestamps are rejected.
- Stale and cursor-mismatch advances are rejected with explicit checkpoint errors.
- Helpers may downgrade checkpoint rejection to `false` where retry logic requires non-throw behavior, but must not mask structural validation failures.

## Consequences

- Reader implementations can rely on a single durable checkpoint contract.
- Resume behavior is deterministic and testable.
- Future transport adapters (Durable Streams/WebSocket/WebRTC) can share checkpoint semantics without redefining offset logic.

## Exit criteria

- [x] Checkpoint schema and APIs implemented in local-store.
- [x] Sync-client helper uses store checkpoint authority.
- [x] Tests cover create/advance/idempotency/rewind/isolation/persistence/validation behavior.
- [x] Documentation records non-authority and safety boundaries.
