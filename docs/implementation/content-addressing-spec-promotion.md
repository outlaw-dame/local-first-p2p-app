# Content Addressing → Protocol Specification Promotion

- Status: Draft
- Date: 2026-06-30
- Scope: promote the existing content-addressing and object-reference slice into the newer data, sync, availability, and mailbox specification model
- Related implementation:
  - `packages/content-addressing`
  - `docs/implementation/phase-1.56-content-addressing-plan.md`
  - `docs/protocol/content-addressing.md`
  - `docs/threat-model/content-addressing-abuse.md`
- Related specifications:
  - `docs/specification/03-data/object-references.md`
  - `docs/specification/03-data/content-refs.md`
  - `docs/specification/03-data/merkle-checkpoints.md`
  - `docs/specification/03-data/entity-component-snapshots.md`
  - `docs/specification/04-sync/portable-sync-drops.md`
  - `docs/specification/04-sync/checkpoints.md`
  - `docs/specification/05-mailbox/delivery-envelopes.md`
  - future `docs/specification/07-availability/`

## Purpose

The content-addressing slice predates the implementation-independent `docs/specification/` tree.

This document promotes that work into the newer specification model so the existing `DigestRef`, `ContentLink`, `BlockRef`, `ObjectRef`, `BundleRef`, and `StorageLocationHint` vocabulary remains first-class and does not fragment into duplicate media, evidence, mailbox, feed, sync, or provider reference types.

## Current implemented / planned slice

The Phase 1.56 plan established a shared vocabulary:

- `DigestRef`;
- `ContentLink`;
- `BlockRef`;
- `ObjectRef`;
- `BundleRef`;
- `StorageLocationHint`.

The doctrine was explicit:

- references are protocol-level objects;
- validation MUST NOT fetch content;
- CIDs are compatible links, not IPFS dependency or availability proof;
- content addressing does not imply permission, safety, moderation state, user consent, durability, or authority;
- later surfaces should not invent `blobHash`, `evidenceHash`, `documentId`, `sourceHash`, or protocol-specific CID fields.

## Specification mapping

| Existing term | Specification owner | Promotion rule |
|---|---|---|
| `DigestRef` | `03-data/content-refs.md`, `03-data/object-references.md` | Canonical digest descriptor. It proves byte identity only, not authorization or availability. |
| `ContentLink` | `03-data/content-refs.md` | CID-compatible content link. It MUST remain network-neutral and IPFS-optional. |
| `BlockRef` | `03-data/content-refs.md`, `04-sync/portable-sync-drops.md` | Reference to a block-level payload unit. Useful for media, bundles, and sync drops. |
| `ObjectRef` | `03-data/object-references.md` | Canonical protocol object reference used by messages, feeds, reports, evidence, media, mailbox envelopes, and sync. |
| `BundleRef` | `03-data/content-refs.md`, `04-sync/portable-sync-drops.md` | Reference to a bounded content bundle or future Portable Sync Drop component. |
| `StorageLocationHint` | future `07-availability/provider-descriptors.md` | Provider/location hint only. It MUST NOT become authority, proof of persistence, or global availability. |

## Required doctrine boundaries

### Reference is not authority

A content reference proves identity of bytes or object material only within its declared scheme.

It MUST NOT prove:

- authorization;
- actor authority;
- device authority;
- space membership;
- mailbox acceptance;
- safety;
- moderation approval;
- provider durability;
- user consent;
- display permission.

### Link is not fetch

Validation of a `ContentLink`, `ObjectRef`, `BlockRef`, or `BundleRef` MUST NOT perform network fetches.

Fetching is an availability/runtime concern and must be governed by local policy, privacy policy, provider policy, and object-specific validation.

### CID-compatible is not IPFS-dependent

The protocol may support CID-compatible links, but it MUST NOT require IPFS routing, public pinning, public availability, or IPFS-specific identity.

### Location hint is not storage authority

A `StorageLocationHint` may tell a peer where bytes might be found.

It MUST NOT claim that the provider owns the object, that the object is safe, that access is authorized, or that the object will remain available.

### Bundle is not user-state acceptance

A bundle can carry records, payloads, or references.

Importing or receiving a bundle MUST NOT imply durable apply, display consent, mailbox acceptance, or social trust.

## Consumers

Existing and future consumers should use the promoted reference vocabulary.

### Data model

Entities, Components, Snapshots, LinkRefs, and Object References should use `ObjectRef`, `ContentLink`, `BlockRef`, or `BundleRef` instead of inventing local reference fields.

### Mailbox

Delivery Envelopes should use Object References or Bundle References for deferred payloads and attachments.

Mailbox provider storage hints should remain provider-scoped availability hints.

### Sync

Selective Replica Sync should use references for headers-first sync, lazy payload fetch, checkpoint comparison, and Portable Sync Drop manifests.

### Feeds and Collections

Feed Candidate Sets and Collection entries should reference objects by canonical Object Reference or Snapshot Reference where later mutation would change meaning.

### Trust & Safety

Reports, appeals, labels, moderation evidence, scanner results, curation signals, and quarantine records should use Object References rather than custom evidence hash fields.

### Availability providers

Bridges, relays, super-peers, media caches, object stores, and public indexes may advertise Storage Location Hints or provider descriptors, but these hints remain subordinate to protocol validation.

## Promotion stages

### Stage CA-P1 — Documentation promotion

Status: this document.

Exit criteria:

- Existing content-addressing terms are mapped into Series 3/4/5/7 specs.
- Doctrine boundaries are explicit.
- Future runtime docs are required to use the shared terms.

### Stage CA-P2 — Spec glossary and registry alignment

Update the specification glossary/registries if any of these terms are missing or inconsistent:

- DigestRef;
- ContentLink;
- BlockRef;
- ObjectRef;
- BundleRef;
- StorageLocationHint;
- Content Bundle;
- Object Reference;
- Storage Location Hint.

### Stage CA-P3 — Runtime audit

Audit current packages and docs for duplicate reference terms such as:

- `blobHash`;
- `evidenceHash`;
- `documentId` for protocol objects;
- `sourceHash`;
- IPFS-specific `cid` assumptions;
- ad hoc media hashes;
- mailbox attachment hashes.

Any true duplicates should be migrated or explicitly documented as local-only implementation fields.

### Stage CA-P4 — Availability mapping

When Series 7 availability specs begin, define how `StorageLocationHint` maps into provider descriptors for:

- bridge store;
- relay store;
- super-peer store;
- HTTPS provider;
- S3-compatible provider;
- IPFS-compatible provider;
- Hypercore-compatible provider;
- native file store;
- local cache;
- OPFS/IndexedDB block store.

### Stage CA-P5 — Portable Sync Drop packaging

Define how `BundleRef` and Content Bundle metadata map into Portable Sync Drop manifests and import validation.

## Deferred work

The promotion preserves these known deferrals:

- BLAKE3 runtime support;
- additional multibase parsers;
- media manifest integration;
- malware/scanner verdict integration;
- CAR import/export runtime;
- Hypercore/Corestore full-peer storage;
- bridge production object storage;
- search/recommendation provenance integration;
- availability-provider descriptors.

## Immediate engineering gates

Before implementing media manifests, mailbox attachments, feed candidate payloads, moderation evidence bundles, or Portable Sync Drops, ensure that the implementation:

1. uses the promoted reference vocabulary;
2. does not fetch during validation;
3. does not treat references as authorization;
4. does not treat storage hints as durable availability;
5. records local-only implementation fields as non-protocol fields;
6. adds tests for malformed references, unsupported codecs, unsafe URLs, and authority confusion.

## Tests required by promotion

Future PRs SHOULD include tests proving:

- content-link validation performs no network access;
- unsupported codec/version is rejected;
- malformed digest length is rejected;
- URLs with credentials are rejected in location hints;
- a valid reference does not grant access to private payloads;
- a valid provider hint does not imply provider authority;
- bundle import still validates each contained record;
- mailbox deferred payload fetch does not apply content without payload validation;
- moderation evidence references are exact and snapshot-pinned where required.

## Current status

The content-addressing slice remains foundational and should be treated as the canonical reference vocabulary for protocol objects and payloads.

It is not an availability layer, not a storage backend, and not a safety/authorization layer.

It MUST be extended through the specification mapping above rather than replaced by feature-specific hashes or provider-specific links.
