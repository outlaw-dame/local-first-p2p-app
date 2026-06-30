# Phase 5.11 — User Data Root Storage and Projection Plan

- Status: Draft
- Date: 2026-06-30
- Spec: `docs/specification/02-identity/user-data-root.md`
- ADR: ADR-001 (identity control log), ADR-002 (private payload envelope)
- Depends on: Phase 5.0 (private payload envelope), Phase 2.1 (identity control log)

## Scope

Implement the User Data Root (UDR) as a local-first logical container scoped to one identity. The UDR tracks which partitions, replicas, and content-addressed objects a user owns or has subscribed to, and provides a deterministic projection from signed events.

Out of scope: hosted UDR providers, cross-provider migration, P2P UDR replication (those belong to sync engine and availability provider phases).

## Step 1 — `StoredUserDataRoot` schema in `@lfp2p/local-store`

Add to `packages/local-store/src/index.ts`:

```ts
type StoredUserDataRoot = Readonly<{
  identityId: string;             // controller identity this UDR belongs to
  partitionIds: ReadonlyArray<string>;
  contentRefs: ReadonlyArray<string>; // ObjectRef keys the user claims
  syncCheckpointIds: ReadonlyArray<string>;
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

| Kind | Payload |
|---|---|
| `udr.partition.claimed` | `{ partitionId, scope, claimedAt }` |
| `udr.partition.released` | `{ partitionId, releasedAt }` |
| `udr.feed-subscription.added` | `{ feedId, feedKind, addedAt }` |
| `udr.feed-subscription.removed` | `{ feedId, removedAt }` |
| `udr.mailbox.bound` | `{ mailboxId, boundAt }` |
| `udr.space.joined` | `{ spaceId, joinedAt }` |
| `udr.space.left` | `{ spaceId, leftAt }` |

All `self`-scoped: MUST carry `PrivatePayloadEnvelopeV1`. Bridge MUST NOT inspect payload.

One PR. Add kinds to `EVENT_KINDS`, add `validatePayloadForKind` cases.

## Step 3 — `@lfp2p/udr-projection` package

New package `packages/udr-projection/`:

- `UdrState` type with partition set, feed subscription set, space set, mailbox binding.
- `applyUdrEvent(state, payload, meta) → UdrState` pure state machine.
- `createEmptyUdrState(identityId) → UdrState`.
- `CHAT_ERROR_CODES`-style `UDR_ERROR_CODES` with `UDR_INVALID_PAYLOAD`, `UDR_UNKNOWN_KIND`.
- Deep-frozen outputs (Phase 3.2).
- Full fixture suite (valid + invalid payloads, duplicate no-op, replay equivalence).

One PR. Pure package, no runtime dependencies.

## Step 4 — `appendUdrEvent` + `loadUdrState` in `@lfp2p/local-store`

Wire projection into Dexie:

- `appendUdrEvent(event)` — idempotent on `eventId`, validates via protocol layer, updates `userDataRoot` projection row.
- `loadUdrState(identityId) → UdrState` — replay log through `applyUdrEvent`.
- `processInboundSyncBatch` dispatch: route `udr.*` events to `appendUdrEvent`.

One PR. Adds one Dexie integration test file.

## Step 5 — PWA UDR view

`apps/pwa/src/pwa-udr-state.ts`:

- `buildUdrViewModel(store, identityId) → UdrViewModel`.
- Emits `udr.*` events on partition claim/release, feed add/remove, space join/leave.

One PR. UI-only, no protocol changes.

## Package boundary rules

- `@lfp2p/udr-projection` MUST NOT import `@lfp2p/local-store`, `@lfp2p/sync-client`, or any app package.
- `@lfp2p/local-store` imports `@lfp2p/udr-projection` for state types only.
- No new ADR needed — UDR events are `self`-scoped which ADR-002 already covers.

## Constraints

- Bridge MUST NOT read UDR event payloads (they are `self`-scoped encrypted).
- `validatePayloadPrivacyScope` already enforces `self` → must have `PrivatePayloadEnvelopeV1`.
- Existing `chatThreads`, `chatEventLog`, and all Phase 1.x local-store tables are unaffected.
