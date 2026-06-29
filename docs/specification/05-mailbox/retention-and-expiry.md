# Retention and Expiry

- Status: Draft
- Specification series: 5
- Specification version: 0.x
- Scope: mailbox retention, expiry, tombstones, and garbage collection
- Profiles: Messaging, Offline, Availability
- Related:
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/05-mailbox/receipts-and-acks.md`
  - `docs/specification/04-sync/checkpoints.md`

## Purpose

This document defines retention and expiry semantics for mailbox delivery state.

Expiry removes or reduces availability. It does not rewrite validated history already received by recipients.

## Requirements

- Mailbox expiry MUST NOT be represented as global deletion.
- Provider retention policy MUST be scoped to provider storage.
- Expiry MUST NOT invalidate records already accepted into durable recipient state.
- Providers SHOULD publish retention limits where possible.
- Implementations SHOULD distinguish expiry, deletion, tombstone, rejection, and durable state removal.
- Private payloads MUST remain encrypted during retention.

## Retention scope

Retention may apply to:

- queued envelopes;
- encrypted payload blobs;
- receipt records;
- ACK records;
- provider logs;
- checkpoints;
- retry state;
- rejected records;
- tombstones;
- audit summaries.

## Expiry behavior

Expiry means a provider no longer promises availability for the expired item.

Expiry MAY produce a provider-scoped receipt.

Expiry MUST NOT claim that a recipient deleted or forgot data unless the recipient produced a valid recipient-scoped deletion or tombstone record.

## Tombstones

A tombstone is a record that marks deletion, revocation, expiry, or removal semantics according to a specific state machine.

Mailbox provider tombstones are provider-scoped unless a later specification grants broader meaning.

Authority-sensitive tombstones MUST be validated according to the relevant object family.

## Garbage collection

Providers MAY garbage collect expired mailbox data according to published policy.

Clients SHOULD tolerate provider garbage collection and use alternate routes, retry, local queues, direct P2P, or Portable Sync Drops where possible.

## Recipient durable state

Once a recipient has validated and accepted a record into durable state, provider expiry does not remove that local state.

Local deletion or retention policy is controlled by the recipient's local policy and relevant protocol rules.

## Provider policy

Mailbox providers SHOULD describe:

- maximum retention window;
- maximum storage size;
- expiry behavior;
- receipt retention;
- payload retention;
- checkpoint retention;
- deletion request handling;
- abuse/DoS policy;
- privacy posture.

## Low-bandwidth behavior

Low-bandwidth clients SHOULD fetch compact mailbox headers, checkpoints, and urgent control records before expiry when possible.

Clients MAY request provider summaries to avoid fetching expired or unavailable payloads.

## Security considerations

Implementations MUST guard against:

- treating provider expiry as user deletion;
- stale expiry receipts;
- malicious premature expiry claims;
- provider retention policy misrepresentation;
- deleted payload references being used to hide abuse evidence where local policy requires retention;
- indefinite retention of private payloads against user policy;
- storage exhaustion attacks.

## Open questions

- Canonical expiry receipt shape.
- Required provider retention descriptor fields.
- Whether mailbox providers must support signed retention-policy descriptors.
- How retention interacts with future legal/safety isolation requirements.
