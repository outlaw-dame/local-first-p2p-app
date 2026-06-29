# Forwarding

- Status: Draft
- Specification series: 5
- Specification version: 0.x
- Scope: mailbox forwarding semantics and provenance
- Profiles: Messaging, Social, Offline
- Related:
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/05-mailbox/delivery-envelopes.md`
  - `docs/specification/03-data/entity-component-snapshots.md`

## Purpose

This document defines forwarding semantics for mailbox-delivered records.

Forwarding creates a new delivery action. It does not mutate the original record.

## Requirements

- A forward MUST NOT modify the original signed record.
- A forward SHOULD preserve provenance to the forwarded record or Snapshot where safe.
- A forward MUST respect privacy, encryption, access policy, and local controls.
- A forward MUST NOT grant recipients access to encrypted content they are not authorized to decrypt.
- A forward MUST be verifiably distinguishable from original authorship.

## Forwarding model

A forward may include:

- new sender/forwarder;
- original author reference;
- original record reference;
- Snapshot-pinned reference where needed;
- new recipient descriptors;
- optional forwarding note;
- new Delivery Envelope;
- payload references or re-encrypted payloads;
- provenance metadata;
- policy constraints.

## Sender vs author

Forwarding requires a clear distinction between:

- original author;
- forwarder/sender;
- mailbox submitter;
- recipient;
- provider.

Protocol schemas MUST ensure a forwarded record is verifiably distinguishable from original authorship, and applications MUST NOT present it as newly authored by the forwarder.

## Snapshot-pinned forwarding

For moderation evidence, quote-like behavior, reports, appeals, and audit use cases, forwards SHOULD reference an exact Snapshot where later mutation or deletion would change meaning.

## Encrypted payloads

Forwarding encrypted payloads may require:

- re-encryption for new recipients;
- forwarding only Object References;
- forwarding metadata without payload;
- requiring original recipient authorization;
- denying forward due to policy.

A forward MUST NOT expose plaintext to unauthorized recipients.

## Policy

Forwarding policy may depend on:

- author restrictions;
- Space/Channel rules;
- group/MLS epoch rules;
- recipient privacy settings;
- local user controls;
- legal/safety restrictions;
- content labels;
- provider admission policy.

Provider admission policy may refuse a forward for that provider. It MUST NOT be represented as global protocol invalidity.

## Low-bandwidth behavior

Low-bandwidth forwarding SHOULD prefer references and compact metadata over duplicating large payloads.

Large payloads SHOULD remain lazy via Object Reference where safe.

## Security considerations

Implementations MUST guard against:

- authorship confusion;
- unauthorized plaintext disclosure;
- stripped provenance;
- unpinned evidence mutation;
- forwarding sealed recipient metadata;
- forwarding content blocked by local policy;
- replaying old forwards as new author events.

## Open questions

- Canonical forward object shape.
- Whether forwarding is a mailbox event, social primitive, or both.
- Required provenance fields.
- How forwarding interacts with future quote-post semantics.
