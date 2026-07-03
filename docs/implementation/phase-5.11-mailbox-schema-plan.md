# Phase 5.11 — Mailbox Schema and State Machine Plan

- Status: Draft
- Date: 2026-06-30
- Spec: `docs/specification/05-mailbox/mailbox.md`
- Related specs: `docs/specification/05-mailbox/delivery-envelopes.md`, `receipts-and-acks.md`, `retention-and-expiry.md`, `forwarding.md`
- ADR: ADR-002 (private payload envelope — mailbox envelopes are encrypted)
- Depends on: Phase 5.0 (private payload envelope), Phase 5.11 UDR plan (mailbox binding)

## Scope

Define the mailbox protocol event kinds, `MailboxDeliveryEnvelope` schema, and local projection (`@lfp2p/mailbox-projection`). Wire into `@lfp2p/local-store`. Mailbox HTTP server and actor are out of scope; this plan delivers the client-side schema and state machine only.

## Status

Steps 1 and 3 are shipped (the pure protocol + projection foundation, mirroring the UDR #148 pattern): the seven `mailbox.*` kinds with per-kind privacy + consistency classes in `@lfp2p/protocol`, and `@lfp2p/mailbox-projection` (inbox/outbox lifecycle state machine + receipts/acks/checkpoints, truly-immutable collections, deterministic replay, recipient-mismatch IDOR guard). Steps 2 (fixture suite), 4 (Dexie tables + decrypt seam), 5 (expiry sweep), and 6 (PWA view) remain.

## Step 1 — `mailbox.*` event kinds in `packages/protocol`

New event kinds:

| Kind                          | Privacy         | Consistency class |
| ----------------------------- | --------------- | ----------------- |
| `mailbox.envelope.queued`     | `dm` or `group` | D                 |
| `mailbox.envelope.delivered`  | `dm` or `group` | D                 |
| `mailbox.envelope.expired`    | `dm` or `group` | B                 |
| `mailbox.envelope.fetched`    | `self`          | D                 |
| `mailbox.receipt.issued`      | `self`          | D                 |
| `mailbox.ack.sent`            | `dm`            | D                 |
| `mailbox.checkpoint.advanced` | `self`          | D                 |

All non-`self` kinds carry `PrivatePayloadEnvelopeV1`. Bridge MUST NOT decrypt.

One PR. Kinds + privacy rules in `validatePayloadForKind`.

## Step 2 — Mailbox payload schemas

`mailbox.envelope.queued` carries the full delivery envelope inside the encrypted payload:

```ts
type MailboxDeliveryEnvelopePayload = Readonly<{
  envelopeId: string;
  recipientIdentityId: string;
  recipientDeviceId?: string; // sealed (device-specific) or visible (any device)
  senderIdentityId: string;
  contentRef: string; // ObjectRef key of the actual message content
  expiresAt: string; // ISO-8601; deletion destroys availability, not history
  forwardedFrom?: string; // envelopeId of original if forwarded
}>;
```

Lifecycle events carry minimized payloads rather than duplicating the full envelope:

```ts
// mailbox.envelope.delivered payload
{ envelopeId: string; deliveredAt: string; providerId?: string }

// mailbox.envelope.expired payload
{ envelopeId: string; expiredAt: string; reason: 'ttl' | 'quota' | 'policy' | 'sender-revoked' }

// mailbox.envelope.fetched payload (inside self-scoped envelope)
{ envelopeId: string; fetchedAt: string; recipientDeviceId: string }

// mailbox.receipt.issued payload (inside self-scoped envelope)
{ envelopeId: string; receiptId: string; receiptKind: 'provider-accepted' | 'recipient-fetched' | 'recipient-applied' | 'recipient-rejected'; issuedAt: string }

// mailbox.ack.sent payload
{ envelopeId: string; ackId: string; ackKind: 'applied' | 'rejected' | 'undecryptable'; sentAt: string }

// mailbox.checkpoint.advanced payload (inside self-scoped envelope)
{ mailboxId: string; checkpointId: string; cursor: string; advancedAt: string }
```

Visible vs sealed recipient addressing: `recipientDeviceId` present = sealed (only that device decrypts); absent = visible (any authorized device of the recipient decrypts).

One PR. 10 valid + 8 invalid fixtures; no runtime changes.

## Step 3 — `@lfp2p/mailbox-projection` package

New package `packages/mailbox-projection/`:

- `MailboxInboxState` type: map of envelopeId → `{ status: 'queued' | 'delivered' | 'fetched' | 'expired', envelope: MailboxDeliveryEnvelopePayload, deliveredAt?, fetchedAt?, expiredAt? }`.
- `applyMailboxEvent(state, payload, meta) → MailboxInboxState` pure state machine.
  - State machine: `queued → delivered → fetched` or `queued/delivered → expired` (terminal). Fetch of expired envelope is a no-op. Double-fetch is idempotent.
- `MailboxOutboxState` type: map of envelopeId → delivery status.
- `MAILBOX_ERROR_CODES` stable codes: `MAILBOX_INVALID_PAYLOAD`, `MAILBOX_ILLEGAL_TRANSITION`, `MAILBOX_RECIPIENT_MISMATCH`.
- Deep-frozen outputs; replay equivalence; fixture round-trip.

One PR. Pure package.

## Step 4 — Mailbox tables in `@lfp2p/local-store`

Dexie schema v13/v14:

- `mailboxInbox` table (PK: `envelopeId`, index: `recipientIdentityId, status, expiresAt`).
- `mailboxOutbox` table (PK: `envelopeId`, index: `senderIdentityId, status, createdAt`).
- `mailboxEventLog` table (PK: `eventId`, index: `kind, envelopeId, createdAt`).
- `appendMailboxEvent(event)` — idempotent, validates, decrypts payload locally when required, updates projection.
- `loadMailboxInboxState(identityId) → MailboxInboxState`.
- Projection stored encrypted (same pattern as chat: `encryptedState: EncryptedKeyMaterial`).
- Route `mailbox.*` in `processInboundSyncBatch`.

One PR.

## Step 5 — Expiry sweep + retention policy

`sweepExpiredMailboxEnvelopes(store, nowIso)`:

- Marks envelopes past `expiresAt` as expired; emits `mailbox.envelope.expired` with the minimized payload above.
- Does NOT delete the row — projection history preserved; only availability is gone.
- Called by PWA on foreground resume and on sync batch completion.

One PR. Adds expiry fixture tests.

## Step 6 — PWA mailbox view

`apps/pwa/src/pwa-mailbox-state.ts`:

- `buildMailboxInboxViewModel(store, identityId) → MailboxInboxItem[]`.
- `emitMailboxEnvelopeQueued(store, payload)` — for outbound sends.
- `emitMailboxReceiptIssued(store, envelopeId)` — after fetch.

One PR.

## Package boundary rules

- `@lfp2p/mailbox-projection` MUST NOT import local-store, sync-client, or bridge packages.
- Mailbox HTTP actor and server (future `apps/mailbox-service`) are NOT in this plan.
- Delivery-success ≠ replication-success: `mailbox.envelope.delivered` event merely records delivery to the mailbox actor; the UDR projection is the source of truth.

## Constraints

- All `dm`/`group` mailbox events carry encrypted payloads; bridge stores them opaquely.
- `expiredAt` semantics: destroys availability (the actor drops the blob), NOT the event history or decrypted content already held by the recipient.
- Sealed vs visible addressing MUST NOT leak deviceId to non-recipients.
