# ADR-005: Content Addressing and Object References v1

- Status: Proposed
- Date: 2026-05-27
- Deciders: Damon / project maintainers
- Related docs:
  - `docs/protocol/content-addressing.md`
  - `docs/threat-model/content-addressing-abuse.md`
  - `docs/implementation/phase-1.56-content-addressing-plan.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/protocol/trust-safety-event-policy.md`
- Related PRs: TBD

## Context

The repository currently has signed event envelopes, source references, canonical JSON helpers, SHA-256 helper primitives, local storage, bridge delivery, and sync checkpoints. It does not yet have a protocol-wide content-addressing model, media manifests, chunked storage, CAR-like bundles, or object references that can be shared safely across trust and safety, media, bridge admission, public search, and future full-peer replication.

The project needs a content-addressing model before implementing:

- media manifests and media safety,
- trust and safety labels, reports, evidence bundles, and quarantine records,
- bridge/relay/super-peer dedupe and admission policy,
- public social outbox and public indexing,
- semantic search and recommendation object provenance,
- compression/chunking/dedupe,
- full-peer storage/replication adapters,
- cross-protocol adapters.

The model must not confuse CIDs with IPFS. A CID is a content identifier / content link concept from IPLD and multiformats. IPFS is one network/storage system that uses CIDs, but CIDs can also be used without IPFS. ATProto is the closest social-protocol example: it uses CIDs, IPLD-compatible data, Merkle Search Tree repositories, and CAR files, while relying on PDS/account authority rather than the IPFS network.

External reference anchors:

- ATProto repository spec: https://atproto.com/specs/repository
- ATProto data model: https://atproto.com/specs/data-model
- ATProto blob spec: https://atproto.com/specs/blob
- IPLD data model: https://ipld.io/docs/data-model/
- Content Addressable aRchives: https://ipld.io/specs/transport/car/
- Willow protocol concepts: https://willowprotocol.org/
- Tahoe-LAFS architecture: https://tahoe-lafs.readthedocs.io/
- Hypercore/Holepunch/Pear ecosystem: https://docs.pears.com/

## Decision

Adopt a protocol-level content-addressing and object-reference model that is **CID-compatible but not IPFS-dependent**.

The model introduces these layers:

1. **DigestRef**
   - Raw cryptographic digest metadata.
   - Used for integrity checks where a full CID/content link is not needed.

2. **ContentLink**
   - CID/IPLD-compatible self-describing content link.
   - Used for blocks, records, blobs, bundles, and exported/imported object graphs.
   - May use CIDv1 + codec + multihash + multibase-compatible representation.
   - Does not imply IPFS retrieval.

3. **BlockRef**
   - Immutable block reference with digest, optional CID/content link, byte length, codec, encryption, compression, and location hints.
   - Used for dedupe, verification, quarantine, local block stores, bridge/super-peer stores, media manifests, and evidence bundles.

4. **ObjectRef**
   - Higher-level protocol object reference.
   - Points to events, records, media, actors, reports, labels, policy decisions, bundles, URLs, domains, communities, or infrastructure objects.
   - Used by trust and safety, curation, search, media, bridge admission, and replication.

5. **BundleRef**
   - CAR-like or local-first bundle reference.
   - Used for repo exports, diffs, media batches, safety label bundles, moderation evidence bundles, bridge sync batches, and future full-peer replication.

6. **StorageLocationHint**
   - Non-authoritative retrieval hint.
   - May point to local cache, bridge store, relay store, super-peer store, HTTPS, S3/Filebase, IPFS-compatible gateway, Hypercore-compatible backend, or another adapter.
   - A location hint is never authority and never proof of integrity.

## Scope

This decision applies to:

- protocol objects:
  - content references,
  - object references,
  - media manifests,
  - evidence bundles,
  - safety labels/reports/annotations,
  - bridge/relay/super-peer admission decisions,
  - public search objects,
  - future repository/bundle exports,
  - future chunking/compression descriptors.
- storage schemas:
  - browser local block store,
  - OPFS/IndexedDB block storage,
  - local-store metadata projections,
  - bridge object store,
  - super-peer object store,
  - future native/full-peer block stores.
- runtime adapters:
  - PWA light peer,
  - bridge-service,
  - future relay/super-peer,
  - future native/Bare/Hypercore-compatible full peer,
  - future Filebase/S3/IPFS-compatible storage adapter.
- security/privacy boundaries:
  - content integrity,
  - encrypted blocks,
  - private evidence,
  - media scanning,
  - dedupe scope,
  - quarantine policy,
  - location-hint trust.
- tests/fixtures:
  - digest validation,
  - CID/content-link validation,
  - block/object/bundle validation,
  - invalid codec/hash/size behavior,
  - private/public routing behavior,
  - dedupe/quarantine behavior.

This decision does not apply to:

- adopting IPFS as the required storage or retrieval network,
- adopting ATProto's full repository model wholesale,
- adopting Hypercore as the protocol object identity model,
- implementing media manifests immediately,
- implementing full CAR import/export immediately,
- implementing content routing/DHT behavior immediately,
- guaranteeing permanent availability for all content.

## Canonical principle

Content addressing answers:

> Are these bytes or structured blocks the exact object I expected?

It does not answer:

> Am I allowed to read this?
> Should I replicate this?
> Is this legal/safe?
> Is this globally deleted?
> Where is the authoritative copy?
> Who controls this object?
> Who may moderate this object?

Those are separate protocol/policy layers:

- identity-control answers who controls identities/devices/capabilities,
- private payload envelopes answer confidentiality,
- trust and safety answers moderation/curation/admission,
- storage adapters answer retrieval/availability,
- sync checkpoints answer delivery/resume correctness.

## Object identity rules

### Event identity

Signed events keep their own event identity and signature semantics.

A future event may also have a `BlockRef` for its serialized/canonical block form, but event validity depends on protocol validation and signature verification, not merely the block digest.

Rules:

- `eventId` is the event-level identity.
- `BlockRef` is optional content-addressed representation.
- Event canonicalization must be deterministic before any event-level digest/signature is used.
- JSON event payloads must not be hashed as raw user-provided JSON unless canonicalization is locked.

### Record identity

Future mutable record/repository objects should distinguish:

- logical collection/key identity,
- current record block/content link,
- signed commit/root if a repository model is used,
- storage location hints.

This allows ATProto-like repo semantics later without making every object an ATProto object.

### Media identity

Media should be content-addressed from the start of media implementation.

Media identity should include:

- original content reference where preserved,
- processed/transcoded content reference,
- thumbnail/poster content references,
- digest/CID-compatible links,
- MIME and sniffed type,
- byte length,
- decoded dimensions/duration,
- encryption state,
- scan/quarantine state,
- dedupe scope,
- location hints.

### Safety object identity

Labels, reports, appeals, annotations, quarantine records, and evidence bundles may refer to `ObjectRef`/`BlockRef` targets.

Rules:

- A safety label against a media blob should target the content-addressed block or media manifest, not only a URL.
- A report with evidence should reference encrypted evidence blocks/bundles.
- A quarantine decision should reference the exact block/object that was quarantined.
- A bridge-local decision must not imply global deletion of the block.

## Options considered

### Option A: Plain SHA-256 strings everywhere

Pros:

- Simple.
- Already close to current helper primitives.
- Easy to test.

Cons:

- Loses codec/content-type/hash-algorithm context.
- Harder to interoperate with ATProto/IPLD/CAR-style systems.
- Easy to misuse across raw bytes vs structured objects.
- Does not scale cleanly to bundles, DAGs, media variants, or future full-peer storage.

### Option B: CID/IPLD-only everywhere

Pros:

- Strong interoperability with IPLD/CAR-style systems.
- Clean object graph linking.
- Familiar from ATProto and IPFS-adjacent tooling.

Cons:

- Too strict for all local-first/PWA objects.
- May force unnecessary IPLD codecs into simple local state.
- Could confuse contributors into assuming IPFS storage/networking.
- Does not fit every event, local projection, or private preference object.

### Option C: Layered digest/content-link/block/object/bundle model

Pros:

- CID-compatible without IPFS dependency.
- Works for simple digests and structured IPLD-like blocks.
- Supports local-first stores, bridge stores, super-peer stores, CAR-like bundles, media manifests, and future full peers.
- Separates content integrity from authority, routing, privacy, and policy.
- Lets trust and safety target exact content objects without assuming global storage.

Cons:

- More types to implement.
- Requires careful validation and fixture discipline.
- Requires UI/docs clarity around content refs vs authority vs availability.

## Consequences

Positive consequences:

- Media, reports, evidence, labels, and bridge admission can target exact objects.
- Bridges/super-peers can dedupe and quarantine by digest/content link.
- Public search/recommendation can preserve provenance without relying on URLs.
- Future CAR-like export/import is possible.
- Future ATProto adapters can map record/blob CIDs into `ContentLink`/`BlockRef`.
- Future Hypercore/Bare full-peer adapters can store/replicate blocks without changing protocol object references.
- Filebase/S3/IPFS-compatible storage can be used as a backend without defining the protocol.

Negative consequences / tradeoffs:

- Additional package and fixtures are needed before media/T&S expansion.
- Block/object refs need size and codec validation to prevent resource abuse.
- Content-addressed public retrieval can amplify harmful content if policy is weak.
- Deduplication can leak correlation if applied across privacy scopes incorrectly.
- Encrypted and unencrypted content need separate handling.

## Security and privacy impact

- Private data affected:
  - encrypted media,
  - encrypted report bodies,
  - encrypted evidence bundles,
  - private group/DM attachments,
  - local-only cached blocks.
- Metadata exposed:
  - digests/CIDs,
  - block sizes,
  - codecs,
  - media types,
  - location hints,
  - bundle roots,
  - quarantine refs.
- New trust assumptions:
  - content refs prove integrity, not safety or authorization,
  - location hints are untrusted,
  - codec parsers are attack surfaces,
  - dedupe scope must be privacy-aware,
  - bridge/super-peer CAS operators can observe access patterns unless mitigated.
- Abuse/failure modes:
  - malicious block substitution,
  - codec confusion,
  - hash algorithm downgrade,
  - oversized block/resource exhaustion,
  - decompression bombs,
  - malicious CAR/bundle graphs,
  - private/public dedupe leakage,
  - content-addressed abuse persistence,
  - poisoned location hints,
  - illegal/malware content replication by content hash.
- Required tests:
  - digest parse/validation,
  - CID/content-link parse/validation,
  - codec allowlist enforcement,
  - byte-length and decoded-length checks,
  - encrypted block ref handling,
  - location-hint non-authority behavior,
  - malformed bundle rejection,
  - private/public dedupe isolation.

## Migration and compatibility

- Existing code affected:
  - `packages/protocol` may eventually reference `ObjectRef` / `BlockRef`.
  - `packages/crypto` may provide digest helpers used by `packages/content-addressing`.
  - `packages/local-store` may add metadata tables and local block storage adapters.
  - `apps/bridge-service` may add object admission/quarantine records.
  - `packages/trust-safety` will use `ObjectRef` / `BlockRef` for subjects/evidence.
- Storage migration needed:
  - none for this ADR alone.
  - future implementation requires versioned local-store schema changes.
- Fixture updates needed:
  - valid/invalid digest refs,
  - valid/invalid content links,
  - valid/invalid block refs,
  - valid/invalid object refs,
  - valid/invalid bundle refs,
  - malformed codec/hash/size/location fixtures.
- Full-peer compatibility notes:
  - content refs must not assume browser-only storage,
  - content refs must not assume bridge authority,
  - full-peer adapters may use Hypercore/Corestore/Hyperdrive, but protocol object references remain backend-neutral,
  - native/full-peer adapters must preserve the same digest/content-link validation behavior.

## Exit criteria

This ADR is implemented when:

- [ ] `docs/protocol/content-addressing.md` exists.
- [ ] `docs/threat-model/content-addressing-abuse.md` exists.
- [ ] `docs/implementation/phase-1.56-content-addressing-plan.md` exists.
- [ ] `packages/content-addressing` exists with pure TypeScript validation helpers.
- [ ] `DigestRef`, `ContentLink`, `BlockRef`, `ObjectRef`, `BundleRef`, and `StorageLocationHint` have validators.
- [ ] Valid and invalid fixtures exist for all content-addressing objects.
- [ ] Tests reject malformed digests, unsupported codecs, unsafe sizes, unsafe compression metadata, and untrusted location hints.
- [ ] Trust and safety subjects can reference `ObjectRef` / `BlockRef` without importing bridge/UI/local-store code.
- [ ] Media manifest planning consumes the content-addressing model instead of inventing separate blob IDs.
- [ ] Bridge/super-peer admission planning distinguishes content integrity from policy enforcement.
