# Mailbox Runtime Implementation Plan

- Status: Draft
- Date: 2026-06-30
- Scope: implementation plan for the first mailbox runtime slice after the mailbox specification, chat promotion, sync promotion, availability promotion, and MLS promotion work
- Related specifications:
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/05-mailbox/delivery-envelopes.md`
  - `docs/specification/05-mailbox/receipts-and-acks.md`
  - `docs/specification/05-mailbox/forwarding.md`
  - `docs/specification/05-mailbox/retention-and-expiry.md`
  - `docs/specification/04-sync/selective-replica-sync.md`
  - `docs/specification/07-availability/README.md`
- Related promotion docs:
  - `docs/implementation/phase-5-chat-spec-promotion.md`
  - `docs/implementation/sync-client-spec-promotion.md`
  - `docs/implementation/availability-surfaces-spec-promotion.md`
  - `docs/implementation/mls-group-control-spec-promotion.md`

## Purpose

Mailbox is now the main runtime boundary required by chat, group privacy, sync catch-up, and availability providers.

This plan defines a small implementation sequence for mailbox runtime support without collapsing message content, delivery state, sync state, provider acceptance, and recipient apply into one object.

## Non-negotiable boundaries

- Mailbox is delivery and catch-up, not durable user truth.
- Delivery Envelope is not the social message.
- Provider acceptance is not recipient acceptance.
- Receipt is not durable apply unless the receipt explicitly represents recipient-side apply.
- ACK is scoped to producer, recipient, device, route, and represented transition.
- Private payloads stay opaque to providers.
- Expiry removes provider availability; it does not rewrite already-received durable history.
- Forwarding creates a new delivery action; it does not mutate the original signed record.

## Runtime primitives

### `MailboxDeliveryEnvelope`

Minimum fields:

- `envelopeId`;
- `authorId`;
- `submitterId`;
- `recipientScopes`;
- `conversationRef`;
- `payloadRef` or encrypted inline payload;
- `createdAt`;
- `expiresAt`;
- `routeHints`;
- `dedupeKey`;
- `signature` or proof reference.

### `MailboxReceipt`

Represents provider or device observation of a delivery-state transition.

Initial receipt types:

- provider accepted;
- provider rejected;
- provider expired;
- recipient fetched;
- recipient rejected;
- recipient applied;
- recipient undecryptable.

### `MailboxAck`

Represents acknowledgement of a specific mailbox transition by a producer.

ACKs must not be interpreted globally without checking scope.

### `MailboxRouteState`

Tracks local route-specific state:

- queued;
- submitted;
- provider accepted;
- provider rejected;
- fetched;
- applied;
- expired;
- failed;
- undecryptable.

## Implementation phases

### Phase MB-1 — Types and validators

Add a mailbox runtime package (e.g., `packages/mailbox-runtime` / `@lfp2p/mailbox-runtime`) with:

- Delivery Envelope type;
- Receipt type;
- ACK type;
- route-state type;
- validation helpers;
- privacy-scope checks;
- no-decrypt provider validation path.

Tests:

- malformed envelope rejected;
- missing recipient scope rejected;
- provider cannot validate by decrypting payload;
- duplicate dedupe key is idempotent;
- unsupported receipt transition rejected.

### Phase MB-2 — Local inbox/outbox state

Add local-store tables or schemas registered in `LocalFirstTableName` and a new Dexie schema version in `packages/local-store/src/index.ts` for:

- mailbox outbox route state;
- mailbox inbox route state;
- mailbox receipt log;
- mailbox ACK log.

Rules:

- store only route/delivery state in mailbox tables;
- do not store decrypted social message projection in mailbox state;
- link to protocol event/object references where needed;
- preserve idempotent replay.

Tests:

- provider accepted does not mark recipient applied;
- duplicate receipt does not double-advance state;
- expiry does not delete durable social projection;
- route-state rebuild is deterministic.

### Phase MB-3 — Bridge/provider adapter

Wire the existing bridge as the first mailbox provider adapter:

- submit Delivery Envelope;
- return provider receipt;
- preserve opaque encrypted payload;
- expose retry/expiry state;
- distinguish provider errors from local validation errors.

Tests:

- bridge never imports decrypt helpers;
- bridge accepted receipt is provider-scoped;
- provider rejection does not mutate social projection;
- payload remains opaque in logs.

### Phase MB-4 — Chat integration

Use the mailbox runtime for chat delivery without changing chat projection semantics:

- all chat event kinds, including `chat.thread.created`, `chat.thread.accepted`, `chat.message.sent`, `chat.message.edited`, and `chat.message.deleted`, remain social content;
- Delivery Envelope wraps or references the chat event payload;
- `ChatThreadState` remains local decrypted projection;
- mailbox route state drives UI delivery indicators.

Tests:

- sent message can be queued without provider acceptance;
- provider accepted does not show as recipient read/applied;
- undecryptable payload creates placeholder, not crash;
- delete purges local plaintext projection without pretending to delete provider history.

### Phase MB-5 — Sync integration

Expose mailbox state to Selective Replica Sync:

- mailbox route Sync Interest;
- route checkpoints;
- headers-first delivery-state fetch;
- lazy payload fetch;
- low-bandwidth priority for mailbox headers/receipts before payloads.

Tests:

- checkpoint replay is idempotent;
- stale provider checkpoint cannot hide newer local state;
- Sync Interest does not grant mailbox access;
- low-bandwidth mode fetches headers before large payloads.

### Phase MB-6 — Forwarding and retention

Implement forwarding and expiry rules:

- forwarding creates new envelope/action;
- original signed record remains unchanged;
- expiry removes availability for provider route;
- local durable state remains unless separately tombstoned.

Tests:

- forwarded envelope has separate author/submitter/provenance fields;
- expiry does not erase already-applied message projection;
- retention policy is provider-scoped;
- forwarded private payload does not grant unauthorized access.

## Exit criteria

Mailbox runtime is complete enough for the next UI/runtime work when:

- Delivery Envelope, Receipt, ACK, and route-state types exist;
- local inbox/outbox state persists route state;
- bridge adapter can accept mailbox delivery without plaintext access;
- chat can use mailbox route state for delivery indicators;
- provider acceptance and recipient apply are visibly distinct in tests;
- sync checkpoints can include mailbox route state;
- retention/expiry semantics are tested.

## Follow-up work

After this plan lands, the next implementation docs should be:

1. feed runtime implementation plan;
2. Space/Channel runtime implementation plan;
3. local-store schema plan for mailbox and social runtime;
4. conformance test matrix for mailbox providers.
