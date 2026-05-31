# Phase Exit Report: Phase 1.56 — Content Addressing and Object Reference Model

- Status: Accepted as foundation-only / partial (see Decision)
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related protocol docs:
  - `docs/protocol/content-addressing.md`
  - `docs/protocol/trust-safety-event-policy.md`
- Related threat models:
  - `docs/threat-model/content-addressing-abuse.md`
- Related PRs: commits on `master` between `8a9438d` and the commit that lands this report

## Phase scope

Phase 1.56 was a protocol/type/validation/fixture phase. It was supposed to:

- Define one shared vocabulary of content-addressing primitives (`DigestRef`, `ContentLink`, `BlockRef`, `ObjectRef`, `BundleRef`, `StorageLocationHint`) before trust and safety, media, search, recommendation, super-peer replication, and bridge admission start emitting their own incompatible references.
- Enforce the doctrine "CID-compatible but not IPFS-dependent": CIDs are content links, not a storage network, not routing authority, not a trust mechanism.
- Ship a pure TypeScript package with no UI, bridge, local-store, sync-client, media-runtime, or trust-safety-runtime dependency.
- Provide validators that never fetch, decode, store, or route content.
- Provide a fixture suite that documents the accepted and rejected shapes.

## Completed work

`packages/content-addressing` now contains:

- Stable error codes (29 `CA_*` codes) on `ContentAddressingError` for caller branching.
- Hardened canonical JSON: prototype-pollution-safe (rejects `__proto__`, `prototype`, `constructor` own-keys), bounded recursion (`MAX_CANONICAL_DEPTH = 64`), rejects `undefined` values and non-finite numbers, uses a null-prototype output object, and assigns properties with `Object.defineProperty` so even reserved-looking keys cannot alter the prototype chain.
- `DigestRef` with algorithm-pinned encoded length (SHA-256 → 43 chars, SHA-512 → 86 chars, reserved BLAKE3 → 43 chars). Constant-time digest comparison in `verifyDigest`.
- Cross-platform digest creation via WebCrypto where available with a Node `crypto` fallback. Algorithm cannot be downgraded by a caller passing an unsupported value.
- `ContentLink` with CIDv1-only policy enforced at three layers:
  1. Multibase prefix allowlist with per-prefix alphabet checks.
  2. CIDv0 (`Qm…` 46-char base58btc) explicit rejection.
  3. **Real multihash/multicodec parsing** for prefixes `b` / `B` / `f` / `F`: the binary form is fully decoded, the version is verified to be 1, the multicodec varint is read (with canonical-encoding and safe-integer bounds), the multihash code is checked against an allowlist (`sha2-256` 0x12, `sha2-512` 0x13, BLAKE3 0x1e), the declared digest length is required to match the code's expected length, and trailing bytes are rejected.
- `StorageLocationHint` with the documented 13-kind enum, URL credential rejection on every kind (including opaque local kinds), per-kind scheme allowlists, priority/expiresAt validation.
- `BlockRef` with discriminated source (digest or content-link), required encryption descriptor for `privacy: 'private'`, compression descriptor with explicit decoded-size cap (16 GiB) and decoded-to-encoded ratio cap (1024×), identity-compression sanity check, recursive dictionary ref rejection, byte-length cap (1 GiB), storage-hint count cap (32).
- `BundleRef` with format enum (`car-v1`, `car-v2`, `lfp2p-bundle-v1`), purpose enum, non-empty roots, 1024 root cap, 64 GiB byte cap.
- `ObjectRef` as a 12-kind discriminated union — content-backed (`event`, `record`, `media`, `safety-label`, `report`, `policy-decision`), `bundle` (carries `BundleRef`), `url` (HTTP(S)-only and credentialless), `domain` (RFC 1035 label rules, no URL-as-domain), identity (`actor`, `community`, `infrastructure`) using opaque identityRef strings explicitly distinct from content refs.
- Redaction helpers (`redactDigestRef`, `redactContentLink`, `redactBlockRef`) that emit short non-reversible log strings.
- BLAKE3 reserved in the type system per the plan: refs validate by shape, but `createDigest`/`verifyDigest` fail closed with a clear "reserved, not yet implemented" error until a vetted runtime is chosen by ADR. `COMPUTABLE_HASH_ALGORITHMS` is the narrower set used for local computation.
- Pure-TypeScript varint and base32-lower / base16 decoders with adversarial bounds: canonical-encoding required, leftover-bit rejection, safe-integer bound, length bound.
- Fixture suite: 11 valid + 12 invalid covering CIDv0 rejection, malformed and wrong-length digests, unknown algorithms and codecs, negative/non-integer byte lengths, compression bombs, URL credentials, empty bundle roots, malformed URLs, missing encryption on private blocks, and the BLAKE3-reserved-but-accepted shape. A fixture-loader test asserts that every documented fixture exists and is consumed.
- 179 tests covering happy path, structural rejection, and adversarial inputs (prototype pollution, recursion bomb, header injection, URL credential injection, compression bomb by ratio and absolute size, recursive dictionary reference, CIDv0 rejection, trailing CID bytes, truncated CID digests, multibase alphabet violations, non-canonical varints, non-canonical base32 leftover bits, missing encryption on private blocks, control characters in identity refs).

The package depends only on standard runtime APIs (WebCrypto, Node `crypto` fallback, `node:fs` / `node:path` in the test loader). No dependency on UI, bridge, local-store, sync-client, media runtime, or trust-safety runtime.

## Tests and verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 396 passing (179 in content-addressing)
pnpm build       # clean
```

Additional verification:

- Constant-time digest comparison in `verifyDigest` checked against length-equal mismatching inputs.
- Sample CIDv1 (`bafkreih2ak…`) decoded end-to-end through the real multibase → multihash → multicodec pipeline.
- Adversarial inputs in tests cover every error code path declared in `CA_ERROR_CODES` that this package can produce.

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---:|---|
| ADR-005 exists | ✓ | `docs/adr/005-content-addressing-and-object-references-v1.md` |
| `docs/protocol/content-addressing.md` exists | ✓ | committed in earlier phase work |
| `docs/threat-model/content-addressing-abuse.md` exists | ✓ | committed in earlier phase work |
| `packages/content-addressing` exists | ✓ | this package |
| Validators for all core object families | ✓ | `validateDigestRef`, `validateContentLink`, `validateBlockRef`, `validateObjectRef`, `validateBundleRef`, `validateStorageLocationHint` |
| Valid and invalid fixtures | ✓ | 11 valid + 12 invalid under `fixtures/` |
| Tests cover malformed input and unsafe coercion | ✓ | 179 tests including 70+ adversarial cases |
| Package does not fetch, decode, store, or route content | ✓ | grep confirms no network/storage APIs |
| Package independence | ✓ | no UI/bridge/local-store/sync-client/media/T&S deps |
| T&S docs reference `ObjectRef` / `BlockRef` for content-backed subjects/evidence | ✓ | `docs/protocol/trust-safety-event-policy.md` (`SafetySubjectRef.media`, `.blob`, `evidenceRefs`) |
| Phase map and next-development-path list Phase 1.56 before T&S/media/search | ✓ | `docs/implementation/phase-map.md`, `docs/implementation/next-development-path.md` |

## Security/privacy checks

- [x] No private plaintext in logs — `redact*` helpers truncate digests to an 8-char prefix and never expose encryption key refs.
- [x] Remote/untrusted input validation exists — every public `validate*` entry point uses `assertPlainObject` first, then validates each field with explicit branches; unknown keys are tolerated, unknown discriminator values are rejected.
- [x] Malicious/invalid input tests exist — 70+ adversarial test cases including prototype pollution, compression bombs, URL credential injection, header injection via `mediaType`, CIDv0 substitution, control characters, recursion bombs, non-canonical varints.
- [x] Revocation/permission behavior — N/A for this phase; trust-policy interactions belong to Phase 1.61–1.63.
- [x] Derived state rebuild/delete behavior — N/A; the package is pure and stateless.

## Deviations introduced or resolved

- The plan's `ContentLink` shape was extended with the application-level codec field as designed. The CID's internal multicodec is checked against an allowlist but not strictly cross-referenced against the application-level `codec` field, because plan codecs like `lfp2p-bundle-v1` and `car-v1` are not standard multicodec values. The plan's `lfp2p-bundle-v1` is an application-level identifier; the CID's internal multicodec is informational and reported as `multicodecName` on `ParsedCid`.
- BLAKE3 is reserved in the `HashAlgorithm` type per the plan, but local computation is fail-closed. Refs received over the network parse and validate; refs cannot be generated locally or verified locally until a vetted dependency is added by ADR.

## Remaining gaps

The following items are explicitly out of scope for Phase 1.56 per the plan's "Non-goals" section, but are tracked for downstream phases:

- Full multibase decode for all prefixes the alphabet check accepts (currently `b` / `B` / `f` / `F` parse to binary; other prefixes pass alphabet check only). Adding `z` (base58btc) and `k` (base36) requires a base58 and base36 decoder; deferred until a CID using those prefixes appears in a real protocol surface.
- BLAKE3 implementation — plan reserves it; implementation depends on a future ADR for the crypto dependency.
- Application-specific event/payload schemas built on these refs — belongs to Phase 1.6 trust-safety, Phase 7 media manifest, Phase 9 social outbox.
- Storage adapter wiring — belongs to Phase 4 bridge, Phase 7 media, Phase 13 native peer.
- Direct integration of `ObjectRef` into `packages/protocol` event envelopes — explicitly listed as "Step 2" in the plan and intentionally deferred to keep `content-addressing` independent.
- CAR import/export runtime, IPFS networking, DHT routing, public availability — all explicitly out of scope per the plan.

## Decision

This phase is:

- [ ] accepted as complete,
- [x] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason:

The plan's acceptance criteria are met. The package is shipped, hardened, exercised by fixtures, and consumed (by reference) in the trust and safety protocol docs. Phase 1.56 was scoped as "protocol/type/validation/fixture" and that scope is delivered.

The phase is marked **foundation-only / partial** rather than fully Complete because the in-place items below — none of which were 1.56 deliverables — still need follow-on phases to wire content-addressing into the rest of the system:

- Phase 1.6 (Trust & Safety protocol core) and Phase 1.61–1.63 will consume `ObjectRef`/`BlockRef` as `SafetySubjectRef`/`EvidenceRef`.
- Phase 4 (Bridge) will consume `BlockRef` for quarantine and admission records.
- Phase 7 (Media manifests) will consume `BlockRef` / `BundleRef` for manifest construction.
- Phase 1 / 1.5 will wire `ObjectRef` into `packages/protocol` envelopes.
- A future ADR is required before BLAKE3 can be enabled for local computation.

Until those downstream consumers exist, calling Phase 1.56 "Complete" would overstate the integration depth. "Foundation-only" is the honest label.
