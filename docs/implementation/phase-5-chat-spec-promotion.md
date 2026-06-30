# Phase 5 Chat Slice → Protocol Specification Promotion

- Status: Draft
- Date: 2026-06-30
- Scope: preserve and promote the existing encrypted chat vertical slice into the newer mailbox, social, sync, identity, and data specifications
- Related implementation:
  - `docs/implementation/phase-5-chat-plan.md`
  - `packages/protocol/src/index.ts`
  - `packages/protocol/src/consistency-classes.ts`
  - `packages/chat-projection/src/index.ts`
  - `packages/chat-projection/src/index.test.ts`
  - `apps/bridge-service/src/phase-5-chat.test.ts`
- Related specifications:
  - `docs/specification/02-identity/identity-root.md`
  - `docs/specification/02-identity/device-model.md`
  - `docs/specification/02-identity/user-data-root.md`
  - `docs/specification/02-identity/replica-model.md`
  - `docs/specification/03-data/data-partitions.md`
  - `docs/specification/03-data/entity-component-snapshots.md`
  - `docs/specification/03-data/object-references.md`
  - `docs/specification/04-sync/selective-replica-sync.md`
  - `docs/specification/04-sync/sync-interests.md`
  - `docs/specification/04-sync/checkpoints.md`
  - `docs/specification/04-sync/low-bandwidth-profile.md`
  - `docs/specification/04-sync/portable-sync-drops.md`
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/05-mailbox/delivery-envelopes.md`
  - `docs/specification/05-mailbox/receipts-and-acks.md`
  - `docs/specification/05-mailbox/retention-and-expiry.md`
  - `docs/specification/06-social/spaces.md`
  - `docs/specification/06-social/channels.md`
  - `docs/specification/06-social/threads.md`
  - `docs/specification/06-social/feeds.md`
  - `docs/specification/06-social/collections.md`
  - `docs/specification/06-social/roles.md`

## Purpose

The Phase 5 encrypted chat vertical slice was implemented before the newer implementation-independent protocol specification series was written.

This document promotes that slice into the newer specification model so it is not lost, abandoned, or allowed to drift into an application-only design.

The existing chat slice remains valid foundation work. The promotion work is to make its boundaries explicit and to identify the exact implementation steps needed to align it with the mailbox, social, data, sync, and identity specs.

## Current implemented slice

The current slice includes:

- five first-class `chat.*` event kinds:
  - `chat.thread.created`
  - `chat.thread.accepted`
  - `chat.message.sent`
  - `chat.message.edited`
  - `chat.message.deleted`
- protocol privacy enforcement: chat events are `dm` or `group` only;
- `PrivatePayloadEnvelopeV1` requirement for all chat events;
- Class D consistency classification for encrypted chat events;
- bridge ciphertext-opacity tests proving the bridge admits valid encrypted envelopes without decrypting payloads;
- `@lfp2p/chat-projection` local decrypted projection package;
- projection tests for create/send/edit/delete/accept, idempotency, replay equivalence, deep-freeze behavior, and plaintext purge on local delete.

## Current non-implemented pieces from the original chat plan

The original Phase 5 chat plan still contains planned items that are not yet fully integrated:

- Dexie `chatThreads` and `chatEventLog` table integration (schemas are defined in `packages/local-store`, but active read/write/rebuild integration is pending);
- PWA `ThreadList`;
- PWA `ThreadView`;
- PWA `ComposeBox`;
- compose-side integration with the encrypted envelope builder;
- receive-side persistent decrypt/project/store flow;
- explicit mailbox delivery objects;
- mailbox receipts/ACKs;
- Space/Channel mapping;
- Feed/Collection mapping.

These are not abandoned. They become the next promotion stages below.

## Layer mapping

| Existing chat concept | New protocol owner | Promotion rule |
|---|---|---|
| `chat.thread.created` | Social Thread, optional Channel/Space context | Keep as encrypted private Thread creation for DM/small-group chat; add parent context fields later for Channel/Space threads. |
| `chat.thread.accepted` | Mailbox/Thread invitation acceptance boundary | Keep as encrypted acceptance state for DM threads; later distinguish recipient acceptance from provider delivery receipt. |
| `chat.message.sent` | Social message Entity + encrypted payload Component | Keep as encrypted Class D message event; later map payload body to encrypted Component/Object Reference where payloads grow. |
| `chat.message.edited` | Message lifecycle state machine | Keep as Class D until a richer message lifecycle spec splits content mutation from tombstone/lifecycle events. |
| `chat.message.deleted` | Message lifecycle / tombstone | Keep deletion behavior but document that local plaintext purge is projection-local; protocol deletion/tombstone semantics need mailbox/social lifecycle rules. |
| `PrivatePayloadEnvelopeV1` | Data/security payload envelope | Keep as required encrypted payload carrier for `dm`/`group` chat events. |
| Bridge delivery request | Availability/bridge transport | Keep bridge ciphertext-opaque; do not treat bridge acceptance as recipient delivery or durable apply. |
| `ChatThreadState` | Local application projection | Keep as local decrypted projection, not canonical protocol state. |
| `appliedEventIds` | Projection idempotency | Keep; later align with selective sync checkpoints and event-log replay. |
| `replyToMessageId` | Thread parent/reference | Keep; later promote to Thread parent reference / Snapshot reference where evidence or quote semantics matter. |

## Required doctrine boundaries

### Message is not mailbox

A chat message event is social content.

A mailbox Delivery Envelope is delivery state.

Implementations MUST NOT collapse these into one object when mailbox implementation begins.

### Delivery is not durable acceptance

Bridge or mailbox provider acceptance only means a provider accepted an encrypted envelope for service-specific handling.

Recipient durable acceptance occurs only after recipient-side fetch, decrypt, validation, local policy, and apply.

### Projection is not authority

`ChatThreadState` is a local decrypted projection.

It MUST NOT be treated as canonical protocol authority, mailbox authority, Space authority, or sync authority.

### Thread is not always Channel

A DM/small-group thread can exist without a Space or Channel.

When the app supports Discord-like Spaces and Channels, Channel-backed chat MUST add explicit Space/Channel context instead of overloading `threadId` alone.

### Delete is not provider expiry

`chat.message.deleted` currently purges plaintext from local projection and marks a message deleted.

Mailbox provider expiry, local plaintext purge, social tombstone, and legal/safety retention are distinct concepts and MUST remain distinct.

## Promotion stages

### Stage P5-C1 — Documentation promotion and conformance matrix

Status: this document.

Exit criteria:

- Existing chat events are mapped to mailbox/social/sync/data specs.
- Remaining implementation gaps are explicitly listed.
- Future chat work is required to cite this promotion document.

### Stage P5-C2 — Chat persistence boundary

Implement active local-store integration:

- `chatThreads` and `chatEventLog` table integration (schemas and migration are already defined in `packages/local-store`);
- encrypted-at-rest projection storage;
- projection rebuild from event log;
- reopen/replay tests;
- no plaintext log leakage tests.

This stage should keep `@lfp2p/chat-projection` pure.

### Stage P5-C3 — Mailbox-aligned delivery boundary

Introduce mailbox-compatible delivery objects without changing chat payload semantics:

- Delivery Envelope wrapper for chat submissions;
- sender outbox state;
- recipient inbox state;
- provider-accepted receipt;
- recipient-fetched receipt;
- recipient-applied ACK or local-only equivalent;
- expiry/retry state;
- tests proving provider acceptance does not imply recipient acceptance.

### Stage P5-C4 — Sync-aligned chat replay

Align chat event replay with Selective Replica Sync:

- Sync Interest for a thread;
- checkpointed thread event range;
- headers-first event fetch;
- lazy payload fetch;
- idempotent replay;
- low-bandwidth mode with message headers/object refs before payload bytes.

### Stage P5-C5 — Social context promotion

Extend chat context to social primitives:

- DM thread with no Space/Channel;
- group thread with participant set;
- Space-backed Channel thread;
- Thread parent/root reference semantics;
- optional Feed Collection exposure for Channel streams;
- role/capability checks for Channel writes.

### Stage P5-C6 — PWA chat surface

Implement the UI only after persistence and mailbox boundaries are in place:

- Thread list;
- Thread view;
- compose box;
- decrypt failure placeholder;
- blocked-peer compose gate;
- local delivery state indicators that distinguish queued, provider accepted, fetched, applied, failed, and undecryptable.

## Immediate engineering gates

Before adding more user-facing chat features, the next PRs should be:

1. `docs/implementation/phase-5-chat-spec-promotion.md` — this document.
2. Local-store chat persistence PR.
3. Mailbox delivery-envelope wrapper PR.
4. Sync Interest/checkpoint chat replay PR.
5. Space/Channel context PR.
6. PWA chat UI PR.

## Tests required by promotion

Future chat PRs SHOULD add tests for:

- provider accepted does not equal recipient accepted;
- envelope present but payload undecryptable yields placeholder, not crash;
- duplicate event replay is idempotent;
- duplicate `messageId` does not mutate original message;
- delete purges plaintext projection but does not pretend to delete provider history;
- bridge never imports decrypt helpers;
- mailbox provider never sees plaintext;
- Channel-backed chat rejects unauthorized writer;
- Sync Interest does not grant access by itself;
- low-bandwidth mode transfers headers before large payloads.

## Current status

The chat slice is promoted as the first encrypted Messaging/Social vertical slice foundation.

It is not complete protocol chat yet.

It MUST be extended through the mailbox, sync, persistence, and social-context stages above rather than replaced or ignored.
