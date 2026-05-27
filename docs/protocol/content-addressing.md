# Content Addressing and Object References

- Status: Draft
- Date: 2026-05-27
- Related ADRs:
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related threat models:
  - `docs/threat-model/content-addressing-abuse.md`
  - `docs/threat-model/trust-safety-and-abuse.md`
- Future package:
  - `packages/content-addressing`

## Purpose

This document defines the protocol-level content-addressing and object-reference model for the local-first P2P/hybrid architecture.

The model is **CID-compatible but not IPFS-dependent**. A CID is a self-describing content identifier / content link concept, not a requirement to store or retrieve through IPFS. The protocol must be able to reference content stored in a browser local block store, OPFS, IndexedDB, bridge object store, super-peer store, HTTPS/S3/Filebase, IPFS-compatible store, CAR archive, or future native/full-peer storage adapter without making any storage backend authoritative.

## Design goals

1. Represent exact byte/block identity.
2. Support CID/IPLD-compatible links without requiring IPFS.
3. Support simple digest-only references where a CID is unnecessary.
4. Support encrypted and unencrypted content.
5. Support media manifests, reports, evidence bundles, safety labels, quarantine records, search objects, and bridge admission.
6. Support future CAR-like bundle import/export.
7. Support future full-peer storage/replication adapters.
8. Keep content integrity separate from authority, privacy, safety, and availability.

## Non-goals

This model does not:

- require IPFS,
- define content routing or DHT behavior,
- define permanent availability,
- define account authority,
- define moderation policy,
- grant read permissions,
- imply that a location hint is trustworthy,
- imply that a content-addressed object is safe to render or replicate,
- replace event signatures or identity-control semantics.

## Layer model

```text
DigestRef
  raw digest metadata

ContentLink
  CID/IPLD-compatible self-describing content link

BlockRef
  immutable block reference with digest/link/size/codec/encryption/compression/location metadata

ObjectRef
  semantic protocol object reference: event, record, media, label, report, bundle, URL, etc.

BundleRef
  CAR-like export/import/sync bundle reference

StorageLocationHint
  non-authoritative retrieval hint
```

## DigestRef

`DigestRef` is the lowest-level integrity reference.

```ts
type DigestAlgorithm = 'sha-256' | 'blake3';

type DigestEncoding = 'base64url' | 'hex' | 'bytes';

type DigestRef = {
  version: 'lfp2p.digest-ref.v1';
  algorithm: DigestAlgorithm;
  encoding: DigestEncoding;
  value: string;
};
```

Rules:

- `algorithm`, `encoding`, and `value` are required.
- Unknown algorithms fail closed.
- `value` must be validated against the declared encoding.
- `sha-256` digests must decode to exactly 32 bytes.
- `blake3` digests should decode to the configured digest length; default full digest should be 32 bytes unless a future ADR permits extendable-output variants.
- Validators must not silently coerce hex/base64url/bytes encodings.
- Digest comparison must use decoded bytes, not display strings.

Initial algorithm policy:

- `sha-256` is required because it is already common across web APIs, ATProto blob CIDs, and broad interoperability.
- `blake3` is reserved for future local/full-peer performance-sensitive block stores and dedupe, but implementation may defer support until a concrete adapter needs it.

## ContentLink

`ContentLink` represents a CID/IPLD-compatible content link.

```ts
type ContentLinkKind = 'cid';

type ContentCodec =
  | 'raw'
  | 'dag-cbor'
  | 'dag-json'
  | 'dag-pb'
  | 'dcel-cbor'
  | 'drisl-cbor'
  | 'car-v1'
  | 'car-v2'
  | 'lfp2p-bundle-v1';

type ContentLink = {
  version: 'lfp2p.content-link.v1';
  kind: ContentLinkKind;
  cid: string;
  cidVersion: 1;
  codec: ContentCodec;
  digest: DigestRef;
  multibase?: 'base32' | 'base36' | 'base58btc';
};
```

Rules:

- `kind` is currently only `cid`.
- `cidVersion` must be `1` for new objects.
- CIDv0 must not be emitted by this protocol.
- CIDv0 may be parsed only by a compatibility adapter if a future migration requires it.
- `codec` must be allowlisted.
- `digest` must match the CID's multihash when CID parsing is implemented.
- `cid` must never be interpreted as an IPFS URL.
- A `ContentLink` is not a storage location and does not imply availability.

Codec policy:

- `raw`: opaque bytes, common for blobs/media.
- `dag-cbor`: structured IPLD-compatible data.
- `dag-json`: debug/import/export only unless explicitly approved.
- `dag-pb`: compatibility only.
- `dcel-cbor` / `drisl-cbor`: reserved for ATProto-compatible data model mapping.
- `car-v1` / `car-v2`: bundle/container references, not single object payloads.
- `lfp2p-bundle-v1`: local protocol bundle format if CAR is insufficient.

Security notes:

- CID validation must not fetch content.
- Codec validation must not decode content unless size limits and parser safety checks pass.
- Location hints must be evaluated separately.

## StorageLocationHint

A location hint tells a runtime where it might retrieve a block. It is never authority.

```ts
type StorageLocationType =
  | 'local-cache'
  | 'indexeddb-block-store'
  | 'opfs-block-store'
  | 'bridge-store'
  | 'relay-store'
  | 'super-peer-store'
  | 'https'
  | 's3-compatible'
  | 'filebase'
  | 'ipfs-compatible'
  | 'car-archive'
  | 'hypercore-compatible'
  | 'native-file-store';

type StorageLocationHint = {
  version: 'lfp2p.storage-location-hint.v1';
  type: StorageLocationType;
  serviceId?: string;
  url?: string;
  priority?: number;
  expiresAt?: string;
};
```

Rules:

- Location hints are optional.
- Location hints must not be trusted for integrity.
- Integrity is verified by digest/content link after retrieval.
- Location hints may be omitted from private objects to reduce metadata leakage.
- `url` must reject embedded credentials.
- `url` must be normalized and validated by the caller before network use.
- `priority`, if present, must be a finite safe integer.
- Expired hints may be ignored.

## BlockRef

A `BlockRef` identifies an immutable block.

```ts
type CompressionDescriptor = {
  algorithm: 'none' | 'zstd' | 'gzip' | 'brotli';
  uncompressedByteLength?: number;
  dictionaryRef?: BlockRef;
};

type EncryptionDescriptor = {
  encrypted: boolean;
  envelopeRef?: string;
  algorithm?: 'aes-gcm-256' | 'xchacha20-poly1305';
  keyScope?: 'device-local' | 'self' | 'dm' | 'group' | 'community' | 'public';
};

type BlockRef = {
  version: 'lfp2p.block-ref.v1';
  blockId: string;
  digest: DigestRef;
  link?: ContentLink;
  byteLength: number;
  codec: ContentCodec | string;
  mediaType?: string;
  encryption: EncryptionDescriptor;
  compression?: CompressionDescriptor;
  locations?: readonly StorageLocationHint[];
};
```

Rules:

- `blockId`, `digest`, `byteLength`, `codec`, and `encryption` are required.
- `byteLength` must be a finite non-negative safe integer.
- Maximum block size is adapter-specific but must be bounded.
- If `link` is present, its digest must match `digest`.
- `codec` must match or be compatible with `link.codec` when `link` is present.
- `mediaType` is advisory and must be verified/sniffed for media processing.
- Encrypted blocks must not be decoded as plaintext.
- Compression must be bounded by decoded-size limits before decompression.
- Compression dictionaries must be trusted or content-addressed and bounded.
- Location hints must not be treated as authority.

Privacy rules:

- Private blocks should not include public location hints unless intentionally replicated.
- Cross-scope dedupe is disabled by default for encrypted/private content.
- Public and private blocks must not share projection tables that leak private access patterns.

## ObjectRef

`ObjectRef` is the semantic reference used by higher-level systems.

```ts
type ObjectRef =
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'event';
      eventId: string;
      block?: BlockRef;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'record';
      collection: string;
      rkey: string;
      actorId?: string;
      block: BlockRef;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'media';
      mediaId: string;
      manifest: BlockRef;
      variants?: readonly BlockRef[];
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'safety-label';
      labelId: string;
      block?: BlockRef;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'report';
      reportId: string;
      block?: BlockRef;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'policy-decision';
      decisionId: string;
      block?: BlockRef;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'bundle';
      bundle: BundleRef;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'url';
      normalizedUrl: string;
      digest?: DigestRef;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'domain';
      domain: string;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'actor';
      actorId: string;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'community';
      communityId: string;
    }
  | {
      version: 'lfp2p.object-ref.v1';
      type: 'infrastructure';
      infrastructureType: 'bridge' | 'relay' | 'super-peer' | 'public-index' | 'media-store';
      infrastructureId: string;
    };
```

Rules:

- Object refs must use the narrowest accurate type.
- Media labels/reports should target `media` refs or block refs, not only URLs.
- URL refs must be normalized.
- Domain refs must be normalized and punycode-aware once URL tooling exists.
- Actor/community refs are identity/control refs, not content refs.
- Infrastructure refs are local policy subjects.

## BundleRef

`BundleRef` references a CAR-like bundle, import/export unit, evidence package, or sync batch.

```ts
type BundlePurpose =
  | 'repo-export'
  | 'repo-diff'
  | 'media-batch'
  | 'safety-label-bundle'
  | 'moderation-evidence-bundle'
  | 'bridge-sync-batch'
  | 'full-peer-replication-batch'
  | 'portable-profile-export';

type BundleRef = {
  version: 'lfp2p.bundle-ref.v1';
  bundleId: string;
  format: 'car-v1' | 'car-v2' | 'lfp2p-bundle-v1';
  purpose: BundlePurpose;
  roots: readonly BlockRef[];
  digest: DigestRef;
  byteLength: number;
  encrypted: boolean;
  locations?: readonly StorageLocationHint[];
  createdAt: string;
};
```

Rules:

- `roots` must not be empty.
- `byteLength` must be bounded.
- The bundle digest covers the serialized bundle bytes.
- Bundle roots must be validated before traversal.
- Bundle traversal must be bounded by max blocks, max bytes, max depth, and max decode size.
- Evidence bundles are encrypted by default.
- Bridge sync batches must not mix private and public material unless explicitly encrypted and scoped.

## Media manifest dependency

Media manifests must build on `BlockRef` and `ObjectRef` instead of inventing separate hash/CID fields.

Future media manifest shape should include:

- original content block where preserved,
- processed content block,
- thumbnail/poster blocks,
- MIME/sniffed type,
- dimensions/duration,
- alt text and accessibility metadata,
- safety scan state,
- quarantine state,
- dedupe scope,
- storage location hints,
- encryption scope,
- replication policy.

## Trust and safety dependency

Trust and safety uses `ObjectRef` / `BlockRef` for:

- safety subjects,
- media labels,
- evidence bundles,
- report bodies,
- appeals,
- quarantine records,
- transport admission decisions,
- curation explanations,
- search/recommendation exclusion provenance.

Rules:

- A T&S object targeting content should identify the exact object when available.
- Private evidence uses encrypted block/bundle refs.
- Public labels should not leak private evidence refs.
- Quarantine records should target exact `BlockRef`/`ObjectRef` values.
- Rejected/quarantined blocks are not globally deleted.

## Bridge / relay / super-peer dependency

Transport infrastructure may use content references for:

- duplicate detection,
- replay detection,
- malware/media hash matching,
- quarantine queues,
- admission decisions,
- storage quotas,
- replication policy,
- abuse audit events.

Rules:

- Infrastructure must verify content digest after retrieval.
- Infrastructure must not fetch arbitrary location hints without policy checks.
- Infrastructure may refuse to store/forward blocks by local policy.
- Infrastructure must not pretend local refusal is global deletion.
- Infrastructure must avoid cross-scope dedupe leakage.

## Search and recommendation dependency

Search/recommendation systems may use object refs for provenance and delete/quarantine propagation.

Rules:

- Public search must ingest only public-safe refs.
- Private `dm`/`group` objects must not enter public search or public recommendation flows.
- Search objects must preserve subject refs so tombstones/quarantine/exclusion can be applied.
- Curation explanations may cite object refs but must not leak private signals.

## Package boundary

`packages/content-addressing` should be pure TypeScript and have no dependency on:

- PWA UI,
- local-store/Dexie,
- bridge-service runtime,
- sync-client transport,
- trust-safety runtime,
- media processing runtime.

It may depend on small internal shared validation helpers only if those helpers are protocol-safe and have no storage/network/UI dependency.

Initial files:

```text
packages/content-addressing/package.json
packages/content-addressing/src/index.ts
packages/content-addressing/src/digest.ts
packages/content-addressing/src/content-link.ts
packages/content-addressing/src/block-ref.ts
packages/content-addressing/src/object-ref.ts
packages/content-addressing/src/bundle-ref.ts
packages/content-addressing/src/location-hint.ts
packages/content-addressing/src/validation.ts
packages/content-addressing/src/index.test.ts
packages/content-addressing/fixtures/valid/
packages/content-addressing/fixtures/invalid/
```

## Validation requirements

Validators must reject:

- unknown major versions,
- missing required fields,
- unsupported digest algorithms,
- malformed digest encoding,
- digest length mismatch,
- unsupported CID version,
- unsupported codec,
- CID digest mismatch when CID parsing exists,
- negative or non-finite byte length,
- unsafe compression metadata,
- unbounded decompression size,
- malformed URLs,
- URL credentials,
- unsupported location hint types,
- empty bundle roots,
- unbounded bundle traversal metadata,
- private objects with public-only refs where policy forbids it.

Validators must not:

- fetch content,
- decode untrusted codecs by default,
- coerce strings/numbers/enums,
- accept blank strings as absent values,
- accept unsafe integers,
- treat `mediaType` as authoritative,
- treat location hints as authoritative.

## Fixture requirements

Required valid fixtures:

- minimal SHA-256 `DigestRef`,
- minimal CIDv1 `ContentLink`,
- raw unencrypted `BlockRef`,
- encrypted private `BlockRef`,
- compressed bounded `BlockRef`,
- event `ObjectRef`,
- media `ObjectRef`,
- report/evidence `ObjectRef`,
- CAR-like `BundleRef`,
- bridge-store `StorageLocationHint`.

Required invalid fixtures:

- unknown major version,
- unsupported digest algorithm,
- malformed digest value,
- digest length mismatch,
- unsupported CID version,
- unsupported codec,
- negative byte length,
- non-finite byte length,
- compressed object with unbounded decoded size,
- URL with credentials,
- empty bundle roots,
- private block with unsafe public location hint,
- malformed object ref,
- bundle traversal over configured limits.

## Logging rules

Allowed in logs:

- redacted digest prefix,
- object type,
- codec,
- bounded size,
- decision id,
- reason code,
- policy version,
- redacted storage location type.

Forbidden in logs:

- private plaintext,
- decrypted report/evidence body,
- full private access URLs,
- credentials embedded in location URLs,
- private block contents,
- raw encrypted key material,
- private user preference graphs.

## Implementation order

1. Add `packages/content-addressing` with validators only.
2. Add fixture packs.
3. Integrate `ObjectRef` into trust-safety subject refs.
4. Add local-store metadata planning.
5. Add bridge admission/quarantine planning.
6. Add media manifest planning.
7. Add bundle/CAR import/export planning.
8. Only then implement media manifests, public search indexing, or super-peer replication.
