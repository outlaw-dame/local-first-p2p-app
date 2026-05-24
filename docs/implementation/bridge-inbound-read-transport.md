# Bridge Inbound Read Transport v1

- Status: Implemented first client-side slice
- Date: 2026-05-24

## Scope

This slice adds a sync-client HTTP reader for pulling ordered inbound signed-event records from a bridge-like reader endpoint.

It is a transport adapter only. It does not make the bridge authoritative and it does not bypass local protocol validation, signature verification, identity checks, or permission checks.

## Request contract

The client sends:

- `sourceId`: local reader identity, such as `bridge:primary`,
- `streamId`: logical stream being read,
- `scope`: local isolation boundary,
- optional `cursor`: last accepted opaque cursor,
- optional `limit`: positive maximum record count.

The request uses `credentials: "omit"` so browser cookies are not sent to bridge endpoints by default.

## Response contract

The bridge returns a JSON object with a `records` array. Each record carries:

- `cursor`: opaque cursor for the record,
- `sequence`: non-negative monotonic reader sequence,
- `event`: signed event envelope,
- optional `receivedAt`: ISO timestamp.

Records must not include `sourceId`, `streamId`, or `scope`. Those checkpoint identity fields come from the caller request, not from the remote bridge response.

## Failure policy

Malformed successful responses are retryable failures. Terminal client/configuration HTTP statuses are mapped to `NonRetryableInboundSyncError`.

The reader rejects:

- malformed JSON,
- non-object responses,
- missing or non-array `records`,
- more records than requested,
- records that try to override checkpoint identity,
- missing cursors,
- invalid sequences,
- non-object events,
- invalid `receivedAt` timestamps,
- endpoints with embedded credentials.

## Boundary with inbound apply

The reader returns `InboundSyncRecord` values that can be passed to `processInboundSyncBatch`.

`processInboundSyncBatch` remains responsible for local transactional apply semantics. The bridge reader only parses and maps transport data into the local inbound-sync shape.
