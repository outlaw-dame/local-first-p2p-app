# Phase Exit Report: Phase 4.4 — Bridge Durable Streams (broker + WebSocket adapter)

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

The bridge POST inbound-read endpoint required polling — a client
had to repeatedly send `cursor` requests to detect new records. Phase
4.4 adds a live-tail surface on top of the existing endpoint, following
Electric SQL's Durable Streams pattern (opaque monotonic cursors,
resumability via cursor, HTTP-friendly transport). The bridge's
transport is WebSocket (any Web-standard `WebSocketLike`), and the
cursor is `String(sequence)` — identical to the POST inbound-read
endpoint — so a client library can share a single decoder.

Two non-negotiables shaped the design:

1. **The store is the single source of truth.** The broker MUST NOT
   cache record bodies; subscribers fetch backlog from the store and
   the broker only signals "new record arrived". A broker failure is
   isolated and never crashes the delivery path.
2. **The subscribe race must not lose or double-deliver records.**
   The naive "fetch backlog → subscribe" sequence loses records
   published in the gap; "subscribe → fetch backlog" double-delivers
   them. The fix is a `buffering → goLive(afterSequence) → live`
   handshake — a small bounded per-subscription buffer captures the
   race window deterministically.

## Completed work

### `apps/bridge-service/src/stream-broker.ts` (new)

Pure runtime-agnostic publish-subscribe broker.

- `BridgeStreamBroker.subscribe({ streamKey, onRecord, onOverflow })`
  returns a `BridgeStreamSubscriptionHandle` in `'buffering'` state.
- `BridgeStreamBroker.publish(streamKey, record)` dispatches to
  buffering subs (into their per-sub buffer) and live subs (immediate
  callback).
- `handle.goLive(afterSequence)` atomically drains the buffer
  (filtering `sequence > afterSequence`), dispatches in sequence order,
  then transitions to `'live'`. A re-entrant publish-during-callback
  lands through the live path — order is preserved.
- `handle.unsubscribe()` is idempotent; removes the subscription
  bucket when the last subscriber leaves.
- Per-subscription buffer is bounded by `maxBufferedRecords` (default
  1000). On overflow `onOverflow` fires exactly once, state
  transitions to `'overflowed'`, subsequent publishes to this sub are
  no-ops. The adapter is expected to close the socket — no records
  are silently dropped.
- Subscriber callbacks are isolated: a throwing `onRecord` or
  `onOverflow` is caught and does NOT affect other subscribers or
  the publish loop.

### `apps/bridge-service/src/stream-socket.ts` (new)

Runtime-agnostic WebSocket adapter.

- `attachBridgeStreamSocket({ service, broker, socket, tokenId, ... })`
  returns a `BridgeStreamSocketHandle`. The runtime layer pre-
  authenticates the upgrade via Phase 4.3's `authorizeRequest` and
  passes the resulting `tokenId`.
- Wire frames (JSON only; binary rejected with `policy-violation 1008`):
  - Server → Client: `ready`, `backlog`, `live`, `pong`, `ping`,
    `error`.
  - Client → Server: `subscribe`, `ack`, `ping`, `unsubscribe`.
- Subscribe sequence implements the race fix:
  1. `broker.subscribe(...)` — broker buffers any record published
     during steps 2-4.
  2. `service.readInboundRecords({ cursor })` from the store.
  3. Send `backlog` frame.
  4. `handle.goLive(lastBacklogSequence)` — broker drains the buffer,
     dispatching only `sequence > lastBacklogSequence`, then live.
- Hardening:
  - 64 KiB default inbound frame cap (`maxFrameBytes`).
  - 120 frames/min rolling inbound rate limit (`maxInboundFramesPerMinute`).
  - 8 MiB default outbound `bufferedAmount` cap; close 1013 on
    overflow.
  - Server-initiated heartbeat ping at 25s; close 1001 if no inbound
    frame for 60s (configurable). Heartbeat timeout MUST exceed
    interval (validated).
  - One subscription per socket; re-subscribe is a protocol-error close.
- Every close reason and every `error` frame carries a fixed
  machine-readable code from a small enum. NEVER echoes the
  offending input. Privacy-safe per Phase 3.1.

### `apps/bridge-service/src/service.ts` (extended)

- `BridgeServiceOptions.streamBroker` — optional `BridgeStreamBrokerHandle`.
- `acceptDelivery` publishes to the broker AFTER a fresh insert.
  Duplicates and rejections are NEVER published (would emit phantom
  records). A broker failure is isolated — store wrote successfully
  so we do not roll back; the subscriber's next backlog read from the
  store is authoritative.
- `InMemoryBridgeService` forwards `streamBroker` to the base.

### `apps/bridge-service/src/types.ts` (extended)

- `BridgeStreamBrokerHandle` opaque type (publish only) declared on
  options to keep the service file independent of the broker
  implementation.
- `InMemoryBridgeServiceOptions.streamBroker` forwarded.

### 46 new adversarial tests

`stream-broker.test.ts` (18):

- Constructor validation (positive integer); subscribe / publish
  happy path with stream isolation; race fix (buffering drain,
  out-of-order publish sorted on drain, double-`goLive` no-op);
  buffer overflow (single signal, sibling isolation, throwing
  `onOverflow` does not crash); subscriber isolation (throwing
  `onRecord`, unsubscribe-from-inside-callback); unsubscribe
  idempotency + bucket cleanup; publish/subscribe input validation.

`stream-socket.test.ts` (28):

- Ready frame on attach; full subscribe→backlog→live happy path;
  cursor resume; **race fix end-to-end** (publish-during-backlog-read
  delivered exactly once, no duplicates, no drops); empty backlog;
  subscribe validation (re-subscribe, missing fields, invalid cursor,
  invalid backlogLimit); hostile inbound frames (oversize, binary,
  malformed JSON, non-record, unknown type, inbound rate limit);
  ping/pong; heartbeat (ping + timeout); backpressure
  (`bufferedAmount` cap close); socket failures (close, error,
  send throws); **privacy-safe close reasons** (hostile payload
  never appears in close reason); client unsubscribe; ack frames
  (valid no-op, invalid error frame); explicit `handle.close()`
  idempotency + broker unsubscribe; attach validation (empty
  tokenId, heartbeat timing).

### Doctrine

`docs/protocol/bridge-admission-doctrine.md` — new "Durable streams
(Phase 4.4)" section covering the architecture (broker is signal-
only; store is source of truth), the wire protocol (frame types,
cursor model), the race fix (`buffering → goLive → live`), the
hardening matrix, authentication delegation to Phase 4.3, and the
deferred-work list.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1239 passing (1193 → 1239, +46)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                       | Status | Evidence                                              |
| ----------------------------------------------- | :----: | ----------------------------------------------------- |
| Broker never caches record bodies               |   ✓    | Implementation; no field for records, only sub bucket |
| Subscribe-vs-backlog race delivers exactly once |   ✓    | End-to-end race-fix test                              |
| Buffer overflow signals once, no silent drops   |   ✓    | 3 broker tests                                        |
| Subscriber callback isolation                   |   ✓    | 2 broker tests                                        |
| WebSocket auth delegated to Phase 4.3           |   ✓    | Adapter takes pre-authorized `tokenId`                |
| Inbound frame size cap                          |   ✓    | Test pinned with 64-byte cap                          |
| Inbound frame rate limit                        |   ✓    | Test pinned with 3-frame/min cap                      |
| Backpressure via `bufferedAmount`               |   ✓    | Test pinned with 100-byte cap                         |
| Heartbeat ping + timeout close                  |   ✓    | Test pinned with fake-timer drive                     |
| Binary frame rejected                           |   ✓    | Dedicated test                                        |
| Single subscription per socket                  |   ✓    | Re-subscribe close test                               |
| Privacy-safe close reasons (no input echo)      |   ✓    | Dedicated test                                        |
| Broker failure does not crash delivery          |   ✓    | Try/catch in `acceptDelivery` publish call            |
| Duplicates and rejections NOT published         |   ✓    | Implementation — publish only on `inserted`           |
| Doctrine documents architecture + hardening     |   ✓    | New 90-line section                                   |

## Deferred work

- **Persistent per-token streaming rate limit.** Today the adapter
  caps inbound frames per minute per socket; an attacker with many
  sockets could still fan out. Future slice extends Phase 4.3's
  `BridgeHttpRateLimiter` to a token-keyed streaming bucket parallel
  to the HTTP-level one.
- **SSE / long-polling alternate transports** for clients that cannot
  open WebSockets. The broker and `attachBridgeStreamSocket` are
  shaped so an SSE adapter is a thin wrapper sharing the same broker
  handshake.
- **Catch-up `GET` with cursor in the URL path** for CDN-cacheable
  backlog reads (matches Electric's URL-as-offset pattern). Today
  backlog goes over `POST /inbound` or over the WebSocket; a GET
  surface is additive.
- **Per-stream subscription cap.** A single bad operator token
  could spawn many subscriptions on the same stream. Today the
  broker has no per-stream-subscriber cap. Future slice: per-token
  per-stream subscriber quota.
- **Broker-side persistence.** Today the per-subscription buffer is
  in-memory only. A bridge restart drops in-flight buffer contents.
  Subscribers reconnect with their last cursor and the store
  backfill picks them up, so no records are lost — but the broker
  buffer is not the durable layer. (The store IS.)
- **Ack-gated backpressure.** Today `ack` frames are accepted but
  informational. A future slice may gate broker buffer trimming on
  ack cursor so an actively-acking client gets larger effective
  buffers than a non-acking one.

## Decision

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: The broker + adapter form a small, runtime-agnostic surface
that delivers the Durable Streams promise (subscribe + resume from
cursor + live tail) with no record duplication, no record loss in
the subscribe race, and the full Phase 4.3 hardening posture (size
caps, rate limits, privacy-safe errors, constant-time auth via
delegation). The architectural rule "store is the single source of
truth; broker is signal" is structural — there is no field in the
broker that could hold a record body to drift from the store. All
hardening checks are pinned by adversarial tests.
