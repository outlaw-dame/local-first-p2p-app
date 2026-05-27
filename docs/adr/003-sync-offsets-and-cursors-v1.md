# ADR-003: Sync Offsets and Cursors v1

- Status: Accepted
- Date: 2026-05-27
- Owners: Runtime and protocol maintainers
- Related docs:
  - `docs/implementation/sync-checkpoints.md`
  - `docs/threat-model/bridge-compromise.md`

## Context

Bridge HTTP polling currently persists local sync checkpoints and guards against stale, duplicate, and rewind-unsafe updates.

Upcoming Durable Streams and WebSocket readers need an explicit offset/cursor contract before implementation so reconnect/resume behavior is deterministic and schema evolution does not drift.

Without this ADR, each transport risks inventing incompatible checkpoint semantics.

## Decision

Adopt a single v1 checkpoint model across transports:

- local persistence key tuple: `(sourceId, streamId, scope)`
- progress fields: `sequence` (safe non-negative integer) and `cursor` (opaque non-empty token)
- writer rule: only the local transaction boundary can advance/replace checkpoints
- monotonic rule: lower sequence is rejected unless `allowRewind` is explicitly true
- same-sequence rule: same sequence with different cursor is rejected unless `allowRewind` is explicitly true
- idempotency rule: same sequence and same cursor is accepted as idempotent

The checkpoint remains local delivery state only. It is never treated as protocol truth and never replaces signed event validation.

## Schema proposal (local-store)

Continue using `syncCheckpoints` table keyed by deterministic `checkpointId` derived from `sourceId|streamId|scope`.

Required stored fields:

- `checkpointId: string`
- `sourceId: string`
- `streamId: string`
- `scope: string`
- `cursor: string`
- `sequence: number`
- `updatedAt: string` (ISO datetime)

v1 extension policy:

- additive optional fields allowed for diagnostics (for example `appliedEventId`),
- no breaking rename/removal of required fields,
- unknown future fields ignored by v1 readers unless explicitly required by newer schema version.

## Sync-client contract

`acceptSyncCheckpoint` is the single client helper for persisting remote progress.

Contract:

- Input: `sourceId`, `streamId`, `scope`, `cursor`, `sequence`, `updatedAt`, optional `allowRewind`
- Output:
  - `true` if checkpoint was accepted and persisted,
  - `false` if checkpoint was rejected by monotonic/same-sequence safety policy,
  - throw for validation/configuration errors (for example empty identifiers)
- Behavior:
  - never bypass local-store transaction invariants,
  - never mutate signed event content,
  - never treat bridge ack as canonical state authority.

## Reconnect/resume semantics

Transport readers must follow this sequence:

1. Load existing checkpoint for `(sourceId, streamId, scope)`.
2. Start reader from stored cursor if present; otherwise start from transport default origin.
3. Apply inbound signed events through normal validation/enforcement path.
4. Persist checkpoint only after successful apply path for the corresponding progress boundary.
5. On conflict/rejection, keep existing checkpoint and continue recovery policy.

## Security and abuse considerations

- Prevent replay-induced rewind by default.
- Reject malformed cursor/sequence values.
- Preserve stale-response guards in higher-level sync orchestration.
- Keep payload privacy boundaries separate from checkpoint metadata.

## Consequences

Positive:

- Durable Streams/WebSocket implementations can reuse one checkpoint policy.
- Reconnect behavior is deterministic and testable.
- Store and client boundaries remain explicit.

Trade-offs:

- Controlled rewind requires explicit operator/developer intent.
- Transport-specific high-watermark semantics must map into `sequence/cursor` without weakening invariants.

## Validation requirements

Before promoting new reader transports:

- monotonic advance tests,
- same-sequence mismatch rejection tests,
- explicit rewind acceptance tests,
- persistence-across-reopen tests,
- per-scope/source/stream isolation tests,
- replay/stale response tests at sync-client orchestration level.
