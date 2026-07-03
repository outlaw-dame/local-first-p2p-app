# Phase 5.11 — User Data Root Storage and Projection Plan

- Status: Draft
- Date: 2026-06-30
- Spec: `docs/specification/02-identity/user-data-root.md`
- ADR: ADR-001 (identity control log), ADR-002 (private payload envelope)
- Depends on: Phase 5.0 (private payload envelope), Phase 2.1 (identity control log)

## Scope

Implement the User Data Root (UDR) as a local-first logical container scoped to one Identity Root. The UDR tracks which partitions, replicas, feed subscriptions, sync interests, content-addressed objects, mailbox binding, and Spaces a user owns or has subscribed to, and provides a deterministic projection from signed events.

Sync checkpoints are not UDR state. They live in the sync store and are advanced by the sync engine. The UDR may reference sync interest configuration, but it MUST NOT claim or release checkpoint rows.

Out of scope: hosted UDR providers, cross-provider migration, P2P UDR replication (those belong to sync engine and availability provider phases).

## Identity binding

A UDR is bound to an Identity Root identifier, not to a provider account, mailbox address, app-view session, local database row, or raw device key.

Controller key material proves authority over the Identity Root. Authorized device keys may emit or sync UDR-related records only within their granted scope. This allows the same account to have multiple authorized devices and multiple replicas while preserving one logical user-owned data root.

## Step 1 — `StoredUserDataRoot` schema in `@lfp2p/local-store`

Add to `packages/local-store/src/index.ts`:

```ts
type StoredUserDataRoot = Readonly<{
  identityId: string; // Identity Root identifier this UDR belongs to, not a provider account or device key
  partitionIds: ReadonlyArray<string>;
  contentRefs: ReadonlyArray<string>; // ObjectRef keys the user claims
  syncInterestIds: ReadonlyArray<string>;
  feedSubscriptionIds: ReadonlyArray<string>;
  mailboxId?: string;
  spaceIds: ReadonlyArray<string>;
  updatedAt: string;
}>;
```

Dexie schema v12: add `userDataRoot` table keyed by `identityId`.

One PR. No new package. Passes existing local-store test suite.

## Step 2 — `udr.*` event kinds in `packages/protocol`

New event kinds (all `self` privacy, Class B):

| Kind                            | Payload                                               |
| ------------------------------- | ----------------------------------------------------- |
| `udr.partition.claimed`         | `{ partitionId, scope, claimedAt }`                   |
| `udr.partition.released`        | `{ partitionId, releasedAt }`                         |
| `udr.feed-subscription.added`   | `{ feedId, feedKind, addedAt }`                       |
| `udr.feed-subscription.removed` | `{ feedId, removedAt }`                               |
| `udr.sync-interest.added`       | `{ syncInterestId, interest: SyncInterest, addedAt }` |
| `udr.sync-interest.removed`     | `{ syncInterestId, removedAt }`                       |
| `udr.mailbox.bound`             | `{ mailboxId, boundAt }`                              |
| `udr.space.joined`              | `{ spaceId, joinedAt }`                               |
| `udr.space.left`                | `{ spaceId, leftAt }`                                 |

All `self`-scoped: MUST carry `PrivatePayloadEnvelopeV1`. Bridge MUST NOT inspect payload.

One PR. Add kinds to `EVENT_KINDS`, add `validatePayloadForKind` cases.

## Step 3 — `@lfp2p/udr-projection` package

New package `packages/udr-projection/`:

- `UdrState` type with partition set, feed subscription set, sync interest set, space set, and mailbox binding.
- `applyUdrEvent(state, decryptedPayload, meta) → UdrState` pure state machine.
- `createEmptyUdrState(identityId) → UdrState`.
- `UDR_ERROR_CODES` with `UDR_INVALID_PAYLOAD`, `UDR_UNKNOWN_KIND`.
- Deep-frozen outputs (Phase 3.2).
- Full fixture suite (valid + invalid payloads, duplicate no-op, replay equivalence).

One PR. Pure package, no runtime dependencies.

## Step 4 — `appendUdrEvent` + `loadUdrState` in `@lfp2p/local-store`

Wire projection into Dexie:

- `appendUdrEvent(event)` — idempotent on `eventId`, validates the signed event and privacy envelope, decrypts `PrivatePayloadEnvelopeV1` locally, validates the decrypted UDR payload, then updates the `userDataRoot` projection row.
- `decryptAndApplyUdrEvent(event, decryptOptions)` mirrors the chat decrypt-and-apply path; `applyUdrEvent` MUST NOT receive ciphertext.
- `loadUdrState(identityId) → UdrState` — replay event log by decrypting each UDR event before projection.
- `processInboundSyncBatch` dispatch: route `udr.*` events to `appendUdrEvent`.

One PR. Adds one Dexie integration test file, including an undecryptable payload placeholder/reject path that does not corrupt UDR state.

### Step 4 status (shipped) and a correction

Shipped in `@lfp2p/local-store`: `StoredUserDataRoot` (Step 1, Dexie v12), `appendUdrEvent`, `loadUdrState`, `listLocalUdrEvents`, and the internal decrypt seam. Refinements made during implementation:

- **Decrypt outside the Dexie transaction.** Awaiting WebCrypto inside a Dexie transaction triggers `PrematureCommitError`. The decrypt (async) runs first; the read-modify-write with the synchronous, pure `applyUdrEvent` runs inside the transaction. Idempotency is re-checked inside the transaction against the current row, so concurrent appends converge.
- **Self-healing via `appliedEventIds`.** An event that cannot be decrypted yet (`undecryptable`) is stored durably in `signedEvents` but left out of the projection; a later `appendUdrEvent`/`loadUdrState` with the key folds it in. A decrypted-but-invalid payload is `rejected` and NOT stored.
- **`processInboundSyncBatch` routing is deliberately deferred, NOT implemented.** `udr.*` events are `self`-scoped, and Phase 1.64 doctrine (`admission.ts`) is explicit that `self`/`device-local` **never traverse a bridge/relay/super-peer**. So the bridge does not deliver UDR events, and adding routing that could never fire — or, worse, widening `BRIDGE_ALLOWED_PRIVACY_SCOPES` to include `self` — would be dead code and a security regression respectively. The live path is local emit (Step 5) → `appendUdrEvent`. Cross-device UDR transport is the encrypted mailbox / account-local sync envelope (a separate deferred phase); inbound routing lands with that path.

## Step 5 — PWA UDR view

`apps/pwa/src/pwa-udr-state.ts`:

- `buildUdrViewModel(store, identityId) → UdrViewModel`.
- Emits `udr.*` events on partition claim/release, feed add/remove, sync interest add/remove, and space join/leave.

One PR. UI-only, no protocol changes.

## Package boundary rules

- `@lfp2p/udr-projection` MUST NOT import `@lfp2p/local-store`, `@lfp2p/sync-client`, or any app package.
- `@lfp2p/local-store` imports `@lfp2p/udr-projection` for state types only.
- No new ADR needed — UDR events are `self`-scoped which ADR-002 already covers.

## Constraints

- Bridge MUST NOT read UDR event payloads (they are `self`-scoped encrypted).
- `validatePayloadPrivacyScope` already enforces `self` → must have `PrivatePayloadEnvelopeV1`.
- Sync checkpoint rows remain sync-engine state. They are not claimed/released by UDR events and are not projected into `UdrState`.
- Existing `chatThreads`, `chatEventLog`, and all Phase 1.x local-store tables are unaffected.
