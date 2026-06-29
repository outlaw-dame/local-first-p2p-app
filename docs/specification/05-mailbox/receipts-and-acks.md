# Receipts and Acknowledgements

- Status: Draft
- Specification series: 5
- Specification version: 0.x
- Scope: mailbox receipt and ACK semantics
- Profiles: Messaging, Offline, Availability
- Related:
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/05-mailbox/delivery-envelopes.md`

## Purpose

This document defines mailbox Receipts and Acknowledgements.

Receipts and ACKs describe delivery-state observations. They do not automatically prove durable user-state acceptance.

## Requirements

- A Receipt MUST declare what actor or provider produced it.
- A Receipt MUST declare what state transition or observation it represents.
- An ACK MUST be scoped to the actor, Device, group epoch, provider, or route that produced it.
- A Receipt or ACK MUST NOT be treated as durable recipient acceptance unless the relevant state machine explicitly defines that meaning.
- A provider Receipt MUST be scoped to provider behavior.

## Receipt categories

A future mailbox state machine may define:

- submitted;
- provider accepted;
- provider rejected;
- provider expired;
- provider deleted from availability store;
- fetched;
- decrypted;
- rejected by recipient policy;
- accepted into local durable state;
- applied to projection;
- forwarded;
- failed;
- retried;
- tombstoned.

These categories are Draft until the mailbox state machine is defined.

## ACK categories

ACKs may be emitted by:

- mailbox provider;
- recipient actor;
- recipient Device;
- group/MLS epoch state;
- Space or Channel handler;
- bridge or relay provider;
- local application projection.

ACK scope MUST be explicit.

## Provider receipts

Provider receipts may prove provider behavior, such as accepting or expiring an envelope.

Provider receipts MUST NOT be represented as recipient acceptance, user consent, or durable application state.

## Recipient receipts

Recipient receipts MAY indicate fetch, decrypt, reject, accept, apply, or display state depending on user privacy settings and protocol policy.

Recipient implementations MUST NOT emit or disclose sensitive read or presence metadata without explicit user consent.

## Privacy

Receipts and ACKs can reveal activity, availability, read state, Device state, group membership, and social graph metadata.

Implementations SHOULD allow privacy-preserving receipt behavior where product semantics permit it.

Sealed recipient flows SHOULD avoid revealing hidden recipient behavior to visible recipients.

## Validation

Before accepting a Receipt or ACK, implementations SHOULD validate:

- producer identity;
- producer authority or provider role;
- referenced envelope;
- referenced recipient scope;
- state transition validity;
- replay/idempotency behavior;
- privacy policy;
- consistency class.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD prioritize compact receipts and ACKs over large payloads when they help peers avoid unnecessary retransmission.

Receipts MAY be batched or checkpointed where privacy and state-machine rules allow.

## Security considerations

Implementations MUST guard against:

- forged delivery success;
- ACK spoofing;
- replayed receipts;
- provider receipts being treated as user acceptance;
- receipt metadata disclosure;
- read-state tracking without consent;
- inconsistent state transitions;
- sealed recipient disclosure.

## Open questions

- Canonical receipt object shape.
- Which receipt states are required for Messaging Profile.
- Whether read receipts are core, optional, or app-level.
- Receipt batching and checkpoint format.
