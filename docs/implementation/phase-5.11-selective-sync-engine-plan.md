# Phase 5.11 — Selective Sync Engine Plan

- Status: Draft
- Date: 2026-06-30
- Spec: `docs/specification/04-sync/selective-replica-sync.md`
- ADR: ADR-003 (sync offsets and cursors), ADR-009 (P2P runtime adapters)
- Depends on: Phase 4.4 (Durable Streams), Phase 5.11 UDR plan

## Scope

Define and implement the `SyncEngine` interface layer that abstracts over all transport adapters (bridge HTTP, mailbox fetch, WebRTC DataChannel, Portable Sync Drop, Hypercore, low-bandwidth local). The current `@lfp2p/sync-client` HTTP bridge path becomes the first concrete adapter behind this interface.

Out of scope: WebRTC DataChannel transport (belongs to roadmap Phase 10), Hypercore transport (Phase 20B), mailbox fetch adapter (needs mailbox implementation first).

## Step 1 — `SyncEngine` interface in `@lfp2p/sync-client`

Add to `packages/sync-client/src/index.ts`:

```ts
interface SyncTransport {
  readonly transportId: string;
  readonly kind: 'bridge' | 'mailbox' | 'webrtc' | 'sync-drop' | 'hypercore' | 'local';
  push(batch: ReadonlyArray<SignedEventEnvelope>): Promise<PushResult>;
  pull(cursor: string | undefined, limit: number): Promise<PullResult>;
  subscribe?(onRecord: (env: SignedEventEnvelope) => void): Unsubscribe;
}

interface SyncEngine {
  registerTransport(transport: SyncTransport): void;
  sync(opts?: SyncOptions): Promise<SyncResult>;
}
```

One PR. Types only; no runtime changes.

## Step 2 — Wrap existing HTTP bridge adapter

Wrap the current `HttpBridgeSyncClient` as a `SyncTransport` with `kind: 'bridge'`:

- Extract `push`/`pull` from `HttpBridgeSyncClient` into `BridgeTransport` class.
- `BridgeTransport` is the only concrete adapter in this step.
- `SyncEngine.sync()` delegates to registered transports in priority order.
- Existing `processInboundSyncBatch` dispatch remains unchanged.

One PR. No behavior change; existing tests must continue to pass.

## Step 3 — Partition-aware sync filter

Add `SyncInterest` evaluation:

- `SyncInterest` type from `docs/specification/04-sync/sync-interests.md`:
  `{ partitionId?, kindFilter?, privacyFilter?, maxLag? }`.
- `SyncEngine` holds a `ReadonlyArray<SyncInterest>` set per identity.
- On pull, only envelopes matching at least one declared interest are persisted.
- Interests are stored in `userDataRoot.feedSubscriptionIds` partition (UDR plan Step 1).

One PR. Adds interest-filter unit tests; existing integration tests add a broad-match interest to stay green.

## Step 4 — Low-bandwidth mode

Implement the headers-first profile from `docs/specification/04-sync/low-bandwidth-profile.md`:

- `LowBandwidthSyncOptions` flag on `SyncOptions`.
- When enabled: pull event headers only (kind, eventId, author, createdAt, privacy) before payload.
- Defer full payload fetch for media-scoped events until explicitly requested.
- Add `fetchPayload(eventId)` to `SyncTransport` interface.

One PR. Requires `BridgeTransport` to implement `fetchPayload` (simple second GET by eventId).

## Step 5 — Sync checkpoint persistence hardening

Align checkpoint behavior with `docs/specification/04-sync/checkpoints.md`:

- `StoredSyncCheckpoint` gains optional `interestHash: string` field — cursor is scoped to a (transport, interest) pair, not just (sourceId, streamId).
- `advanceSyncCheckpoint` validates that interest hash matches before advancing.
- Dexie schema v13: add `interestHash` index.

One PR. Migration: existing checkpoints without `interestHash` are treated as broad-match cursors.

## Package boundary rules

- `@lfp2p/sync-client` owns `SyncEngine`, `SyncTransport`, `SyncInterest`.
- Transport adapters for WebRTC, mailbox, Hypercore MUST live in separate packages (`@lfp2p/webrtc-transport`, `@lfp2p/mailbox-transport`, `@lfp2p/hypercore-transport`) and implement `SyncTransport` — they do NOT live in sync-client core.
- No new ADR needed; ADR-003 and ADR-009 already cover the cursor and adapter model.

## Constraints

- `processInboundSyncBatch` validation gates (signature, schema, privacy-scope) MUST run before persisting any record regardless of transport.
- Bridge ciphertext-opaqueness doctrine (Phase 1.63) is transport-agnostic — applies to every transport adapter, not only bridge HTTP.
- Existing `inbound-sync.test.ts` and `http-bridge-integration.test.ts` suites must remain green.
