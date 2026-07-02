# Phase 5.11 — Portable Sync Drop Plan

- Status: Draft
- Date: 2026-06-30
- Spec: `docs/specification/04-sync/portable-sync-drops.md`
- ADR: ADR-002 (private payload envelope — drop contents are encrypted), ADR-005 (content addressing — drop uses ObjectRef/BlockRef)
- Depends on: Phase 5.0 (private payload envelope), Phase 1.56 (content addressing)

## Scope

Implement Portable Sync Drop creation and import on the client side. A Sync Drop is a bounded, verifiable, encrypted bundle of signed events and associated content blocks that can be transferred over any available medium (file, Bluetooth, USB, QR, Hypercore, IPFS-compatible block bundle).

The transport layer (Bluetooth pairing, local Wi-Fi transfer, QR display/scan) is platform-specific and out of scope. This plan delivers the serialization, validation, and import pipeline.

## Step 1 — `SyncDropManifest` schema in `packages/protocol`

New exported types:

```ts
type SyncDropManifest = Readonly<{
  version: 'lfp2p.sync-drop.v1';
  dropId: string;
  createdAt: string;
  expiresAt?: string;
  creatorIdentityId: string;
  recipientIdentityIds?: ReadonlyArray<string>; // sealed drop; absent = open
  partitionIds: ReadonlyArray<string>;
  eventCount: number;
  rootDigest: string; // DigestRef over canonical manifest-without-rootDigest + sorted event digests
  encryptedPayloadKeyWraps?: ReadonlyArray<PayloadKeyRecipientWrap>; // from ADR-002
}>;
```

No new event kinds in this step — the drop is a transport artifact, not a protocol event.

The root digest MUST bind the canonical manifest fields used for import policy (`recipientIdentityIds`, `partitionIds`, `expiresAt`, `eventCount`, and key-wrap metadata) together with the event/block digests. A consumer MUST NOT rely on unbound manifest fields for sealed/scoped import decisions.

One PR. Type exports only; 6 valid + 4 invalid fixture files.

## Step 2 — `@lfp2p/sync-drop` package

New package `packages/sync-drop/`:

### Create side

```ts
async function createSyncDrop(
  events: ReadonlyArray<SignedEventEnvelope>,
  opts: CreateSyncDropOptions
): Promise<{ manifest: SyncDropManifest; blocks: ReadonlyArray<Uint8Array> }>;
```

- Validates each event via `validateSignedEvent` before inclusion.
- Builds a canonical manifest with `rootDigest` omitted, computes event digests over canonical-JSON-serialized events sorted ascending by eventId, then computes `rootDigest` over the canonical manifest digest plus the sorted event digests.
- Encrypts drop payload key to each recipient's device public key (ADR-002 `PayloadKeyRecipientWrap`).
- Returns a manifest + array of raw blocks (events in canonical-JSON form).

### Import side

```ts
async function importSyncDrop(
  manifest: SyncDropManifest,
  blocks: ReadonlyArray<Uint8Array>,
  opts: ImportSyncDropOptions
): Promise<ImportSyncDropResult>;
```

- Recomputes the canonical manifest digest and `rootDigest` against blocks before any event is processed.
- Rejects the entire drop if the manifest has been rewritten or any block fails digest verification.
- For each valid block: validates event via `validateSignedEvent`, yields to caller's `onEvent` callback (caller persists via `appendSignedEvent`).
- `ImportSyncDropResult`: `{ accepted: number; rejected: number; reasons: string[] }`.

One PR. No runtime network dependencies; pure crypto + protocol.

## Step 3 — File serialization format

`serializeSyncDrop(manifest, blocks) → Uint8Array`:

- Wire format: length-prefixed CBOR or simple binary with 8-byte magic header `\x6c\x66\x70\x32\x73\x64\x72\x70` ("lfp2sdrp").
- Manifest serialized as UTF-8 JSON in the first segment; blocks follow as length-prefixed binary segments.
- `parseSyncDropFile(bytes) → { manifest, blocks }` inverse.
- Magic header rejection for non-drop files; size cap at 256 MiB.

One PR. Adds round-trip serialization tests, manifest-rewrite rejection test, and tampered-block rejection test.

## Step 4 — Local-store integration

`apps/pwa/src/pwa-sync-drop-state.ts`:

- `createSyncDropFromLocalStore(store, partitionIds, recipientIds?) → Blob`.
  Queries `signedEvents` table, calls `createSyncDrop`, serializes, returns browser Blob for download/share.
- `importSyncDropFromFile(store, file) → ImportSyncDropResult`.
  Reads file Blob, parses, calls `importSyncDrop`, each `onEvent` calls `store.appendSignedEvent`.

One PR. Uses existing `store.appendSignedEvent` — no new Dexie tables needed.

## Step 5 — QR manifest preview (small drops)

For drops of ≤ 50 events, add a QR code path:

- `encodeManifestAsQrPayload(manifest) → string` — compact JSON of manifest fields only (no blocks).
- Companion device scans QR, gets manifest, fetches blocks via nearby Wi-Fi or Bluetooth (platform-specific).
- Not implemented here beyond the `encodeManifestAsQrPayload` helper; platform transport is out of scope.

One PR. Helper + tests only.

## Package boundary rules

- `@lfp2p/sync-drop` MUST NOT import local-store, sync-client, bridge, or app packages.
- Crypto operations (encrypt/decrypt, digest) delegated to `@lfp2p/crypto` and `@lfp2p/content-addressing`.
- Bluetooth/Wi-Fi/USB/QR transport adapters belong in `apps/pwa` platform code, not in the package.

## Constraints

- Drop contents MUST pass `validateSignedEvent` individually; malformed events MUST NOT be persisted even if the drop's root digest is valid.
- Drop manifest MUST NOT leak plaintext payload content even for `device-local`-scoped events (include headers only).
- Import MUST be idempotent: re-importing a drop that's already been applied is a no-op at the per-event level (existing `appendSignedEvent` idempotency covers this).
- Phase 1.63 ciphertext-opaqueness doctrine applies: the import path MUST NOT decrypt ciphertext to validate or filter events.
