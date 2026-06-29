# Delivery Envelopes

- Status: Draft
- Specification series: 5
- Specification version: 0.x
- Scope: mailbox delivery envelope semantics
- Profiles: Messaging, Offline, Availability
- Related:
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/03-data/object-references.md`
  - `docs/specification/03-data/content-refs.md`

## Purpose

This document defines Delivery Envelopes as mailbox-scoped records used to route encrypted protocol payloads.

A Delivery Envelope carries delivery metadata and references payload data. It does not make the payload valid by itself.

## Requirements

- A Delivery Envelope MUST NOT be treated as payload authority by itself.
- A Delivery Envelope MUST bind intended recipient scope.
- A Delivery Envelope SHOULD reference encrypted payloads by Object Reference where payloads are large or deferred.
- A Delivery Envelope SHOULD support idempotent submission and replay-safe processing.
- A Delivery Envelope MUST NOT require private payload plaintext exposure to mailbox providers.

## Suggested fields

A future envelope object may include:

- envelope identifier;
- author reference;
- sender/submitter reference;
- recipient descriptors;
- visible recipient scope;
- sealed recipient scope, if any;
- reply or conversation reference;
- forward reference, if any;
- payload reference or inline encrypted payload;
- payload size;
- encryption envelope reference;
- MLS/group epoch reference where applicable;
- created time or sequence marker;
- expiry;
- required capability;
- provider route hints;
- dedupe key;
- signature or submitter proof.

## Recipient descriptors

Recipient descriptors SHOULD support:

- direct actor recipient;
- Device-specific recipient;
- group/MLS epoch recipient;
- Space recipient;
- Channel recipient;
- visible recipient;
- sealed/BCC-like recipient;
- provider route-only recipient.

Sealed recipients MUST NOT be disclosed to visible recipients.

## Payload references

Payloads may be:

- inline encrypted bytes;
- Object References;
- Content Bundle references;
- mailbox-local blob references;
- Portable Sync Drop references;
- external compatibility references where policy permits.

Payload references MUST be validated before payload application.

## Provider handling

A mailbox provider MAY:

- accept an envelope;
- reject an envelope;
- queue an envelope;
- expire an envelope;
- rate-limit submission;
- emit provider-scoped receipts;
- publish service-scoped checkpoints.

A provider MUST NOT decrypt private payloads unless an explicitly scoped feature grants that access.

## Recipient handling

A recipient Device SHOULD:

1. fetch envelope;
2. verify envelope integrity;
3. check recipient binding;
4. fetch required payloads;
5. decrypt if authorized;
6. validate payload authority;
7. apply or reject according to local policy and consistency rules;
8. emit ACK/receipt where appropriate.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD exchange envelope headers before payloads.

Large payloads SHOULD be deferred by Object Reference.

## Security considerations

Implementations MUST guard against:

- forged envelopes;
- replayed envelopes;
- recipient confusion;
- sealed recipient leakage;
- payload substitution;
- stale group epoch delivery;
- provider metadata amplification;
- oversized inline payloads;
- treating envelope presence as payload validity.

## Open questions

- Canonical envelope encoding.
- Recipient descriptor shape.
- Whether envelope IDs are content-addressed, random, or signed-event IDs.
- Required dedupe behavior.
