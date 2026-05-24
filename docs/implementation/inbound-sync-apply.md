# Inbound Sync Apply v1

- Status: Implemented first slice
- Date: 2026-05-24

## Scope

Inbound sync apply accepts ordered signed event records from a bridge, stream reader, or future native peer reader and persists them into the local store with a checkpoint.

This is read-side delivery state. It does not make the bridge authoritative and it does not replace protocol validation.

## Record shape

Each inbound record carries:

- `sourceId`: reader source, such as a bridge or future stream reader,
- `streamId`: logical stream,
- `scope`: local isolation boundary,
- `cursor`: opaque reader cursor,
- `sequence`: monotonic reader sequence,
- `event`: signed protocol event,
- optional `receivedAt` timestamp.

## Atomicity rule

The local store provides `putSignedEventWithSyncCheckpoint` so a signed event and checkpoint are written in one transaction.

The event is validated before any checkpoint is advanced. If event validation fails, neither the event nor checkpoint is written.

## Batch semantics

The sync-client `processInboundSyncBatch` applies records in caller-provided order.

- Valid advancing records are stored and advance the checkpoint.
- Exact checkpoint replays are skipped and do not rewrite a different event.
- Lower-sequence stale records are skipped.
- Same-sequence cursor conflicts are rejected and stop the batch.
- Invalid signed events are rejected and stop the batch.
- Explicit `allowRewind` is supported only for controlled resync flows.

Stopping on rejected records prevents the client from advancing past an ambiguous or invalid stream position.

## Boundaries

Checkpoint sequence/cursor values are delivery metadata. They must not override signed event fields, prove event validity, or become application truth.

Event truth still depends on protocol validation, signature verification, identity rules, and future permission checks.
