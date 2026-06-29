# Mailbox

- Status: Draft
- Specification series: 5
- Specification version: 0.x
- Scope: first-class encrypted mailbox delivery model
- Profiles: Messaging, Core, Offline, Availability
- Related:
  - `docs/specification/01-core/authority-model.md`
  - `docs/specification/02-identity/user-data-root.md`
  - `docs/specification/04-sync/selective-replica-sync.md`

## Purpose

This document defines Mailbox as a first-class protocol delivery primitive.

Mailbox provides encrypted store-and-forward delivery, retry, catch-up, receipts, acknowledgements, expiry, and provider-scoped delivery state.

Mailbox is delivery infrastructure. It is not the durable User Data Root and does not establish latest-state authority.

## Requirements

- Mailbox providers MUST NOT require plaintext access to private payloads.
- Mailbox delivery MUST NOT be treated as durable recipient acceptance unless a later state machine explicitly defines that transition.
- Mailbox provider acceptance MUST NOT imply global validity, user consent, or recipient acceptance.
- Mailbox routes MUST NOT be treated as Identity Root, Device, Space, or membership authority.
- Mailbox records MUST remain subordinate to signatures, capabilities, key epochs, MLS state where applicable, and consistency-class validation.
- Mailbox state SHOULD support retries, expiry, dedupe, receipts, acknowledgements, and catch-up.

## Mailbox roles

### Sender

The actor or Device that creates or submits a delivery envelope.

### Author

The actor whose protocol record or message is being delivered.

The sender and author may differ in forwarding, bridge, moderation, or delegated-delivery cases.

### Recipient

The actor, Device, group, Space, Channel, or mailbox route intended to receive a delivery.

### Mailbox provider

The availability provider that stores or forwards encrypted delivery records.

A mailbox provider controls its service operation, not recipient durable state.

### Recipient device

A Device that fetches, decrypts, validates, applies, rejects, or acknowledges delivered records.

## Inbox and outbox

Inbox and outbox are delivery-state views.

Inbox tracks receive-side delivery, fetch, validation, decryption, local policy, ACK, receipt, rejection, and durable apply attempts.

Outbox tracks send-side queuing, provider submission, retry, expiry, failure, receipts, ACKs, and sender-side diagnostics.

Neither inbox nor outbox is the full User Data Root.

## Mailbox routes

A mailbox route is a delivery path.

Routes may point to:

- local device queue;
- user's hosted mailbox;
- friend/peer availability mailbox;
- Space-operated mailbox;
- bridge mailbox;
- super-peer mailbox;
- provider mailbox;
- Portable Sync Drop import path.

A route MUST be treated as delivery metadata, not identity authority.

## Privacy

Mailbox providers SHOULD learn only what is needed for delivery.

Private payloads MUST remain encrypted.

Sealed recipient or BCC-like delivery MUST NOT expose hidden recipients to visible recipients, and SHOULD NOT expose them to unnecessary providers.

## Validation

Before accepting delivered records into durable state, implementations MUST validate:

- envelope integrity;
- sender or submitter authority where applicable;
- author signature where applicable;
- recipient binding;
- Device authorization;
- Capability scope;
- key epoch or MLS state where applicable;
- replay/idempotency behavior;
- local policy;
- consistency class.

## Degraded behavior

If a mailbox provider is unavailable, implementations SHOULD support one or more of:

- local outbox queue;
- alternate mailbox route;
- direct P2P transfer;
- bridge fallback;
- nearby sync;
- Portable Sync Drop export/import;
- retry with backoff.

## Security considerations

Implementations MUST guard against:

- provider acceptance being treated as recipient acceptance;
- mailbox metadata leakage;
- sealed recipient disclosure;
- replayed envelopes;
- stale key epochs;
- unauthorized forwarding;
- provider equivocation;
- mailbox storage exhaustion;
- treating mailbox state as User Data Root authority.

## Open questions

- Canonical mailbox envelope object shape.
- Inbox/outbox state-machine details.
- Required receipt and ACK semantics for Messaging Profile.
- Whether provider checkpoints are required in the first Availability Profile.
