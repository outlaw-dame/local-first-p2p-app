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

All steps (1–6) are shipped:

- Step 1 + 3 (foundation, mirroring UDR #148): the seven `mailbox.*` kinds with per-kind privacy + consistency classes in `@lfp2p/protocol`, and `@lfp2p/mailbox-projection` (inbox/outbox lifecycle state machine + receipts/acks/checkpoints, truly-immutable collections, deterministic replay, recipient-mismatch IDOR guard) — plus `hydrateMailboxState` (Step 4a) so persistence can apply events per-envelope without duplicating the state machine.
- Step 4 (persistence): Dexie v13 tables (`mailboxInbox`/`mailboxOutbox`/`mailboxEventLog`/`mailboxCheckpoints`), `appendMailboxEvent` (decrypt-outside-txn + per-envelope apply inside-txn, dedup on a `projected` flag so undecryptable events self-heal, decrypt-to-party IDOR gate), `loadMailboxInboxState` (replay rebuild), and `getMailboxInbox`/`getMailboxOutbox`/`getMailboxCheckpoint`.
- Step 5 (expiry sweep): `sweepExpiredMailboxEnvelopes` on the store — scans the cleartext `expiresAt` index for owner rows still `queued`/`delivered`, and EMITS a signed `mailbox.envelope.expired` (reason `ttl`) through `appendMailboxEvent` so the event log stays the source of truth and replay reproduces expired state. Rows are never deleted.
- Step 2 (payload fixtures): a data-driven conformance suite in `@lfp2p/mailbox-projection` (`fixtures/{valid,invalid}` + `mailbox-fixtures.test.ts`) — 10 valid + 8 invalid decrypted-payload scenarios run through the real `applyMailboxEvent`, covering all seven kinds, visible/sealed/forwarded/self variants, and the `MAILBOX_RECIPIENT_MISMATCH` IDOR case. No runtime change.
- Step 6 (PWA surface): `apps/pwa/src/pwa-mailbox-state.ts` — `buildMailboxInboxViewModel` (deep-frozen, IDOR-filtered, no device-id leak), `emitMailboxEnvelopeQueued` (sender pinned to the emitter, `dm`/`group` conversation key) and `emitMailboxReceiptIssued` (`self` key), plus `createMailboxSweepRunner` (in-flight-deduped, coalesced, error-isolated) and the `sweepAfterForegroundSync` adapter for the app shell's existing foreground-sync `onResult` seam.

Refinements/decisions made during Step 4:

- **Per-envelope rows, not an aggregate.** A mailbox is high-cardinality; an aggregate blob (UDR-style) would grow unbounded and cost O(n) per append. Per-envelope rows keep append O(1) and let the Step 5 sweep query by `expiresAt`.
- **Derived cache + authoritative log.** `mailboxEventLog` (durable, dedup-authoritative) is the source of truth; inbox/outbox rows are a rebuildable cache. Index columns (`recipientIdentityId`/`senderIdentityId`, `status`, `expiresAt`) are cleartext for queries; consistent with the UDR precedent (derived cache cleartext, encrypted event log source), which departs from the plan's "encryptedState" suggestion — noted deliberately.
- **`processInboundSyncBatch` routing deferred (not dead-coded).** Mailbox `dm`/`group` events DO traverse the bridge, so routing is more relevant than for UDR — but it needs per-event decrypt-key resolution at the sync layer, which does not exist yet. The live path is caller-supplied event → `appendMailboxEvent`.

Refinements/decisions made during Step 5:

- **The sweep signature grew a key resolver.** The protocol pins `mailbox.envelope.expired` to `dm`/`group` privacy (delivery-plane, visible to both parties), so the sweep cannot encrypt to the owner's self key — the caller supplies `resolveEnvelopeKey(row)` (mirroring the `loadMailboxInboxState` resolver). Unresolvable envelopes are reported `skipped` and retried next sweep.
- **`fetched` envelopes are not swept.** The state machine is `queued/delivered → expired`; expiry destroys availability at the actor, and fetched content is already local. One event per envelope covers both inbox and outbox sides.
- **PWA lifecycle hookup (foreground resume / sync-batch completion) is Step 6's concern** — the sweep is a store method, callable but not yet called.

Refinements/decisions made during Step 6:

- **View model minimises exposure.** `MailboxInboxItem` surfaces a derived `addressing: 'sealed' | 'visible'` flag and deliberately omits the raw `recipientDeviceId`, so a device-pin can never leak through UI logs/analytics (plan constraint: sealed-vs-visible must not leak deviceId). `isExpired` is derived from `now` as well as terminal status, so availability shows as gone even before the local sweep emits the `expired` event.
- **Emit helpers, not app wiring.** Like `pwa-udr-state`, Step 6 ships tested helpers; the app shell wires them. `emitMailboxEnvelopeQueued` pins `senderIdentityId` to the emitter (anti-spoof) and takes a `dm`/`group` conversation key; `emitMailboxReceiptIssued` is `self`-scoped. `createMailboxSweepRunner` wraps the Step 5 sweep with in-flight dedup (no duplicate `expired` emits), a coalescing window (absorbs the online+visible burst), and error isolation (never throws into the sync lifecycle). Full retry/backoff is intentionally omitted — the sweep is local, idempotent, and its triggers are already rate-limited upstream.
- **App-shell sweep wiring still pending the same dependency as sync routing.** A real `dm`/`group` conversation-key resolver does not yet exist in the PWA, so the sweep runner is provided-but-unwired (a one-line `sweepAfterForegroundSync` in `root-app.tsx`'s existing `onResult` once key resolution lands). Not stubbed with a fake resolver.

Follow-up — inbound sync routing (post-Step-6):

- **`processInboundSyncBatch` mailbox routing shipped.** An opt-in `mailboxRouting` module in `@lfp2p/sync-client` (mirroring the reputation / MLS-group-control / capability-proof routers) folds each freshly-stored `mailbox.*` envelope into the projection via `store.appendMailboxEvent`, keyed by `ownerIdentityId` with a caller-supplied per-event `resolveKeyMaterial`. Failures surface in a privacy-safe `mailbox` summary (`applied` / `undecryptable` / `rejected` + error ids), never in the outer batch — the checkpoint always advances (forward progress). The store's decrypt-to-party gate is the authorization boundary, so an IDOR (recipient-mismatch) envelope is `rejected`, not projected — tested at the sync layer.
- **Self-heal without a key.** `appendMailboxEvent`'s `keyMaterial` is now optional: an inbound `dm`/`group` envelope whose conversation key is not yet resolvable is still recorded durably in `mailboxEventLog` as `undecryptable`, and folds in on a later `loadMailboxInboxState` once the key arrives. Nothing is lost while key management is pending.

Remaining (a separate subsystem, outside this plan): a `dm`/`group` **conversation-key source** (pairwise/group key agreement) that the sync router's `resolveKeyMaterial` and the sweep runner's `resolveEnvelopeKey` plug into. Chat is in the same pre-key-management state, so this is shared infrastructure, not mailbox-specific. Once it lands, wiring both seams (and `sweepAfterForegroundSync` in `root-app.tsx`) is a small adapter. Consistent with every other sync router in `@lfp2p/sync-client`, the app shell does not yet enable `mailboxRouting`.

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
