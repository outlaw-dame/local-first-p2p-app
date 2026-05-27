# Threat Model: Content Addressing and Object Reference Abuse

- Status: Draft
- Date: 2026-05-27
- Related ADRs:
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related protocol docs:
  - `docs/protocol/content-addressing.md`
  - `docs/protocol/trust-safety-event-policy.md`
- Owners: project maintainers

## Feature / surface

This threat model covers the protocol-level content-addressing and object-reference model.

The system introduces:

- `DigestRef`,
- `ContentLink`,
- `BlockRef`,
- `ObjectRef`,
- `BundleRef`,
- `StorageLocationHint`,
- future local/browser block stores,
- future bridge/super-peer object stores,
- future media manifests,
- future evidence bundles,
- future CAR-like imports/exports,
- future full-peer storage adapters.

The content-addressing model is CID-compatible but not IPFS-dependent. CIDs/content links identify content; they do not define authority, safety, read permissions, storage location, legal status, moderation status, or availability.

## Assets

What must be protected?

- Private payloads:
  - encrypted media blocks,
  - encrypted report bodies,
  - encrypted appeal bodies,
  - encrypted moderation evidence bundles,
  - private group/DM attachments,
  - local-only cached blocks.
- Private keys:
  - signing keys for content reference events,
  - encryption keys for private blocks,
  - bridge/super-peer operator keys,
  - future capability keys for object access.
- Identity/control state:
  - actor/controller identity linked to events/records,
  - capability grants for storage/replication/scanning,
  - revocation state affecting object authority.
- Local database state:
  - block metadata,
  - object projections,
  - local cache state,
  - content-addressed dedupe indexes,
  - quarantine metadata,
  - media scan state.
- Derived indexes:
  - public search object refs,
  - recommendation provenance,
  - trust and safety subject refs,
  - media dedupe indexes,
  - bridge/super-peer admission indexes.
- Metadata:
  - digests/CIDs,
  - block sizes,
  - codec names,
  - media types,
  - location hints,
  - bundle roots,
  - encryption scope,
  - compression metadata,
  - access patterns.
- Availability:
  - local access to cached blocks,
  - bridge/super-peer storage reliability,
  - recovery/import/export bundles,
  - public media retrieval when allowed.

## Trust boundaries

- client/device boundary:
  - content is hashed locally,
  - private content is encrypted before external storage,
  - local block cache may contain sensitive objects.
- bridge/server boundary:
  - bridge may store, reject, quarantine, or rate-limit blocks,
  - bridge must verify content after retrieval,
  - bridge location hints are not authority.
- peer/super-peer boundary:
  - super-peers may replicate public or encrypted blocks,
  - malicious peers may advertise poisoned hints or malformed bundles,
  - peers may attempt block-flooding attacks.
- local storage boundary:
  - IndexedDB/OPFS/file stores may persist private blocks,
  - dedupe indexes may leak correlations if not scoped.
- service worker/cache boundary:
  - cached public/private media must not cross scopes,
  - stale cached blocks must not bypass revocation/quarantine state.
- third-party API boundary:
  - future storage backends may include S3/Filebase/IPFS-compatible gateways,
  - future scanners may inspect public or explicitly disclosed blocks,
  - third-party URLs may leak access patterns.

## Actors

- honest local user:
  - creates and consumes content safely.
- honest remote peer:
  - shares valid content refs and blocks.
- malicious peer:
  - advertises malformed refs, poisoned blocks, or abusive bundles.
- compromised bridge:
  - lies about stored blocks, leaks metadata, serves stale/quarantined content.
- malicious bridge/operator:
  - uses location hints or admission policy to surveil or suppress.
- honest bridge/operator:
  - needs dedupe, quarantine, limits, and safe refusal tools.
- malicious super-peer:
  - replicates private/public content incorrectly, serves corrupted data, ignores quarantine.
- malicious public indexer:
  - indexes private object refs or unsafe content.
- malicious storage backend:
  - swaps content, tracks access, returns wrong bytes, strips metadata.
- network attacker:
  - tampers with downloads, blocks access, observes timing/access patterns.
- malicious content author:
  - creates decompression bombs, parser bombs, harmful media, malware, hash-floods, or illegal content.
- compromised local device:
  - can access local plaintext before encryption and local cache after decryption.

## Data flow

1. A client or adapter creates bytes/structured data.
2. The object is canonicalized or encoded according to codec policy where needed.
3. A digest and optional CID/content link are computed.
4. A `BlockRef` is created with digest, codec, byte length, encryption, compression, and optional location hints.
5. Higher-level protocol objects reference the block through `ObjectRef` or `BundleRef`.
6. Trust/safety, media, bridge admission, search, and curation systems consume refs but apply separate policy.
7. Retrieval uses location hints only as untrusted hints.
8. Retrieved bytes are verified against digest/content link before decoding or rendering.
9. Quarantine, deletion, eviction, or search exclusion occurs through scoped policy decisions, not by changing the digest.

## Threats

| Threat | Impact | Existing mitigation | Missing mitigation | Test required |
|---|---|---|---|---|
| Block substitution | Wrong bytes served for a ref | Digest helpers exist | BlockRef validation and verify-after-fetch | Retrieved bytes mismatch rejected |
| CID/hash mismatch | Malformed or malicious content link accepted | None specific | CID parsing/digest matching | CID digest mismatch rejected |
| Unsupported codec accepted | Parser crash or unsafe decode | None specific | Codec allowlist | Unsupported codec rejected |
| Codec confusion | Treat bytes as safer/different type | None specific | Strict codec/media sniff validation | Declared/sniffed mismatch handled |
| Hash downgrade | Weak/unknown digest used | SHA-256 helper exists | algorithm allowlist | Unknown/weak algorithm rejected |
| Oversized block | Storage/memory exhaustion | None specific | byte-length limits | Oversized block rejected |
| Decompression bomb | CPU/memory exhaustion | None specific | decoded-size bounds | Unbounded compressed block rejected |
| Bundle traversal bomb | Import/export DoS | None specific | max blocks/bytes/depth | Bundle over limit rejected |
| Malicious CAR/bundle roots | Unsafe graph import | None specific | root validation and traversal policy | Empty/malformed roots rejected |
| Poisoned location hint | SSRF, credential leakage, bad fetch | None specific | URL validation, no credentials, policy fetcher | Credential URL rejected |
| Location hint as authority | Trust wrong storage backend | None specific | verify-after-fetch and docs | Hint cannot bypass digest check |
| Private/public dedupe leakage | Correlates private content | None specific | dedupe scope policy | Private/public dedupe isolation |
| Digest correlation | Same private blob recognized across contexts | Encryption planned | per-scope encryption/dedupe policy | Encrypted private refs scoped |
| Harmful content persistence | Content-addressed public blocks persist | None specific | quarantine/refusal, no global deletion claim | Quarantine scoped behavior tested |
| Malware hash replication | Infrastructure stores harmful blocks | None specific | media/hash scan/admission policy | Known bad block rejected/quarantined |
| Illegal content replication | Operator/legal risk | None specific | admission/quarantine/legal escalation policy | Quarantine prevents serving |
| Stale cached block bypasses quarantine | Unsafe content remains visible | None specific | cache invalidation and policy checks before render | Quarantined cached block hidden |
| Public index ingests private object refs | Privacy breach | None specific | scope validation | Private refs rejected by public index |
| Report evidence leaked by ref | Sensitive evidence exposed | Private payload ADR exists | encrypted evidence BundleRef | Public evidence leak rejected |
| Blob rendered before verification | Corrupted or malicious bytes shown | None specific | verify-before-render rule | Unverified render path impossible |
| Access-pattern leakage | Backend learns who requests what | None specific | privacy guidance, proxy/fetch policy later | Documentation/adapter tests |
| Hash-flood / many tiny blocks | DB/storage exhaustion | None specific | quotas, batching, eviction | Many-block flood bounded |

## Logging and telemetry rules

- Private plaintext allowed in logs: No.
- Private keys allowed in logs: No.
- Full private location URLs allowed in logs: No.
- Embedded credentials in URLs allowed in logs: No.
- Full private digests/CIDs allowed in shared telemetry: No; use redacted prefixes where needed.
- Sensitive identifiers allowed in logs:
  - redacted digest prefix,
  - codec,
  - bounded size,
  - object type,
  - decision id,
  - policy version,
  - local queue state.
- Redaction/hash policy:
  - only log enough to debug local object mismatch,
  - do not create cross-service correlation of private content,
  - do not log private bundle roots in public telemetry.
- User-visible error policy:
  - say verification failed, content unavailable, quarantined, unsupported, or too large,
  - do not expose private storage URLs,
  - do not expose reporter/evidence details.

## Required tests before beta

- [ ] Valid SHA-256 `DigestRef` accepted.
- [ ] Malformed digest rejected.
- [ ] Unsupported digest algorithm rejected.
- [ ] CID/content-link digest mismatch rejected once CID parser exists.
- [ ] Unsupported codec rejected.
- [ ] Negative/non-finite/unsafe byte length rejected.
- [ ] Compression without decoded-size bound rejected.
- [ ] Bundle with empty roots rejected.
- [ ] Bundle over max depth/blocks/bytes rejected.
- [ ] Location URL with credentials rejected.
- [ ] Location hint cannot bypass digest verification.
- [ ] Private object with unsafe public location hint rejected by policy layer.
- [ ] Public index rejects private `dm`/`group` object refs.
- [ ] Quarantine record targets exact `BlockRef`/`ObjectRef`.
- [ ] Cached quarantined object not rendered.
- [ ] Logs redact private refs and URLs.

## Residual risk

Even after mitigations:

- Public content-addressed objects may remain available outside this system after replication.
- A malicious client can still publish references to harmful content; infrastructure can only refuse to store/serve/replicate locally.
- Encrypted private blocks still expose some metadata such as size/timing unless padded or proxied later.
- Codec parsers remain attack surfaces and must be updated/hardened over time.
- External storage backends can observe retrieval patterns unless future privacy-preserving fetch/proxy strategies are added.
- A compromised local device can access decrypted local content.

## Review notes

- This threat model must be reviewed before media manifests, public search indexing, semantic recommendation, production bridge storage, super-peer replication, or CAR-like import/export.
- Update this threat model when `packages/content-addressing` is implemented.
- Update this threat model when media manifests introduce concrete codecs/transcoding.
- Update this threat model when full-peer storage adapters are introduced.
