# Phase 5.11 — Feed Primitive Schema Plan

- Status: Draft
- Date: 2026-06-30
- Spec: `docs/specification/06-social/feeds.md`
- ADR: ADR-002 (private payload envelope for `self`-scoped feed subscriptions)
- Depends on: Phase 5.11 UDR plan (feed subscriptions land in UDR), Phase 5.0 (Class D events)

## Scope

Define the protocol event kinds and local projection for FeedCollection, FeedGenerator, FeedSubscription, and FeedCursor. Deliver a pure `@lfp2p/feed-projection` package and Dexie schema additions in `@lfp2p/local-store`.

Feed *content* delivery (ranking, curation, bridge feed relay) is out of scope. This plan covers only the schema, event kinds, and local projection.

## Step 1 — `feed.*` event kinds in `packages/protocol`

New event kinds:

| Kind | Privacy | Consistency class |
|---|---|---|
| `feed.collection.created` | `self` or `public` | B |
| `feed.collection.updated` | `self` or `public` | B |
| `feed.collection.deleted` | `self` or `public` | B |
| `feed.subscription.added` | `self` | B |
| `feed.subscription.removed` | `self` | B |
| `feed.generator.published` | `public` | B |
| `feed.cursor.advanced` | `self` | D |

`self`-scoped kinds carry `PrivatePayloadEnvelopeV1`; bridge passes them opaque.
`public`-scoped kinds carry plaintext payloads.

One PR. Adds kinds to `EVENT_KINDS`, adds `validatePayloadForKind` privacy rules.

## Step 2 — Feed payload schemas (protocol fixtures)

Define payload schemas (inside `packages/protocol/src/index.ts` inline docs + fixture files):

```ts
// feed.collection.created payload
{ collectionId: string; name: string; description?: string; generatorIds: readonly string[]; createdAt: string }

// feed.subscription.added payload (inside encrypted envelope)
{ feedId: string; feedKind: 'collection' | 'generator' | 'space' | 'user'; addedAt: string }

// feed.generator.published payload
{ generatorId: string; kind: FeedGeneratorKind; config: JsonObject; publishedAt: string }

// feed.cursor.advanced payload (inside encrypted envelope)
{ feedId: string; cursor: string; advancedAt: string }
```

`FeedGeneratorKind` enum: `'local-chronological' | 'local-weighted' | 'space-operated' | 'friend-operated' | 'public-index' | 'semantic'`.

One PR. 6 valid + 4 invalid fixtures; no runtime changes.

## Step 3 — `@lfp2p/feed-projection` package

New package `packages/feed-projection/`:

- `FeedCollectionState` type (collectionId, name, generatorIds, appliedEventIds).
- `applyFeedEvent(state, payload, meta) → FeedCollectionState` pure state machine.
- `FeedSubscriptionState` (map of feedId → `{ feedKind, cursor?, addedAt }`).
- `applyFeedSubscriptionEvent(state, payload, meta) → FeedSubscriptionState`.
- `FEED_ERROR_CODES` stable error codes.
- Deep-frozen outputs, replay equivalence tests, fixture round-trip.

One PR. Pure; no Dexie or runtime imports.

## Step 4 — Feed tables in `@lfp2p/local-store`

Dexie schema v13 (or v12 if UDR schema hasn't landed yet; coordinate numbering):

- `feedCollections` table (PK: `collectionId`, index: `updatedAt`).
- `feedEventLog` table (PK: `eventId`, index: `kind, collectionId, createdAt`).
- `appendFeedEvent(event)` — idempotent on eventId, updates projection.
- `loadFeedCollectionState(collectionId) → FeedCollectionState`.
- `listFeedSubscriptions() → FeedSubscriptionState`.
- Route `feed.*` events in `processInboundSyncBatch`.

One PR. Feed projection stored encrypted for `self`-scoped collections (mirrors chat projection pattern: `encryptedState: EncryptedKeyMaterial`, `protectionKeyId`).

## Step 5 — PWA feed subscription surface

`apps/pwa/src/pwa-feed-state.ts`:

- `emitFeedSubscriptionAdded(store, feedId, feedKind)`.
- `emitFeedCursorAdvanced(store, feedId, cursor)`.
- `buildFeedSubscriptionsViewModel(store) → FeedSubscription[]`.

One PR. UI wiring only; no protocol changes.

## Package boundary rules

- `@lfp2p/feed-projection` MUST NOT import any local-store, sync-client, or app package.
- Feed ranking/curation logic belongs in `apps/pwa` or a future `@lfp2p/feed-runtime` package, not in the projection.
- `semantic` generator kind requires the Phase 22–25 semantic runtime; do not implement it here.

## Constraints

- `self`-scoped feed subscriptions and cursors MUST be encrypted at rest (same pattern as `StoredChatThreadProjection`).
- `public`-scoped feed generator publications MUST NOT carry sensitive user data.
- Phase 1.65 curation surface controls remain the authority for feed visibility filtering; feed projection emits raw candidates only.
