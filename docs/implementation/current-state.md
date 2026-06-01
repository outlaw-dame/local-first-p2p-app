# Current Implementation State

This document is the implementation truth layer for the repository. It describes what the code currently does, not the complete target architecture.

## Current baseline

- Default branch: `master`.
- Latest verified baseline for this documentation pass: default branch `master` after PR #52, `persist identity projection during inbound apply`.
- The repo currently implements a PWA-first local-first foundation with signed local events, persistent local device identity, a Dexie local store, a mutation outbox, HTTP bridge transport, bridge service primitives, and bridge store backends.
- The architecture is intentionally trust-centric and protocol-first, not an ActivityPub/ATProto/Memory authority. It is built on signed events, identity, capabilities, content object integrity, trust evaluation, and replication.

## Applications

### `apps/pwa`

Current role: first user-facing local-first PWA light peer.

Implemented today:

- Framework7 React + TypeScript + Vite application shell.
- TanStack Query provider for future bridge/server/public-index state.
- Local device identity bootstrap through `@lfp2p/identity`.
- Local signed event creation through `@lfp2p/protocol` and `@lfp2p/crypto`.
- Local event persistence and local materialized event summaries through `@lfp2p/local-store`.
- Mutation outbox enqueueing through `@lfp2p/local-store` and idempotency helpers from `@lfp2p/sync-client`.
- Runtime capability snapshot through `@lfp2p/platform`.
- Local identity trust cues with controller fingerprint display/copy and verification status.
- Local petname editing backed by contact profile persistence.
- Local contact-card editing plus signed JSON export/import flow for local exchange.
- Explicit fingerprint compare flow for anti-phishing verification.

Not implemented yet:

- Real app navigation beyond the first vertical slice.
- Service worker/offline shell policy.
- Contacts, petnames, name-proof UI, or contact cards.
- Private payload encryption for user-facing chat/social payloads.
- Chat, groups, media attachments, social posting, feed UX, or search UX.
- Background/foreground outbox worker wired into the PWA runtime.

### `apps/bridge-service`

Current role: non-authoritative bridge service primitives and request handler.

Implemented today:

- Bridge delivery service abstraction.
- In-memory bridge service wrapper.
- Framework-free request handler for bridge delivery requests.
- Signature verification before accepting bridge deliveries.
- Privacy scope filtering: bridge accepts only bridge-safe scopes, currently `dm`, `group`, and `public`.
- Idempotency conflict detection.
- Duplicate delivery handling.
- Store snapshot support.
- Bridge store backends:
  - in-memory store,
  - JSON file store,
  - PGlite SQL store.

Not implemented yet:

- Production server runtime.
- Authentication, authorization, abuse controls, or rate limiting around the bridge endpoint.
- Durable Streams/WebSocket bridge reader/server.
- Encrypted mailbox actor.
- Persistent peer/full P2P bridge integration.
- Public index service.
- Observability/metrics/log privacy policy for production deployment.

## Packages

### `packages/protocol`

Implemented today:

- Versioned `UnsignedEventEnvelope` / `SignedEventEnvelope`.
- Event kinds:
  - `identity.device.created`,
  - `identity.controller.created`,
  - `identity.device.authorized`,
  - `identity.device.revoked`,
  - `identity.capability.granted`,
  - `identity.capability.revoked`,
  - `contact.petname.set`,
  - `note.created`,
  - `outbox.test.created`.
- Privacy scopes:
  - `device-local`,
  - `self`,
  - `dm`,
  - `group`,
  - `public`.
- `SourceRef`.
- JSON canonicalization helper.
- Unsigned/signed event validation helpers.
- Identity event payload and privacy-scope validation rules.
- Fixture-driven protocol envelope validation.

### `packages/content-addressing`

Implemented today:

- Module version constant: `lfp2p.content-addressing.v1`.
- Stable error codes (`CA_*`) and `ContentAddressingError` class with `code` discriminator.
- `DigestRef` with strict shape validation: SHA-256 / SHA-512 only, base64url-no-pad encoding, length pinned to the algorithm.
- Canonical JSON encoder hardened against prototype pollution (rejects `__proto__`, `prototype`, `constructor` keys), non-finite numbers, `undefined` values, and unbounded recursion (`MAX_CANONICAL_DEPTH = 64`).
- Cross-platform digest creation using WebCrypto where available, Node `crypto` fallback otherwise. Constant-time digest comparison in `verifyDigest`.
- `ContentLink` with CIDv1-only policy enforced at three layers: (1) multibase prefix allowlist with per-prefix alphabet enforcement, (2) CIDv0 (`Qm…`) explicit rejection, (3) **real multihash/multicodec binary parsing** for prefixes `b` / `B` / `f` / `F` — version varint must be 1, multicodec varint read with canonical-encoding and safe-integer bounds, multihash code must be in the allowlist (`sha2-256` 0x12, `sha2-512` 0x13, BLAKE3 0x1e), declared digest length must match the code, no trailing bytes allowed. Application-level codec allowlist for `raw`, `dag-cbor`, `dag-json`, `dag-pb`, `dcel-cbor`, `drisl-cbor`, `car-v1`, `car-v2`, `lfp2p-bundle-v1`. `mediaType` rejected if it contains control characters (header-injection guard).
- Pure-TypeScript varint reader (`readUnsignedVarint`, bounded to 9 bytes, requires canonical/minimal encoding) and base32-lower / base16 decoders (canonical leftover-bit enforcement).
- BLAKE3 reserved in the `HashAlgorithm` type: refs received over the network parse and validate by shape, but `createDigest`/`verifyDigest` fail closed with a clear "reserved, not yet implemented" error. `COMPUTABLE_HASH_ALGORITHMS` is the narrower set used for local computation.
- `StorageLocationHint` with the full kind enum (local-cache, indexeddb-block-store, opfs-block-store, bridge-store, relay-store, super-peer-store, https, s3-compatible, filebase, ipfs-compatible, car-archive, hypercore-compatible, native-file-store). URL credentials are rejected outright; scheme allowlists are enforced per kind. Priority must be a safe non-negative integer; `expiresAt` must parse as a date-time.
- `BlockRef` with discriminated source (digest or content-link), required encryption descriptor for `privacy: 'private'`, compression descriptor with explicit decoded-size bound (`MAX_DECODED_BYTE_LENGTH` = 16 GiB) and ratio cap (`MAX_COMPRESSION_RATIO` = 1024), self-referencing dictionary rejection, byte-length cap (`MAX_BLOCK_BYTE_LENGTH` = 1 GiB), storage-hint count cap (`MAX_STORAGE_HINTS` = 32).
- `BundleRef` with format enum (`car-v1`, `car-v2`, `lfp2p-bundle-v1`), purpose enum, non-empty roots, root-count cap (`MAX_BUNDLE_ROOTS` = 1024), byte-length cap (`MAX_BUNDLE_BYTE_LENGTH` = 64 GiB).
- `ObjectRef` as a 12-kind discriminated union: content-backed (`event`, `record`, `media`, `safety-label`, `report`, `policy-decision`), `bundle` (carries `BundleRef`), `url` (HTTP(S) only, no credentials), `domain` (RFC 1035 label rules, no URL-as-domain), identity (`actor`, `community`, `infrastructure`) using opaque identityRef strings — explicitly not content refs.
- Redaction helpers (`redactDigestRef`, `redactContentLink`, `redactBlockRef`) that emit short, non-reversible log strings instead of full digests/key refs.
- Fixture suite: 10 valid + 12 invalid fixtures covering CIDv0 rejection, malformed/wrong-length digests, unknown algorithms/codecs, negative and non-integer byte lengths, compression bombs, URL credentials, empty bundle roots, malformed URLs, and missing encryption on private blocks.
- 130+ tests covering happy path, structural rejection, adversarial inputs (prototype pollution, recursion bomb, header injection, URL credential injection, compression bomb by ratio and absolute size, recursive dictionary reference, control characters in identity refs).

Not implemented yet:

- Application-specific content object schemas (event payload digests, search objects).
- A full multihash/multicodec parser (CID validation is shape-level only).
- Block/bundle storage adapters and runtime fetchers.
- BLAKE3 runtime — reserved in the type system; local computation is fail-closed until an ADR adds a vetted dependency.
- Multibase decoders for `z` (base58btc) and `k` (base36) prefixes — currently alphabet-validated only; binary-level parsing applies to `b` / `B` / `f` / `F`.
- Direct integration into `packages/protocol` event objects.

### `packages/trust-safety`

Implemented today:

- Module version sentinel: `lfp2p.trust-safety.v1`.
- Stable `TS_*` error codes on `TrustSafetyError` (29 codes) for caller branching.
- Validation helpers: `assertExactVersion` (fail-closed on unknown major versions), `assertIso8601` with timezone requirement and 2020–2126 sanity window, `assertNotBefore`, `assertOneOf`, `assertId`/`assertText` with bounded length and control-character rejection, `assertReadonlyArray` with per-element validator and length caps, `assertFiniteNumberInRange`.
- Reserved extension-point refs (`ActorRef`, `ReporterRef`, `CapabilityProofRef`, `CredentialRef`) validated by shape only — runtime authority elevation is the future trust-policy engine's job (ADR-006).
- `SafetyAuthority` with version pinning, 8-scope allowlist, 10-role allowlist, optional `resourceRef` (delegates to `@lfp2p/content-addressing`), capability proofs and credential refs (count-capped), optional expiry with `createdAt <= expiresAt` cross-check.
- `SafetySubjectRef` 14-variant discriminated union. Unknown variants fail closed. URL subjects must be http(s) and credentialless (rejects `https://user:pass@…`), oversize URLs rejected, domain subjects validated and lowercased.
- `SafetyAction` enum split into moderation / curation / neutral groups with `assertActionScopeCompatible`: `reject-transport` requires a transport scope; curation actions cannot be issued at transport or `network-advisory` scope.
- `SafetyLabelDefinition` with category/severity/action enums and hard-safety guards: `hardSafety=true` cannot pair with permissive `defaultAction` (`allow`/`downrank`) and cannot be `userConfigurable`.
- `SafetyLabel` with confidence bounded to `[0, 1]` finite, evidence-ref count cap, and private-by-nature subject + public-scope leak rejection (`TS_PRIVATE_LEAK`).
- `SafetyLabelerProfile` with https-only credentialless service endpoint, namespace/label count caps, `createdAt <= updatedAt`.
- `SafetyLabelerSubscription` scope restricted to local scopes only (no `network-advisory`); action overrides validated against a known-safe action subset.
- `SafetyAnnotation` with motivation/body/format enums and private-subject + public-scope leak guard.
- `SafetyReport` with required `idempotencyKey` (length-capped), allowlisted `reasonCode`, reporter privacy enum, and private-subject + public-scope leak guard.
- `SafetyAppeal` targeting a `decisionId` (not a label), with bounded `idempotencyKey` and `reasonCode`.
- `SafetyPolicyDecision` with action/scope cross-validation and private-subject leak guard. `appealable` is required and must be a boolean.
- `TransportAdmissionDecision` requiring an infrastructure operator authority and cross-checking surface against scope (bridge surface ⇒ bridge-local scope, etc.).
- `CurationRule` + `CurationExplanation` with `TS_CURATION_MASQUERADE` rejection so moderation actions cannot be issued via curation paths.
- 18 valid + 15 invalid fixtures covering the categories required by the trust-safety phase plan.
- 137 tests including adversarial cases: URL credential injection, javascript: URL rejection, oversize URLs, private-subject + public-scope rejection across labels / annotations / reports / decisions, `reject-transport` outside transport scope, curation action at transport scope, curation masquerade, hard-safety downgrade, NaN/Infinity confidence rejection, expiry-before-creation, oversize array caps.

Not implemented yet:

- Phase 1.62 local user controls (events + projections).
- Phase 1.63 report/appeal runtime (encrypted evidence routing, idempotency enforcement, target-authority resolution).
- Phase 1.64 bridge/relay/super-peer admission runtime.
- Phase 1.65 curation/reach runtime.
- Capability/credential verification (shape-only refs today; full verification depends on a future capability ADR).
- Trust-policy engine (ADR-006) for turning validated evidence into deterministic decisions.

Not implemented yet:

- Broader capability credential formats and delegation envelope beyond the current identity event payloads.
- Room events.
- MLS control records.
- Media manifests.
- Name bindings.
- Search objects.
- Compression descriptors.
- Comprehensive golden fixture suite for protocol conformance.

### `packages/crypto`

Implemented today:

- Signing key generation.
- Event signing and verification adapter surface.
- AES-GCM protection-key helpers.
- Key material encryption/decryption used by local device identity.
- SHA-256 base64url helper.
- Fixture-backed signed-event signature verification tests with crypto-local fixtures (valid signature acceptance + tampered signature rejection).

Not implemented yet:

- Payload encryption model for private messages/media.
- MLS integration.
- Capability credential binding.
- Hardware-backed/native key adapter path.

### `packages/identity`

Implemented today:

- Local device identity bootstrap and restore.
- Encrypted private signing-key material persisted through `local-store`.
- Local protection-key persistence.
- Single-flight identity bootstrap to avoid duplicate concurrent identity creation.
- Fail-closed restore if an active identity exists but required local protection key is missing.
- Identity control-log projection primitives (`createEmptyIdentityControlState`, `applyIdentityControlEvent`, `seedIdentityControlProjection`).
- Control-log enforcement rules for controller signer, epoch monotonicity, entity existence, and deterministic replay behavior.
- Runtime authorization helper for trust/device/capability-gated identity operations.

Not implemented yet:

- Full account-level identity workflow that migrates local bootstrap into authoritative root/controller lifecycle management.
- Identity recovery/supersession flow.
- Controller key rotation semantics.
- Contact-card import/export.

### `packages/local-store`

Implemented today:

- Dexie database with versioned schema.
- Tables:
  - `signedEvents`,
  - `mutationOutbox`,
  - `eventSummaries`,
  - `deviceIdentities`,
  - `localProtectionKeys`,
  - `syncCheckpoints`,
  - `identityControlProjections`,
  - `contactProfiles`.
- Signed event persistence and retrieval.
- Mutation outbox enqueue, list, due-list, claim, confirm, conflict, fail, retry scheduling, stale-claim recovery, and status counts.
- Local event summary storage.
- Device identity/protection-key storage.
- Sync checkpoints with monotonic advance/rewind policy controls.
- Atomic inbound event + checkpoint persistence helper.
- Identity control projection persistence table and atomic projection update hook.
- Contact profile persistence with normalized petname uniqueness and validation guards.
- Transaction wrapper over known tables.

Not implemented yet:

- Contacts/petnames tables.
- Pending media metadata.
- Full identity-state projection.
- Message/feed materialized views.
- Search rebuild pipeline from signed events.

### `packages/sync-client`

Implemented today:

- Outbox transport contract.
- Idempotency key creation.
- Exponential backoff with jitter.
- Outbox batch processing.
- Retry/conflict/terminal failure handling.
- Stale response guard.
- HTTP bridge transport.
- Endpoint normalization and endpoint credential rejection.
- Bridge response parsing hardening from PR #19:
  - malformed JSON rejected with specific retryable error,
  - invalid successful response shapes rejected without unsafe coercion,
  - unsupported status rejected,
  - permanent 4xx remains non-retryable,
  - malformed/invalid successful bridge responses do not falsely confirm local outbox entries.
- Inbound sync batch processing with checkpoint identity preflight and stale-sequence handling.
- Pull-and-process inbound sync helper with checkpoint-before/after support.
- Cryptographic signature verification for inbound signed events before persistence.
- Identity control event enforcement on inbound apply using `@lfp2p/identity` control-log logic.
- Atomic identity control projection persistence during inbound apply.
- Manual outbox delivery gate can now enforce identity authorization decisions before network sends.

Not implemented yet:

- Durable Stream reader.
- WebSocket transport.
- WebRTC adapter.
- PWA foreground/resume/network-restoration runner.
- Multi-bridge failover.

### `packages/search`

Implemented today:

- PGlite-backed local projection table.
- Basic escaped `LIKE` search over normalized title/body text.
- Search result shape with rank placeholder.

Not implemented yet:

- Proper FTS/BM25-style lexical index.
- Permission-scope partitions.
- Search object provenance model.
- Hybrid fusion.
- Semantic/vector adapter.
- Embedding lifecycle states.
- RAG context assembly.

### `packages/platform`

Implemented today:

- Runtime/platform capability detection surface used by the PWA.

Not implemented yet:

- Full platform-specific feature policy layer.
- Native/Capacitor capability adapters.

### `packages/design-tokens` and `packages/ui`

Implemented today:

- Initial shared design-token and UI package boundaries.
- Local-first status card used by the PWA.

Not implemented yet:

- Full Apple-inspired token system.
- Deep Framework7 component wrapper strategy.
- Accessibility/reduced-motion/dark-mode policy coverage.

## Current security posture

Implemented safety boundaries:

- Durable local app events are signed.
- Bridge verifies signatures before accepting events.
- Bridge rejects non-bridge-safe privacy scopes.
- Local private signing key material is encrypted before persistence.
- Bridge responses are treated as untrusted input and parsed defensively.
- Mutation retries use idempotency keys and backoff with jitter.

Important limitations:

- User-facing private payload encryption is not implemented yet.
- Bridge runtime is not production-hardened.
- Identity revocation/capability semantics are not implemented yet.
- Threat model coverage is still incomplete for payload encryption, identity recovery, and search privacy.

## Current development posture

The repository is in a strong early foundation state, but it is not ready for private chat, production bridge deployment, or public beta. The next work should focus on doctrine alignment, protocol fixtures, identity-control planning, sync offsets, and explicit privacy/security gates before expanding feature surfaces.

Identity-control planning and private payload envelope planning are now recorded by ADR-001 and ADR-002. The next implementation work is to convert those decisions into protocol schemas, fixture packs, and enforcement logic.
