# Phase 5.11 — Feed Primitive Schema Plan

- Status: Draft
- Date: 2026-06-30
- Spec: `docs/specification/06-social/feeds.md`
- ADR: ADR-002 (private payload envelope for `self`-scoped feed subscriptions)
- Depends on: Phase 5.11 UDR plan (feed subscriptions land in UDR), Phase 5.0 (Class D events)

## Scope

Define the protocol event kinds and local projection for FeedCollection, FeedGenerator, FeedSubscription, and FeedCursor. Deliver a pure `@lfp2p/feed-projection` package and Dexie schema additions in `@lfp2p/local-store`.

Feed *content* delivery (ranking, curation, bridge feed relay) is out of scope. This plan covers only the schema, event kinds, and local projection.

Feed subscriptions are UDR-owned state. This plan may expose a feed subscription view, but it MUST derive from `udr.feed-subscription.*` events rather than introducing a second authoritative feed subscription event family.

## Step 1 — `feed.*` event kinds in `packages/protocol`

New event kinds:

| Kind | Privacy | Consistency class |
|---|---|---|
| `feed.collection.created` | `self` or `public` | B |
| `feed.collection.updated` | `self` or `public` | B |
| `feed.collection.deleted` | `self` or `public` | B |
| `feed.generator.published` | `public` | B |
| `feed.cursor.advanced` | `self` | D |

`self`-scoped kinds carry `PrivatePayloadEnvelopeV1`; bridge passes them opaque.
`public`-scoped kinds carry plaintext payloads.

Subscription add/remove events are intentionally not `feed.*` kinds. They are emitted as `udr.feed-subscription.added` and `udr.feed-subscription.removed` so the UDR remains the single authoritative source for user-owned feed subscriptions.

One PR. Adds kinds to `EVENT_KINDS`, adds `validatePayloadForKind` privacy rules.

## Step 2 — Feed payload schemas (protocol fixtures)

Define payload schemas (inside `packages/protocol/src/index.ts` inline docs + fixture files):

```ts
// feed.collection.created payload
{ collectionId: string; name: string; description?: string; generatorIds: readonly string[]; createdAt: string }

// feed.collection.updated payload
{ collectionId: string; name?: string; description?: string | null; generatorIds?: readonly string[]; updatedAt: string }

// feed.collection.deleted payload
{ collectionId: string; deletedAt: string; tombstoneReason?: string }

// feed.generator.published payload
{ generatorId: string; kind: FeedGeneratorKind; config: JsonObject; publishedAt: string }

// feed.cursor.advanced payload (inside encrypted envelope)
{ feedId: string; cursor: string; advancedAt: string }
```

`FeedGeneratorKind` enum: `'local-chronological' | 'local-weighted' | 'space-operated' | 'friend-operated' | 'public-index' | 'semantic'`.

One PR. 7 valid + 5 invalid fixtures; no runtime changes.

## Step 3 — `@lfp2p/feed-projection` package

New package `packages/feed-projection/`:

- `FeedCollectionState` type (collectionId, name, generatorIds, deletedAt?, appliedEventIds).
- `applyFeedEvent(state, payload, meta) → FeedCollectionState` pure state machine.
- `FeedSubscriptionViewState` derived from UDR feed-subscription events; it is not an authority log.
- `applyDerivedFeedSubscriptionEvent(state, udrPayload, meta) → FeedSubscriptionViewState`.
- `FEED_ERROR_CODES` stable error codes.
- Deep-frozen outputs, replay equivalence tests, fixture round-trip.

One PR. Pure; no Dexie or runtime imports.

## Step 4 — Feed tables in `@lfp2p/local-store`

Dexie schema v13 (or v12 if UDR schema hasn't landed yet; coordinate numbering):

- `feedCollections` table (PK: `collectionId`, index: `updatedAt`).
- `feedEventLog` table (PK: `eventId`, indexes: `kind, targetId, createdAt` and `targetId, createdAt`).
- Every logged feed event stores a required `targetId` derived from `collectionId`, `generatorId`, or `feedId` so IndexedDB indexes do not depend on optional fields.
- `appendFeedEvent(event)` — idempotent on eventId, updates projection.
- `loadFeedCollectionState(collectionId) → FeedCollectionState`.
- `listFeedSubscriptions()` derives from UDR feed-subscription projection.
- Route `feed.*` events in `processInboundSyncBatch`; route feed subscription add/remove through UDR.

One PR. Feed projection stored encrypted for `self`-scoped collections (mirrors chat projection pattern: `encryptedState: EncryptedKeyMaterial`, `protectionKeyId`).

## Step 5 — PWA feed subscription surface

`apps/pwa/src/pwa-feed-state.ts`:

- `emitFeedSubscriptionAdded(store, feedId, feedKind)` emits `udr.feed-subscription.added`.
- `emitFeedSubscriptionRemoved(store, feedId)` emits `udr.feed-subscription.removed`.
- `emitFeedCursorAdvanced(store, feedId, cursor)` emits `feed.cursor.advanced`.
- `buildFeedSubscriptionsViewModel(store) → FeedSubscription[]` reads the derived UDR-owned subscription projection.

One PR. UI wiring only; no protocol changes.

## Package boundary rules

- `@lfp2p/feed-projection` MUST NOT import any local-store, sync-client, or app package.
- Feed ranking/curation logic belongs in `apps/pwa` or a future `@lfp2p/feed-runtime` package, not in the projection.
- `semantic` generator kind requires the Phase 22–25 semantic runtime; do not implement it here.

## Constraints

- `self`-scoped feed collections and cursors MUST be encrypted at rest (same pattern as `StoredChatThreadProjection`).
- `public`-scoped feed generator publications MUST NOT carry sensitive user data.
- UDR remains the single authoritative source for feed subscriptions; feed projections may derive views from it but MUST NOT emit a competing Class B subscription log.
- Phase 1.65 curation surface controls remain the authority for feed visibility filtering; feed projection emits raw candidates only.
