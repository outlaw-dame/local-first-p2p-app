# Inbound sync runner

Status: implemented as a first read-side orchestration slice.

## Purpose

The inbound sync runner connects three previously separate pieces:

1. the local persisted sync checkpoint,
2. an inbound transport that can pull bridge-style records, and
3. the atomic local apply path that stores a signed event with its checkpoint.

This keeps the bridge as delivery infrastructure. The bridge provides records and cursors, but local validation and local transactional storage remain the client-side authority boundary.

## Runner contract

`pullAndProcessInboundSyncBatch` accepts a local store, a transport, and a checkpoint key:

- `sourceId`
- `streamId`
- `scope`

The runner reads the current local checkpoint for that exact key. If a checkpoint exists, its cursor is sent to the transport. If no checkpoint exists, the first pull omits a cursor.

When a caller provides `limit`, the runner passes it to the transport and also enforces it locally. A transport response with more records than requested is rejected before any record is applied.

The returned records are checked against the requested checkpoint key before any record is applied. A source, stream, or scope mismatch rejects the page before local state changes.

## Local apply boundary

After transport records pass the hard runner checks, the runner delegates to `processInboundSyncBatch`.

That means the existing local guarantees still apply:

- signed events are validated before checkpoint advancement,
- each event and checkpoint update is stored through the local-store atomic helper,
- stale lower-sequence records are skipped,
- same-sequence cursor conflicts reject and stop processing,
- invalid records do not advance the checkpoint past ambiguity.

## Result fields

The runner returns the normal inbound batch result plus:

- `pulled`: number of records returned by the transport,
- `checkpointBefore`: the checkpoint read before pulling, when one existed,
- `checkpointAfter`: the checkpoint after processing, when one exists.

These fields are local observability hints. They do not prove event validity and must not override signed event contents.

## Failure behavior

Transport failures propagate to the caller and do not mutate local event or checkpoint state.

Checkpoint key mismatches throw `InboundSyncIdentityMismatchError` before local apply begins. The error exposes a stable code, failing record index, and mismatched field names for classification. It intentionally does not include raw expected or actual source, stream, or scope values in the message because those identifiers may become privacy-sensitive in logs or user-visible diagnostics.

Transport over-limit responses throw `InboundSyncLimitExceededError` before local apply begins. This makes `limit` a hard orchestration boundary rather than a best-effort transport hint.

Retry scheduling is intentionally not embedded in the runner. The caller owns scheduling and can reuse the existing exponential-backoff policy used by outbound processing. Identity mismatch and over-limit errors should be treated as configuration or trust-boundary failures, not ordinary transient retry signals.

## Current boundaries

This runner is still a read-side client primitive, not a full sync daemon. It does not yet provide:

- background scheduling,
- multi-source fan-out,
- bridge authentication,
- rate limiting,
- encrypted mailbox authorization,
- UI-visible sync health,
- full PWA lifecycle integration.

Those belong in later orchestration and product slices.
