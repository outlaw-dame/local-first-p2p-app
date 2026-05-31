# Phase 1.56 - Content Addressing and Object Reference Model

- Status: Draft implementation plan
- Date: 2026-05-27
- Related ADRs:
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related protocol docs:
  - `docs/protocol/content-addressing.md`
  - `docs/protocol/trust-safety-event-policy.md`
- Related threat models:
  - `docs/threat-model/content-addressing-abuse.md`
  - `docs/threat-model/trust-safety-and-abuse.md`

## Summary

Phase 1.56 inserts a required content-addressing and object-reference gate between the current doctrine/protocol hardening work and the trust and safety/media/search expansion work.

The phase exists because trust and safety, media manifests, bridge admission, public search, semantic recommendation, super-peer replication, reports, appeals, evidence bundles, and future full-peer storage all need a common way to refer to exact content objects.

The model must be **CID-compatible but not IPFS-dependent**. CIDs are content links. They do not imply IPFS storage, IPFS routing, public availability, safety, permission, authority, or moderation state.

## Why this phase exists

Without Phase 1.56, later features will likely invent incompatible references:

- media might invent `blobHash`,
- trust and safety might invent `evidenceHash`,
- bridge admission might invent `quarantineHash`,
- search might invent `documentId`,
- recommendations might invent `sourceHash`,
- full-peer storage might invent `blockId`,
- cross-protocol adapters might invent `cid` fields with IPFS assumptions.

That would create protocol drift, duplicate concepts, weak privacy boundaries, and unsafe moderation behavior.

Phase 1.56 creates one shared vocabulary:

```text
DigestRef
ContentLink
BlockRef
ObjectRef
BundleRef
StorageLocationHint
```

These objects are small, pure, protocol-level references. They do not fetch content, decode untrusted content, enforce moderation, or grant access.

## Placement in the roadmap

Phase 1.56 should happen after the current Phase 1.5 / 3.5 guardrails are documented enough to avoid drift and before Phase 1.6 trust and safety implementation begins.

Recommended order:

1. Finish immediate doctrine/versioning/fixture guardrails.
2. Confirm identity-control and private payload envelope boundaries.
3. **Phase 1.56 - Content Addressing and Object Reference Model.**
4. **Phase 1.6 - Trust & Safety Doctrine and Protocol Safety Boundaries.**
5. Begin narrow T&S protocol package.
6. Begin media manifest planning using `BlockRef` / `ObjectRef`.
7. Only later expand chat, MLS, public social outbox, naming/discovery, public search, semantic recommendation, production bridge deployment, and super-peer replication.

## Non-goals

Do not implement these in Phase 1.56:

- IPFS networking,
- IPFS pinning,
- DHT routing,
- permanent content availability,
- media processing pipelines,
- malware scanning,
- content moderation automation,
- CAR import/export runtime,
- Hypercore full-peer storage,
- bridge production object storage,
- public search indexing,
- semantic recommendation ranking,
- user-facing media UX.

Phase 1.56 is a protocol/type/validation/fixture phase.

## Required documentation deliverables

Must exist before code starts:

- `docs/adr/005-content-addressing-and-object-references-v1.md`
- `docs/protocol/content-addressing.md`
- `docs/threat-model/content-addressing-abuse.md`
- updates to:
  - `docs/implementation/phase-map.md`
  - `docs/implementation/next-development-path.md`
  - `docs/implementation/trust-safety-readiness-plan.md`
  - `docs/protocol/fixture-policy.md`

## Required package deliverable

Create a pure TypeScript package:

```text
packages/content-addressing/
```

The package must not depend on:

- PWA UI,
- Framework7,
- React,
- Dexie/local-store runtime,
- bridge-service runtime,
- sync-client transport,
- media processing runtime,
- trust-safety runtime,
- Node-only filesystem APIs.

It may depend on:

- small shared validation helpers if protocol-safe,
- `@lfp2p/crypto` digest helpers if they are browser-safe and side-effect-free.

## Initial file plan

```text
packages/content-addressing/package.json
packages/content-addressing/src/index.ts
packages/content-addressing/src/digest.ts
packages/content-addressing/src/content-link.ts
packages/content-addressing/src/block-ref.ts
packages/content-addressing/src/object-ref.ts
packages/content-addressing/src/bundle-ref.ts
packages/content-addressing/src/location-hint.ts
packages/content-addressing/src/errors.ts
packages/content-addressing/src/validation.ts
packages/content-addressing/src/index.test.ts
packages/content-addressing/fixtures/valid/
packages/content-addressing/fixtures/invalid/
```

## Type implementation scope

### DigestRef

Implement:

- type definitions,
- validation,
- normalization helpers,
- decoded-length checks,
- safe display/redaction helper.

Initial algorithms:

- `sha-256`: required.
- `blake3`: reserve in type system; implementation may reject until dependency and runtime support are chosen.

Required behavior:

- reject unknown algorithms,
- reject malformed encodings,
- reject wrong digest lengths,
- reject blank strings,
- do not coerce values.

### ContentLink

Implement:

- type definitions,
- allowlisted codecs,
- CIDv1-only policy for emitted objects,
- validation placeholders for CID parser integration,
- no-network/no-fetch guarantee.

Initial codecs:

- `raw`,
- `dag-cbor`,
- `dag-json`,
- `dag-pb`,
- `dcel-cbor`,
- `drisl-cbor`,
- `car-v1`,
- `car-v2`,
- `lfp2p-bundle-v1`.

Required behavior:

- reject unsupported codec,
- reject unsupported CID version,
- reject CID as URL,
- do not assume IPFS,
- do not fetch during validation.

### StorageLocationHint

Implement:

- storage location type enum,
- URL validation helper,
- credential rejection,
- priority validation,
- expiry parsing.

Initial location types:

- `local-cache`,
- `indexeddb-block-store`,
- `opfs-block-store`,
- `bridge-store`,
- `relay-store`,
- `super-peer-store`,
- `https`,
- `s3-compatible`,
- `filebase`,
- `ipfs-compatible`,
- `car-archive`,
- `hypercore-compatible`,
- `native-file-store`.

Required behavior:

- location hints are optional,
- location hints are never authority,
- reject embedded credentials,
- reject malformed URLs,
- never verify content by URL alone.

### BlockRef

Implement:

- immutable block ref type,
- byte-length validation,
- codec validation,
- encryption descriptor validation,
- compression descriptor validation,
- digest/link consistency checks where possible.

Required behavior:

- reject negative/non-finite/unsafe byte lengths,
- reject missing encryption descriptor,
- reject unsafe compression without decoded-size bounds,
- reject dictionary refs that would recurse unsafely,
- do not decode content during validation,
- do not trust `mediaType` as authoritative.

### ObjectRef

Implement discriminated union validators for:

- `event`,
- `record`,
- `media`,
- `safety-label`,
- `report`,
- `policy-decision`,
- `bundle`,
- `url`,
- `domain`,
- `actor`,
- `community`,
- `infrastructure`.

Required behavior:

- use narrowest accurate type,
- normalize URL/domain only through safe helpers,
- do not treat actor/community refs as content refs,
- allow content-backed refs for media/evidence/search/quarantine flows.

### BundleRef

Implement:

- bundle ref type,
- format enum,
- purpose enum,
- root validation,
- byte-length validation,
- encrypted flag validation,
- no traversal during simple validation.

Required behavior:

- reject empty roots,
- reject unsafe bundle byte length,
- distinguish `car-v1`, `car-v2`, and `lfp2p-bundle-v1`,
- keep traversal/import logic out of Phase 1.56 unless validators require shallow checks.

## Fixture plan

Add valid fixtures:

```text
packages/content-addressing/fixtures/valid/digest-ref-sha256.json
packages/content-addressing/fixtures/valid/content-link-cidv1-raw.json
packages/content-addressing/fixtures/valid/block-ref-raw-public.json
packages/content-addressing/fixtures/valid/block-ref-encrypted-private.json
packages/content-addressing/fixtures/valid/block-ref-compressed-bounded.json
packages/content-addressing/fixtures/valid/object-ref-event.json
packages/content-addressing/fixtures/valid/object-ref-media.json
packages/content-addressing/fixtures/valid/object-ref-report-evidence.json
packages/content-addressing/fixtures/valid/bundle-ref-car-v1.json
packages/content-addressing/fixtures/valid/location-hint-bridge-store.json
```

Add invalid fixtures:

```text
packages/content-addressing/fixtures/invalid/digest-ref-unknown-algorithm.json
packages/content-addressing/fixtures/invalid/digest-ref-malformed-value.json
packages/content-addressing/fixtures/invalid/digest-ref-wrong-length.json
packages/content-addressing/fixtures/invalid/content-link-cidv0-new-object.json
packages/content-addressing/fixtures/invalid/content-link-unsupported-codec.json
packages/content-addressing/fixtures/invalid/block-ref-negative-byte-length.json
packages/content-addressing/fixtures/invalid/block-ref-non-finite-byte-length.json
packages/content-addressing/fixtures/invalid/block-ref-compression-unbounded.json
packages/content-addressing/fixtures/invalid/location-hint-url-credentials.json
packages/content-addressing/fixtures/invalid/bundle-ref-empty-roots.json
packages/content-addressing/fixtures/invalid/object-ref-malformed-url.json
packages/content-addressing/fixtures/invalid/object-ref-private-public-hint.json
```

## Test plan

Minimum tests:

- accepts valid SHA-256 digest ref,
- rejects unknown digest algorithm,
- rejects malformed digest encoding,
- rejects wrong digest length,
- accepts CIDv1 content link shape,
- rejects CIDv0 for new objects,
- rejects unsupported codec,
- accepts raw public block ref,
- accepts encrypted private block ref,
- rejects block ref without encryption descriptor,
- rejects negative/non-finite/unsafe byte length,
- rejects unsafe compression metadata,
- rejects location URL with credentials,
- accepts event/media/report object refs,
- rejects malformed object refs,
- accepts CAR-like bundle ref,
- rejects empty roots,
- verifies fixture loader covers every valid and invalid fixture.

Security tests:

- validator never fetches content,
- validator never decodes untrusted codec payloads,
- validator does not coerce string/number/enum values,
- redaction helper does not expose full private refs,
- private/public dedupe policy helper defaults to isolation.

## Integration sequence

### Step 1 - Pure package

Add `packages/content-addressing` with types, validators, fixtures, and tests.

No integration into other packages yet.

### Step 2 - Protocol export boundary

Decide whether `packages/protocol` imports `ObjectRef` or whether both packages depend on a smaller shared protocol-types package.

Default recommendation:

- keep `packages/content-addressing` independent,
- let `packages/trust-safety` import it when created,
- avoid circular dependency with `packages/protocol`.

### Step 3 - Trust and safety subject refs

Update future T&S docs/code so `SafetySubjectRef` uses `ObjectRef` / `BlockRef` for media, blobs, reports, evidence, labels, quarantine, and curation provenance.

### Step 4 - Bridge admission planning

Update bridge admission designs so quarantine/admission decisions target exact `BlockRef`/`ObjectRef` values and never treat a local rejection as global deletion.

### Step 5 - Media manifest planning

Media manifests must consume `BlockRef` instead of inventing separate hash/CID fields.

### Step 6 - Search/recommendation provenance

Search/recommendation objects must preserve `ObjectRef` provenance and scope so private objects cannot leak into public surfaces.

## Acceptance criteria

Phase 1.56 is complete when:

- [x] ADR-005 exists.
- [x] `docs/protocol/content-addressing.md` exists.
- [x] `docs/threat-model/content-addressing-abuse.md` exists.
- [x] `packages/content-addressing` exists.
- [x] The package exposes validators for all core object families.
- [x] Valid and invalid fixtures exist.
- [x] Tests cover malformed input and unsafe coercion.
- [x] The package does not fetch, decode, store, or route content.
- [x] The package does not depend on UI, bridge, local-store, sync-client, media runtime, or trust-safety runtime.
- [x] The trust and safety docs reference `ObjectRef` / `BlockRef` for content-backed subjects/evidence.
- [x] The phase map and next-development path list Phase 1.56 before T&S/media/search expansion.

Exit report: `docs/implementation/phase-1.56-exit-report.md`. The phase is accepted as
foundation-only / partial — the package is delivered and hardened, but downstream
integration into protocol envelopes, T&S runtime, bridge, and media manifests is
intentionally left to subsequent phases per the plan's integration sequence.

## Code quality bar

Implementation must follow current repository expectations:

- strict TypeScript,
- no unsafe coercion,
- no duplicate concepts,
- no unversioned durable object shapes,
- deterministic validators,
- clear error names/codes,
- tests for happy path and malicious/invalid input,
- no network access in validators,
- no private plaintext or full private refs in logs,
- no IPFS assumptions.

## What this unlocks

After Phase 1.56 is complete, the project can safely proceed to:

- T&S protocol core using stable object refs,
- report/evidence bundle modeling,
- bridge quarantine/admission records,
- media manifest planning,
- content-aware curation/search provenance,
- future CAR-like import/export,
- future super-peer content replication policy.

It does not unlock production media, production search, public social outbox, or production bridge deployment by itself. Those still require trust and safety, media, search, and bridge hardening phases.
