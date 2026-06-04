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
- Name-proof UI (NIP-05-like cryptographic proofs of human-readable identifiers — Phase 10 territory). Contact cards, petnames, and the fingerprint-compare flow are already implemented (see above).
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

Phase 1.62 local-controls slice (sub-module under `@lfp2p/trust-safety/local-controls`):

- Module version sentinel: `lfp2p.local-control-event.v1`.
- 12 event kinds with `apply`/`revert` action discriminator — 7 baseline (`safety.account.blocked`, `safety.account.muted`, `safety.domain.blocked`, `safety.keyword.muted`, `safety.thread.muted`, `safety.post.hidden`, `safety.label.preference.set`) plus 5 expansion kinds: `safety.account.allowlisted` (visibility override; suppresses non-hard-safety labels), `safety.policy-list.subscribed` and `.unsubscribed` (subscribe to external community curation lists with allowed-kinds and trust-level), `safety.notification-preference.set` (per-channel preferences across mentions / replies / reactions / DMs-from-non-contacts / group-invites / follows), `safety.preferences.snapshot` (canonical full-state event for cross-app bootstrap).
- Optional `expiresAt` on every applicable event; validator rejects `expiresAt < createdAt`. Selector takes a `now` parameter and skips expired entries — state remains pure. `pruneExpiredLocalControlState` provided as an optional compaction step.
- `assertLocalControlEnvelopeScope` rejects every networked scope with `TS_PRIVATE_LEAK`; only `device-local` and `account-local` pass. The latter is the cross-app portability scope.
- `safety.keyword.muted` supports `substring`, `word`, and `semantic` match kinds. User-supplied regexes are excluded as a ReDoS defense. Semantic entries carry `embeddingRef` (DigestRef), `embeddingModel` identifier, and optional `similarityThreshold ∈ [0,1]`; the selector evaluates them via a host-supplied `SemanticKeywordMatcher` callback so the package stays ML-free, and host-matcher errors are contained.
- `safety.label.preference.set` restricted to user-facing actions (`allow`, `warn`, `collapse`, `blur-media`, `hide`, `downrank`); infrastructure actions like `reject-transport` are rejected.
- `LocalControlState` frozen snapshot with 10 keyed projection records (blocked / allowlisted / muted actors, blocked domains, muted keywords / threads, hidden posts, label preferences, policy-list subscriptions, notification preferences) plus `appliedEventIds` set for idempotency and optional `snapshotAppliedAt`.
- `applyLocalControlEvent` is pure, deterministic, validates before mutating, freezes the result, treats double-apply as a no-op, supports `revert` deterministically, and uses spread-then-define for key writes so adversarial keys like `__proto__` cannot pollute the prototype chain. `safety.preferences.snapshot` events are rejected here on purpose; snapshot import is an explicit operation via `importPreferencesSnapshot` so a stray snapshot cannot silently overwrite user state.
- `seedLocalControlState` replays an event log producing equal state on every call — the store-reopen rebuild path.
- Cross-app portability via `exportPreferencesSnapshot` / `importPreferencesSnapshot` with three merge strategies (`union` default, `replace`, `merge-newer-wins`), schema-pinned `validateLocalControlSnapshot` (fail-closed on unknown schema), and `assertSnapshotIsNotStale` guard so a stale sync cannot roll preferences backward. `appliedEventIds` is preserved across import so events that arrive twice (via log + embedded in snapshot) do not double-apply. Doctrine: `docs/protocol/local-controls-portability.md`.
- `decideVisibility(state, context, options?)` returns the most restrictive of `show < downrank < warn < blur-media < collapse < hide`. Allowlist semantics: an allowlisted actor's non-hard-safety label preferences are suppressed; hard-safety labels and user blocks/mutes/keywords still apply. Notification channel preferences are consulted when `context.notificationChannel` is set. Word-boundary keyword scanner is hand-rolled (no regex compilation).
- 15 valid + 11 invalid fixtures under `packages/trust-safety/fixtures/local-controls/`.
- 100 local-controls tests including TTL expiry / not-yet-expired / pruning, allowlist vs label / hard-safety / user-block / keyword / expired-allowlist, semantic matcher injection / containment on throw / threshold bounds / mixing-fields rejection, snapshot round-trip / union/replace/newer-wins merge / stale rejection / direct-apply rejection, replay equivalence, idempotency, ReDoS guard, prototype-pollution guard, every networked scope rejected with `TS_PRIVATE_LEAK`, most-restrictive selector combination, label-preference mapping, literal `.*` keyword treatment.

Phase 1.63 reports-appeals slice (sub-module under `@lfp2p/trust-safety/reports-appeals`):

- Module version sentinel: `lfp2p.report-appeal-event.v1`.
- 5 lifecycle event kinds: `safety.report.created` (embeds full `SafetyReport`), `safety.report.acknowledged` (records ack authority + time + optional reason), `safety.report.resolved` (records resolution enum `upheld | dismissed | duplicate | invalid | escalated`, reason code, optional decisionId linking to a `SafetyPolicyDecision`, optional escalation target), `safety.appeal.created` (embeds full `SafetyAppeal`), `safety.appeal.resolved` (records resolution enum `overturned | upheld | dismissed | invalid`, required `newDecisionId` on overturned).
- New stable error code: `TS_LIFECYCLE_TRANSITION`.
- `ReportsAppealsState` frozen snapshot with six indexes: `byReportId`, `byReportIdempotencyKey` (dedup), `byTargetAuthority` (moderator-inbox surfaces), `byAppealId`, `byAppealIdempotencyKey`, `byAppealedDecisionId` ("all appeals against this decision"), plus `appliedEventIds` for replay idempotency.
- State machine enforced at apply time: report `submitted → acknowledged → resolved` with `submitted → resolved` skip-ack allowed (doctrine: authority MAY resolve immediately for clear cases); appeal `submitted → resolved`. Terminal states. Every illegal transition (ack of unknown report, double-ack, resolve of already-resolved, resolve of unknown id) throws `TS_LIFECYCLE_TRANSITION` without mutating state.
- Idempotency-key duplicates on `safety.report.created` and `safety.appeal.created` are silent no-ops at the projection layer; the `eventId` is still recorded so replay does not loop.
- `applyReportAppealEvent` is pure, deterministic, validates before mutating, freezes the result, idempotent on `eventId`.
- `seedReportsAppealsState` replays an event log producing equal state on every call — the store-reopen rebuild path.
- `classifyReportPrivacy(report)` returns `'public-routable' | 'private-only'`. `assertPrivateEvidenceOnPrivateSubject(report)` enforces, when subject is private-by-nature: media evidence must have `privacy=private` + encryption descriptor; bundle evidence must have `encrypted=true`; `encryptedBodyRef` cannot be an identity-kind ObjectRef. Guard runs before projection mutation so unsafe `safety.report.created` events are rejected with `TS_PRIVATE_LEAK` and cannot land in the store.
- `canBridgeForwardReport(report)` is a boolean structural pre-check usable by Phase 1.64 bridge admission code without decrypting anything.
- 5 valid + 4 invalid fixtures under `packages/trust-safety/fixtures/reports-appeals/`.
- 50 new tests covering every lifecycle transition (legal and illegal), idempotency dedup, replay equivalence, store-reopen rebuild, privacy classification, encrypted-evidence enforcement (private subject + unencrypted media → reject, private subject + encrypted media → accept, private subject + unencrypted bundle → reject), escalated-without-target rejection, overturned-without-newDecisionId rejection.

Phase 1.64 transport-admission slice (sub-module under `@lfp2p/trust-safety/transport-admission`):

- Module version sentinel: `lfp2p.transport-event.v1`.
- 6 transport event kinds: `transport.event.accepted | rejected | quarantined`, `transport.peer.rate_limited | quarantined`, `transport.media.rejected`. Each kind that records a decision embeds the Phase 1.61 `TransportAdmissionDecision`. `retryAfter` / `quarantineExpiresAt` validated against `createdAt`.
- Token-bucket rate limiter with **real exponential backoff** (`baseBackoffMs * 2^(consecutiveRefusals - 1)`, capped at `maxBackoffMs`). Integer-floor refill prevents fractional-token exploits. Refusals during an active cooldown do NOT escalate further. A successful admit resets the refusal counter to 0 (self-healing).
- Peer reputation tracker with time-based decay toward 0 (never crosses zero, negative-zero normalized), bounded score `[minScore, maxScore]` (default `[-1000, +1000]`), hysteresis-gated auto-quarantine (enter at `quarantineThreshold`, lift at `recoveryThreshold` OR at the hard `maxQuarantineMs` TTL, whichever comes first).
- Replay cache with TTL + bounded capacity. Oldest-first eviction so flood attack cannot OOM the bridge while preserving the TTL guarantee for non-evicted entries. Lazy pruning on insert plus an explicit `pruneReplayCache` helper.
- Audit log with structural redaction: `redactDigestRef` truncates digests to an 8-char prefix; encryption key refs are dropped entirely; CIDs are truncated to a 9-char prefix. **Timestamps rounded to whole seconds** so the log cannot serve as a high-resolution timing oracle. FIFO eviction at capacity.
- Admission decision engine: pure function `runAdmissionChecks(inputs) -> outputs` with 10 ordered checks (schema → replay → privacy scope per surface → kind allowlist → byte size → decoded-size compression-bomb guard → peer quarantine → rate limit → user-block transport [Phase 1.62 deferral] → report-forwarding privacy guard [Phase 1.63 deferral]). Per-surface privacy scope allowlists. Each failure produces a `TransportAdmissionDecision` with `action` and `reasonCode`. Successful admits credit +1 to peer reputation; failures penalize per-rule (-5 to -100).
- Phase 1.62 deferral resolved: `decideUserBlockTransport(state, context, now)` returns `producer-blocked | producer-allowed`. TTL-aware. The bridge runtime that holds the user's local-control state calls this before forwarding into the user's account-local sync.
- Phase 1.63 deferral resolved: `decideReportForwarding(report)` runs `canBridgeForwardReport` structurally — bridges MUST NOT decrypt encrypted bodies or evidence; the decision operates on declared privacy/encryption shape only.
- `TransportAdmissionState` frozen snapshot with `peerReputation`, `rateLimitState`, `replayCache`, `quarantinedPeers / Events / Media`, `auditLog`, `appliedEventIds`. `admitEnvelope(state, envelope, config, context, now)` is the canonical entry point. `applyTransportEvent` rebuilds projection from emitted events. `seedTransportAdmissionState` is the store-reopen rebuild path.
- 4 valid + 2 invalid fixtures under `packages/trust-safety/fixtures/transport-admission/`.
- 60+ new tests across 7 test files: rate-limit math (capacity, refill, exponential growth, cap, cooldown semantics, self-healing), reputation (decay, hysteresis, TTL auto-lift, bounded clamping, NaN/Infinity rejection), replay cache (TTL + capacity flood resistance + pruning), audit redaction (no key digest, no full source digest, whole-second timestamps, FIFO eviction), admission engine per check, user-block enforcement (expired block ignored), report-forwarding privacy guard.
- New doctrine document: `docs/protocol/bridge-admission-doctrine.md` with non-negotiable rules, the check-order spec, exponential-backoff and reputation math, and a "what the bridge MUST NOT do" section.

Phase 1.65 curation-runtime slice (sub-module under `@lfp2p/trust-safety/curation-runtime`):

- Module version sentinel: `lfp2p.curation-event.v1`.
- 6 lifecycle event kinds: `curation.rule.created` (embeds `CurationRule`), `curation.rule.disabled` (ruleId + disabledBy authority + reasonCode), `curation.item.boosted` / `.downranked` (itemSubject + surface + sourceRuleId + scoreDelta + reasonCode), `curation.item.excluded` (same + `excludeFrom: 'feed' | 'search' | 'recommendation'`), `curation.explanation.recorded` (embeds `CurationExplanation`).
- Score deltas bounded `[0, MAX_SCORE_DELTA = 100]` non-negative safe integer so a single rule cannot dominate the ranking and an adversary cannot push the projection into a non-recoverable state.
- `excludeFrom` per exclusion event so a single exclusion cannot accidentally target all three surfaces — enforces the doctrine distinctions structurally.
- Rule state machine `active → disabled` (terminal). Re-creation under existing ruleId, double-disable, and disable-unknown all throw `TS_LIFECYCLE_TRANSITION` without mutating state.
- `CurationState` frozen snapshot with `rulesById`, `itemsBySubjectKey`, `explanationsById`, `appliedEventIds`. `applyCurationEvent` is pure/deterministic/idempotent. `seedCurationState` is the store-reopen rebuild path.
- `computeItemRanking(state, subject)` returns `effectiveNetScoreDelta` and per-surface exclusion flags **filtered to currently-active source rules** — disabling a rule immediately retracts its effect from the ranking view without rewriting history. The audit trail (every item action with its `sourceRuleId`) is preserved.
- `subjectKey` stably encodes any `SafetySubjectRef` for use as a record key; private-by-nature subjects key by source digest body or CID, never the encryption-key digest.
- `decideCurationSurfaceIngest(surface, envelopeScope, subject)` is the public-surface gate. Public surfaces (`public-feed`, `search`, `recommendation`) reject every non-public envelope scope and reject private-by-nature subject types even on a public envelope. Local surfaces (`local-feed`, `community-feed`, `notification`) accept any scope.
- **Phase 1.63 deferral resolved**: `decideReportAsCurationSignal(report, surface)` refuses to use a `private-only` report (per `classifyReportPrivacy`) as a curation signal on public surfaces. Bridge surfaces and curation surfaces now share the same private-report structural guard.
- `assertCurationSurfaceIngest` and `assertReportAsCurationSignal` are the strict variants that throw `TS_PRIVATE_LEAK` at the boundary.
- 6 valid + 3 invalid fixtures under `packages/trust-safety/fixtures/curation/`.
- 60+ new tests covering event validation, lifecycle (legal and every illegal transition), distinctions (downrank ≠ hide, search exclusion ≠ deletion, recommendation exclusion ≠ feed/search), accumulating actions, disabled-rule retraction, idempotency, replay equivalence, duplicate-`explanationId` no-op, surface gate matrix across every public/local surface, private-only report refusal on public surfaces, public-routable report acceptance, local-surface acceptance of any scope.
- New doctrine document: `docs/protocol/curation-doctrine.md` with the five non-negotiable distinctions, the surface gate spec, the rule lifecycle, item-action accumulation rules, and a "what the curation runtime MUST NOT do" section.

**Hardening pass (Phase 1.65)** applied to all three prior projections:

- `assertId` now rejects reserved JavaScript property names (`__proto__`, `prototype`, `constructor`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toString`, `valueOf`) with new stable code `TS_FORBIDDEN_KEY`. Bad input fails at the validator boundary before reaching any projection record.
- New shared module `packages/trust-safety/src/projection-helpers.ts` (`withFrozenRecordSet`, `withFrozenRecordDelete`, `withFrozenBucketAppend`, `withFrozenAppliedEventId`) uses `Object.defineProperty` with explicit data-descriptor flags so even a forbidden key that bypassed validation lands as an own-property rather than mutating the prototype chain. All three prior projections (`local-controls`, `reports-appeals`, `transport-admission`) refactored to use the shared helpers — no duplicate code.
- 29 new tests in `hardening-prototype-pollution.test.ts` covering `isForbiddenIdKey`, the defensive helpers (set / delete / bucket-append / mass operations with Object.prototype untouched), and per-projection rejection of every reserved id key.

Phase 1.66 labelers-runtime slice (sub-module under `@lfp2p/trust-safety/labelers-runtime`):

- Module version sentinel: `lfp2p.labeler-event.v1`.
- 7 lifecycle event kinds: `safety.labeler.profile.published`, `safety.label-definition.published`, `safety.labeler.subscribed`, `safety.labeler.unsubscribed`, `safety.label.applied`, `safety.label.revoked`, `safety.annotation.created`.
- `SafetyLabelerProfile` (Phase 1.61) gained two optional fields under the same v1 schema: `kind: LabelerKind` (taxonomy with 7 values — `human-curated`, `automated-classifier`, `hybrid`, `attestation`, `community-aggregator`, `media-scanner`, `unknown`) and `aggregatorOf: ReadonlyArray<string>` (required for `community-aggregator`, rejected for others, no self-loops, must be non-empty).
- `LabelersState` projection with `labelerProfilesById`, `labelDefinitionsByKey`, `subscriptionsById`, `labelsByLabelId`, `labelsBySubjectKey`, `annotationsById`, `appliedEventIds`. State machines: profile re-publish supersedes; subscription `active → unsubscribed` terminal; label `active → revoked` terminal; cross-labeler revoke rejected.
- **Composable / stackable resolution**: `effectiveLabelsForSubject(state, subjectKey, subscriberActorId, options?)` returns `ResolvedLabel[]` — one entry per (labelKey × issuing labeler) with full provenance (issuerActorId, issuerLabelerId, labelerKind, severity, confidence, effectiveAction, appliedAt). Subscriber-side filtering: revoked / unsubscribed-from / non-trusted-namespace / non-trusted-label entries excluded. Per-labeler `actionOverride` from the subscription derives `effectiveAction`; falls through to `SafetyLabelDefinition.defaultAction` then to a severity-derived conservative default. Companion `mostRestrictiveAction(stack)` picks the highest-rank action.
- Improvements over ATProto: private-by-default subscriptions (Phase 1.62 carryover), per-namespace + per-label trust, hard-safety can't be downgraded, first-class aggregators with trust-loop guard, fully transparent stacking.
- 6 valid + 3 invalid fixtures under `packages/trust-safety/fixtures/labelers/`.
- 27 new tests covering 2-labeler stacking with distinct kinds, per-labeler override producing per-labeler effectiveAction, cross-labeler revoke rejection, same-labeler revoke success, unsubscribed mid-stack filtering, per-namespace + per-label trust, profile re-publish supersedes, replay equivalence, aggregator cross-checks (without-sources / self-loop / non-aggregator-with-field), lifecycle illegal transitions.
- New doctrine document: `docs/protocol/labeler-runtime-doctrine.md` with ATProto-to-our-architecture mapping table, 12 explicit improvements over ATProto, state machine reference, "what the labeler runtime MUST NOT do" section.

Phase 1.67 moderation-runtime slice (sub-module under `@lfp2p/trust-safety/moderation-runtime`):

- New shape `SafetyPolicy` (`lfp2p.safety-policy.v1`) with versioned policy chain (policyId, policyVersionNumber, title, body, scope, applicableActions, createdBy, createdAt, optional supersedesPolicyVersionNumber cross-validated < policyVersionNumber).
- Module version sentinel: `lfp2p.moderation-event.v1`.
- 7 lifecycle event kinds: `safety.policy.created`, `safety.policy.updated`, `safety.policy.deprecated`, `safety.policy.decision.recorded` (wraps existing `SafetyPolicyDecision`), `moderation.queue.item.created`, `moderation.queue.item.assigned`, `moderation.queue.item.resolved`.
- `ModerationState` projection with rich cross-reference indexing: `policiesByPolicyIdAndVersion` (every version preserved), `activePolicyVersionByPolicyId` (cleared on deprecation), `decisionsById`, `decisionsBySubjectKey`, `decisionsByPolicyId`, `queueItemsById`, `queueIdsByStatus` (open/assigned/resolved), `queueIdsByAssignee` (moderator inbox), `queueIdsBySourceId` (cross-ref from `(sourceKind, sourceId)` → queue items), `appliedEventIds`.
- Policy state machine: `absent → active@v1 → active@v2 → ... → deprecated@vN` (terminal). Updates require `policyVersionNumber = active + 1` AND `supersedesPolicyVersionNumber = active`. Deprecation does NOT retroactively reverse decisions (audit-preserving).
- Queue state machine: `open → assigned → resolved` with `open → resolved` skip-assignment permitted; terminal at resolved. Every illegal transition rejected with `TS_LIFECYCLE_TRANSITION`.
- Decision recording: append-only by `decisionId`; duplicate silent no-op.
- Two-way linkage: queue resolution cites `resolutionDecisionId`; decision references `sourceQueueItemId`. Phase 1.63 integration: `queueItemsForSource('report', reportId)` returns all queue items spawned from a report.
- 3 valid + 3 invalid fixtures under `packages/trust-safety/fixtures/moderation/`.
- 28 new tests covering every legal and illegal state machine transition (policy version chaining, skip-version rejection, mismatched supersedes pointer, deprecation preserves past decisions, queue lifecycle every illegal case), decision-recording subject + policyVersion cross-indexing, queue ↔ decision two-way linkage, `queueItemsForSource` cross-reference, replay equivalence, eventId idempotency.
- New doctrine document: `docs/protocol/moderation-runtime-doctrine.md` with what-this-is / what-this-is-NOT, five non-negotiable rules, state machine diagrams, cross-reference index table, integration points with Phase 1.61 / 1.63 / 1.66, "what moderation runtime MUST NOT do" section.

Phase 1.68 — T&S completion sweep (docs-only):

- Threat model (`docs/threat-model/trust-safety-and-abuse.md`) appended with an "Implementation update — Phase 1.62.1 through 1.67" section documenting threats and mitigations introduced by the expansion, deferral integrations, surface gate, hardening pass, labeler runtime, and moderation runtime.
- New canonical entry point `docs/implementation/trust-safety-complete-summary.md` surveying the full 1.6x stack: phases shipped, sub-modules with public surface + doctrine, dependency graph (no cycles), per-consumer "how to consume" sections, explicit non-deferred deferrals table, boundary discipline statement, final acceptance criteria checklist.

Phase 1.69 — content categories, labeler capabilities, overlap detection:

- New module `@lfp2p/trust-safety/content-categories` with `CONTENT_CATEGORY_NAMESPACE = 'lfp2p.content-category.v1'` and a 20-entry standard registry matching Bluesky's built-in content filters (adult / violence / hate / spam / impersonation / misleading / political / religion / gambling / screenshot.crossplatform). Each entry carries `isAdult`, conservative `defaultAction` (Bluesky-style), and a description. `decideContentCategoryAction(category, userPreference, gateEnabled)` resolves the effective action — adult categories force `hide` when the master gate is off, regardless of any user preference. `getContentCategory`, `isContentCategoryKey`, `ADULT_CONTENT_CATEGORY_KEYS` exported.
- `SafetyLabelerProfile.capabilities?: LabelerCapability[]` added as an additive v1 field. `LabelerCapability` carries `capabilityId` (pattern `(detect|classify|scan|attest|aggregate|x).<segment>(.<segment>)*`), `description`, `producesLabels` (non-empty, cross-checked subset of `profile.supportedLabels`), and optional RFC-6838 `mediaTypes`. `STANDARD_LABELER_CAPABILITIES` registry of 20 well-known IDs (e.g. `detect.twitter-screenshot`, `classify.spam`, `scan.media-csam`, `aggregate.community-list`). `isStandardCapability` predicate. Custom `x.*` namespace allowed for community extensions.
- New local-control event kind `safety.adult-content.gate.set` (13th) carrying `{ enabled, gatedAt }`. `LocalControlState.adultContentGate?: { enabled, gatedAt }` populated by `apply`, cleared by `revert`. Gate remains private — `assertLocalControlEnvelopeScope` continues to reject any non-private scope with `TS_PRIVATE_LEAK`.
- New `labelers-runtime/overlap.ts` module. `findOverlappingSubscriptions(state, subscriberActorId)` returns active-subscription pairs with `level` of `full` (one side's capabilities is a subset of the other's), `partial`, `capability-only`, or `label-only`. `detectRedundantSubscription(state, subscriberActorId, candidateLabelerId)` is the pre-subscribe UI-warning helper. Behavioural pinning by 27 new tests in `phase-1.69.test.ts`: Twitter-screenshot labeler + profanity labeler ⇒ no warning; second `classify.spam` ⇒ warning citing the existing labeler.
- 2 new fixtures (`profile-with-capabilities.json`, `adult-content-gate-enabled.json`) picked up by existing `it.each` fixture validators.
- New doctrine document: `docs/protocol/content-categories-doctrine.md` with Bluesky-mapping table, full 20-category reference (with adult / default columns), adult-content gate semantics, capability namespace spec, overlap-detection levels.

Phase 1.70 — PWA T&S settings + hashtag/phrase match kinds:

- `@lfp2p/trust-safety` adds `phrase` and `hashtag` to `KEYWORD_MATCH_KINDS` as first-class, linear-time match kinds. Hashtag body must match the constant Unicode pattern `^[\p{L}\p{N}_]{1,140}$`; the value is stored without `#` and lowercased. Phrase trims and collapses internal whitespace runs at validation time and matches case-insensitively. Author-supplied general regex remains forbidden — two adversarial timing tests pin both new matchers under 200 ms on 20 000-char inputs that would catastrophically backtrack against a naive `(?:a+)+$`. 4 new fixtures (2 valid + 2 invalid) and 32 new tests in `phase-1.70-keyword-kinds.test.ts`.
- `@lfp2p/local-store` ships Dexie schema v7 with two append-only event-log tables (`trustSafetyControlEvents`, `trustSafetyLabelerEvents`) keyed by `eventId` with monotonic `sequence`. `appendTrustSafetyControlEvent` / `appendTrustSafetyLabelerEvent` re-validate at the persistence boundary, are idempotent on `eventId`, and run inside a Dexie transaction. `loadLocalControlState` / `loadLabelersState` re-validate every row on read (skip-and-continue on corruption) and replay through the protocol's pure projection. 6 new tests in `trust-safety-persistence.test.ts` exercising round-trip equivalence with in-memory replay, idempotency, append-time rejection of malformed events, and survival across store close + reopen.
- PWA settings surface (`apps/pwa/src/pwa-trust-safety-state.ts` pure logic + `pwa-trust-safety-settings.tsx` React) renders the Bluesky-equivalent T&S controls in one screen: adult-content master gate toggle with explicit 18+ confirm before enabling; 20-category preference list with Show / Warn / Hide buttons per row and locked indicator for adult categories when the gate is off; keyword filter add/remove with the 4 UI match kinds (`substring`, `word`, `phrase`, `hashtag`) and an explicit "regex is intentionally not offered" note; labeler subscription list with `findOverlappingSubscriptions` warning callout and `detectRedundantSubscription` pre-subscribe assessment helper. 32 new tests in `pwa-trust-safety-state.test.ts`.
- Doctrine note added to `docs/protocol/local-controls-portability.md` covering the ReDoS guard on the new kinds.

Phase 1.71 — block-evasion hardening pack:

- **Phase 1.71.A** — every non-semantic keyword matcher (`substring`, `word`, `phrase`, `hashtag`) runs through a Unicode-normalization pipeline (NFKD → lowercase → strip zero-width / combining marks → confusables map) on both haystack and needle before comparison. Defeats leet (`sp0iler`), zero-width-space, Cyrillic homoglyph (`ѕpoiler`), full-width (`ＳＰＯＩＬＥＲ`), circled-letter (`ⓢⓟⓞⓘⓛⓔⓡ`), and combining-diacritic (`spoîler`) evasions. All patterns precompiled against literal source; `Map<string, string>` confusables table immune to prototype pollution. Linear-time, sub-second on 20 000-char pathological inputs.
- **Phase 1.71.B** — `applyReportAppealEvent` enforces a per-(reporter, subject, UTC day) rate cap on `safety.report.created` with new stable error code `TS_REPORT_RATE_LIMITED`. Default cap is 10/day, configurable via `ApplyReportAppealEventOptions.maxReportsPerReporterSubjectDay`, opt-out via `Infinity`. Cap fires AFTER `appliedEventIds` replay no-op AND AFTER idempotency-key dedup so replay determinism is preserved.
- Bucket key is `JSON.stringify([reporterKey, utcDay, subjectKey])` — an attacker who crafts a reporter id containing the literal delimiter cannot collide with a legitimate user's bucket. (Hardening review caught + fixed a `::`-without-escaping collision bug pre-commit; pinned by dedicated test.)
- 32 new adversarial tests in `phase-1.71.test.ts`.
- Doctrine: `docs/protocol/block-evasion-resilience.md` with full defeat matrix, explicit non-defenses (sock-puppets and coordinated brigading point to right future slice), composition with `decideVisibility`'s `mostRestrictive` combiner.

Not implemented yet:

- `@lfp2p/search` and a future feed runtime that materializes a ranked feed by consuming `computeItemRanking`.
- Dexie projection persistence for local-control events, reports-appeals, transport-admission, curation, labelers, and moderation state; PWA settings UI to emit them.
- Labeler HTTP/WS API (future `apps/labeler-service`) and subscriber-side ingestion runtime (`packages/sync-client`).
- Moderation tools API + UI (future `apps/moderation-tools`).
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
- **Phase 2.1**: stable `IDENTITY_*` error-code namespace (`errors.ts`) and pure shape validator (`validation.ts`). `validateIdentityEvent` enforces version pinning, kind allowlist, prototype-pollution defense at every payload-object boundary, public-key wire-format check, digest-reference wire-format check, epoch hygiene, scope length bounds, and a 16 KB serialized-payload cap. Two new event kinds: `identity.device.rotated` (in-place key swap; rejects unknown device, revoked device, same-key reuse, and `previousPublicKey` mismatch) and `identity.contact-card.published` (audit trail for contact-card publication; projection retains the most recent digest under `state.contactCardPublication`). Projection now re-runs the pure validator on identity events before any mutation. 7 valid + 6 invalid fixtures; 39 new tests.
- **Phase 2.2** (persistence + PWA wiring): regression fix for the Phase 2.1 follow-on bug where `isIdentityControlEvent` in `@lfp2p/sync-client` was silently dropping `device.rotated` and `contact-card.published` (the events were stored but the projection didn't update); both now dispatch correctly and the fix is pinned by a regression test. `StoredIdentityControlProjection` extended with `contactCardPublication` and propagated through `applyIdentityControlProjectionUpdate` / `toIdentityControlState`. New `DexieLocalFirstStore.appendLocalIdentityEvent` (atomic, idempotent-on-eventId entry point for locally-emitted identity events) and `listLocalIdentityEvents` (replay-from-log helper for caller-side `seedIdentityControlProjection`). PWA `pwa-identity-emit.ts` ships `emitContactCardPublishedEvent` (wired into the existing `exportContactCard` flow — every contact-card export now records a publication audit with a `sha-256:<base64url>` digest) and `emitDeviceRotatedEvent` (helper for the future rotation UI). 15 new tests in `phase-2.2.test.ts` and `pwa-identity-emit.test.ts`. New doctrine: `docs/protocol/revocation-realism.md` pinning what each revocation primitive does and does not guarantee, with a UI language guide.
- **Phase 2.3a** (threat model): `docs/threat-model/identity-control.md` covers ten threat scenarios (T-IDC-1…T-IDC-10) with explicit defense status, residual risk, and a consolidated gap table mapping each undefended surface to its target future phase. Pairs with `revocation-realism.md` (UX) and `local-verifier.md` (boundary enforcement).
- **Phase 2.3b** (audit + rotation UI): PWA `IdentityAudit` component (`apps/pwa/src/pwa-identity-audit.tsx`) renders devices + capabilities + contact-card publication audit. Non-controller active devices show a "Rotate key" affordance that generates a fresh `SigningKeypair` via `@lfp2p/crypto`, displays both old and new fingerprints in a confirmation dialog, and calls `emitDeviceRotatedEvent` end-to-end. Controller-device rows show an explicit deferred-flow message. View-model helpers in `pwa-identity-audit-state.ts`: `buildIdentityAuditViewModel`, `prepareRotationIntent`, `shortPublicKeyFingerprint`. 17 new tests in `pwa-identity-audit-state.test.ts`.

Not implemented yet:

- Full account-level identity workflow that migrates local bootstrap into authoritative root/controller lifecycle management.
- Controller-key recovery / supersession (new ADR required).
- Capability delegation chains (delegate-of-delegate; new ADR required).
- Multi-controller accounts (new ADR required).
- Cross-app sync of identity events (depends on ADR-002 account-local sync envelope, Phase 5.0).
- Periodic snapshot-vs-log integrity check.
- Contact-card import/export beyond the local signed-JSON exchange flow already shipped.

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
