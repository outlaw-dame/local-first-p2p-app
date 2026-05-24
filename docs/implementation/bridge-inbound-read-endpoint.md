# Bridge Inbound Read Endpoint v1

- Status: Implemented first bridge-side slice
- Date: 2026-05-24

## Scope

This slice makes the bridge capable of returning accepted signed events to the sync-client inbound HTTP reader.

It complements `docs/implementation/bridge-inbound-read-transport.md`. The transport parses records on the client side; this endpoint produces those records from bridge storage.

The bridge remains non-authoritative. It stores delivery metadata and retained signed event envelopes for availability, but local clients still validate and apply inbound records through local sync code.

## Delivery retention

Accepted bridge deliveries now store the full signed event envelope after the existing delivery checks pass:

1. request shape validation,
2. protocol envelope validation,
3. bridge-safe privacy scope check,
4. signature verification,
5. idempotency conflict checks.

The retained event is the exact signed event envelope accepted by the bridge. The bridge does not rewrite event fields.

## Read request contract

The read endpoint accepts `POST` JSON bodies with:

- `sourceId`: caller-side source identity, validated for presence but not trusted as authority,
- `streamId`: bridge target to read from for this first slice,
- `scope`: caller-side checkpoint isolation key, validated for presence but not trusted as authority,
- optional `cursor`: non-negative integer string representing the last accepted bridge sequence,
- optional `limit`: positive integer, capped at 500.

The response is:

```json
{
  "records": [
    {
      "cursor": "1",
      "sequence": 1,
      "event": {},
      "receivedAt": "1970-01-01T00:00:00.000Z"
    }
  ]
}
```

`cursor` is currently the decimal string form of the bridge sequence. `receivedAt` is the bridge accepted timestamp.

## Store support

The bridge store contract now includes `listAfter({ target, afterSequence, limit }, nowMs)`.

Implemented stores:

- in-memory store: retains events in memory and lists readable records by target and sequence,
- JSON-file store: persists retained event bodies in the existing v1 JSON state shape,
- PGlite store: adds an `event_json` column with an additive migration and indexes target/sequence reads.

## Legacy metadata-only records

Rows or records created before this slice may not contain retained event bodies. They remain valid for idempotency and snapshots, but they are skipped by read APIs because the bridge cannot safely reconstruct a signed event envelope from metadata alone.

## Non-authority boundary

The endpoint must not be treated as proof of application truth. Clients must continue to:

- validate signed event envelopes,
- verify signatures,
- apply checkpoint advancement transactionally,
- enforce local identity, permission, and privacy rules.

The bridge controls availability and ordering for this transport path only. It does not override signed event contents or local application state.
