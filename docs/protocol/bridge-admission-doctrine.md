# Bridge / Relay / Super-Peer Admission Doctrine

- Status: Draft
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related implementation docs:
  - `docs/implementation/trust-safety-phase-plan.md`
  - `docs/implementation/phase-1.61-exit-report.md`
  - `docs/implementation/phase-1.62-exit-report.md`
  - `docs/implementation/phase-1.63-exit-report.md`
- Package: `@lfp2p/trust-safety/transport-admission`

## Non-negotiable rules

1. **Bridge-local rejection is not global deletion.** An admission
   decision applies only at the surface that issued it. Other
   bridges, relays, super-peers, indexes, and apps are not obligated
   to honor it. The protocol-level data the rejection references
   (the envelope, the media block, the report) is untouched on every
   other surface.
2. **No private-payload bytes ever appear in operator logs.** The
   admission engine's audit log is structurally redacted at the
   helper layer: digests are truncated to an 8-char prefix,
   encryption-key refs are dropped entirely, CIDs are truncated to a
   9-char prefix. The bridge MUST NOT decrypt encrypted bodies or
   evidence.
3. **Decisions cite exact `ObjectRef` / `BlockRef` values for media
   evidence.** When a transport.media.rejected event references a
   media block, the BlockRef is preserved in the event so a
   downstream review can locate (but not necessarily decrypt) the
   exact bytes.
4. **Rate limits and quarantines are infrastructure-scoped.** A peer
   rate-limited at one bridge is not rate-limited everywhere. A peer
   quarantined at one relay is not quarantined elsewhere. Apps and
   other surfaces may choose to subscribe to advisory peer-reputation
   feeds but MUST NOT treat them as authoritative.
5. **Operator self-protection ≠ moderation authority.** The admission
   engine produces `accept | accept-limited | reject | quarantine |
   rate-limit | drop-duplicate` decisions for the operator's own
   surface. Producing a `SafetyPolicyDecision` (moderation) requires
   the appropriate moderator/admin authority scope; it is NOT what
   the admission engine does.

## Self-healing

- **Rate-limit cooldowns reset** on a successful admit (exponential
  backoff returns to its base after the peer behaves).
- **Peer reputation decays toward 0** over time. A short attack
  window does not produce a permanent ban; the score climbs back
  through normal traffic.
- **Quarantines auto-lift** when (a) reputation crosses above the
  recovery threshold (hysteresis gap above the entry threshold so
  there is no flapping), or (b) the hard TTL elapses, whichever
  comes first.
- **Replay cache evicts oldest-first** when at capacity, so an
  attacker flooding the cache with bogus idempotency keys cannot
  cause OOM and cannot retain entries past the TTL.

## Exponential backoff math

The rate limiter is a token bucket with these rules:

- Tokens refill at `refillRatePerSecond` based on elapsed time, capped
  at `capacity`. Refill is integer-floored so an attacker cannot
  exploit fractional-token rounding.
- On admission, one token is consumed.
- A refusal at `now` sets `cooldownUntil = now + baseBackoffMs *
  2^(consecutiveRefusals - 1)`, capped at `maxBackoffMs`.
- Requests during `cooldownUntil` are refused without altering the
  bucket — they do not escalate the backoff further.
- The next request after the cooldown elapses either admits (if
  tokens have refilled) and resets `consecutiveRefusals = 0`, or
  refuses and doubles the cooldown again.

This is the standard exponential-backoff pattern. The cap exists so
a single bug cannot lock a peer out forever.

## Peer reputation math

- Score is a signed integer bounded `[minScore, maxScore]` (default
  `[-1000, +1000]`).
- Negative actions subtract a fixed delta; positive actions add a
  smaller fixed delta. The exact deltas live in the admission
  engine, NOT in this package.
- Score decays toward 0 at `decayPerSecond` units per second of
  elapsed wall-clock time. Decay never crosses zero; a positive
  score never becomes negative via decay, and vice versa.
- When the score crosses below `quarantineThreshold`, the peer is
  auto-quarantined until `now + maxQuarantineMs` OR until the score
  climbs back above `recoveryThreshold` (the hysteresis upper bound).
- Negative-zero is normalized to `+0` so equality tests behave
  intuitively.

## Admission check order

Earlier checks short-circuit later ones. Some checks penalize the
peer's reputation; others (user-block) do not.

1. **Schema shape.** Sanity-check envelope fields (byte size finite,
   non-negative). Failure → `reject` / `system.malformed-object`.
2. **Replay / idempotency.** Check the replay cache. Duplicate →
   `drop-duplicate` / `system.replay`. No reputation penalty (a
   duplicate may be a retry, not malice).
3. **Privacy scope.** Each surface has its own safe-scope set:
   - `bridge`, `relay`, `media-store`: `{dm, group, public}`
   - `super-peer`: `{group, public}`
   - `public-index`: `{public}`
   - `device-local` and `self` never traverse a surface.
   Failure → `reject` / `system.disallowed-scope`. Reputation
   penalty: -10.
4. **Event kind allowlist.** If the operator has restricted kinds at
   this surface, anything outside → `reject` /
   `system.malformed-object`. Reputation penalty: -5.
5. **Byte size.** Each surface has its own default cap. Failure →
   `reject` / `system.malformed-object`. Reputation penalty: -25.
6. **Decoded-size guard (compression bomb).** If the caller knows
   the decoded size and it exceeds `maxBytes * 1024`, reject.
   Reputation penalty: -100.
7. **Peer quarantine.** If the peer is currently quarantined (per
   the reputation tracker), reject without consulting the rate
   limiter.
8. **Rate limit.** If the bucket cannot grant a token, `rate-limit`
   / `system.rate-limit`. Reputation penalty: -10.
9. **User-block transport (Phase 1.62 deferral).** If a recipient
   context is supplied AND the producer is in the recipient's
   `blockedActors`, reject with `policy.local-preference`. No
   reputation penalty — the block is the recipient's choice, not
   evidence of misbehavior.
10. **Report-forwarding (Phase 1.63 deferral).** If the envelope
    carries a `SafetyReport`, structurally check
    `canBridgeForwardReport`. Failure → reject with
    `system.malformed-object`. The bridge MUST NOT decrypt anything
    to perform this check; the rule operates on declared structure.

A successful admit credits +1 to the peer's reputation.

## What the bridge MUST NOT do

- **Decrypt encrypted bodies.** The structural privacy guard
  examines declared `BlockRef.privacy` and `BlockRef.encryption`
  fields, not the bytes.
- **Inspect private payload contents.** A report whose subject is
  private-by-nature passes through opaquely or is rejected outright;
  there is no "let me peek" path.
- **Treat a block / mute / quarantine as a moderation broadcast.**
  Decisions are operator-scoped. To moderate beyond a single
  surface, the appropriate authority issues a `SafetyPolicyDecision`
  via Phase 1.61 / 1.63 machinery — not via the admission engine.
- **Use high-resolution timestamps in logs.** Audit entries round
  to whole seconds so the log cannot be used as a fingerprinting
  oracle for request timing.

## What apps and other surfaces SHOULD do

- Subscribe to advisory peer-reputation feeds where they exist, but
  weight them against their own evidence. Reputation from an
  unfamiliar bridge is informational, not authoritative.
- Forward a `transport.media.rejected` decision to the publishing
  actor or upstream when the operator has configured that policy,
  but never treat it as a deletion order.
- Audit operator authority claims. An admission decision whose
  `operatorAuthority.scope` is not a transport scope is invalid by
  construction (Phase 1.61 validator catches it).

## Runtime wiring (Phase 4.1, 2026-06-04)

The Phase 1.64 engine + projection + fixtures + tests have been wired
into the production bridge surface via a thin integration layer:

- `apps/bridge-service/src/admission-gateway.ts` exposes
  `BridgeAdmissionGateway`, a class that owns the latest
  `TransportAdmissionState` (frozen per Phase 3.2 invariant 2) and
  exposes a single `admit(request, nowMs)` method.
- `BridgeService` accepts an optional `admission` constructor option.
  When provided, every accepted delivery is projected into an
  `AdmissionEnvelope` and run through `admitEnvelope` BEFORE the
  store mutation. Rejections short-circuit with a stable reason of
  the form `<action>:<reasonCode>` (e.g. `rejected:oversized:1234`,
  `rate-limited:transport.rate-limit`, `drop-duplicate:system.replay`).
- The gateway never logs payload contents. The reason string
  contains only the engine's stable action label and reason code,
  per the Phase 3.1 privacy-safe-logging doctrine.

### Ordering inside `acceptDelivery`

The integration runs admission AFTER the cheap deterministic checks
and BEFORE store mutation:

```
1. envelope shape (validateSignedEvent)
2. bridge-safe privacy scope (`dm` / `group` / `public`)
3. signature verification
4. ──── ADMISSION GATEWAY ────
5. idempotency-key dedup (existing store check)
6. store insert
```

**Rationale for step 4 placement:** signature verification (step 3)
runs BEFORE admission so a forged envelope from an attacker cannot
burn a legitimate producer's per-peer rate-limit budget. A tampered
envelope is rejected with `Event signature verification failed`
without consuming any admission state. The
`admission-gateway.test.ts` pins this invariant.

### Backward compatibility

The `admission` option is optional. A `BridgeService` constructed
without admission preserves pre-Phase-4.1 behavior exactly — all
existing bridge tests continue to pass unmodified. **Production
deployments MUST configure admission**; the doctrine treats the
admission engine as a non-negotiable runtime requirement.

### peerId discipline

`BridgeDeliveryRequest.peerId` is optional. Production wiring (HTTP
or WebSocket handler) SHOULD supply a transport-level peer
identifier (TLS client identity, WebSocket connection id, etc.). If
omitted, the gateway falls back to `event.deviceId`. The fallback
is documented but is NOT a substitute for a real transport-level
peer in production: per-peer rate limits and reputation only
function correctly when distinct peers map to distinct ids.

### HTTP-layer hardening (Phase 4.3)

The Phase 4.1 admission engine runs AFTER the bridge has parsed the
delivery body. Without Phase 4.3, a hostile client could:

- POST a 1 GB body and consume the bridge's memory before admission
  even sees the envelope;
- repeatedly probe with random tokens; the bridge already used
  constant-time comparison but had no quota, so a credential-stuffing
  attack burned no budget at the HTTP layer;
- mount a slow-loris or chunked-encoding attack to bypass naive
  `Content-Length` checks.

Phase 4.3 closes these by adding three cheap-first checks BEFORE the
admission engine runs:

1. **Content-Length pre-check** rejects with `413 Payload Too Large`
   when the declared length exceeds `maxRequestBytes` (default
   1 MiB, matching the engine's `DEFAULT_MAX_BYTES_BY_SURFACE.bridge`).
   Malformed Content-Length headers (non-integer, leading garbage,
   absurdly long) become `400 Bad Request`.
2. **Streaming body cap** enforces the same byte limit while reading
   the body, so a chunked-encoded upload that omits or lies about
   Content-Length still cannot exceed the cap. The reader is cancelled
   as soon as the accumulator crosses the cap; no further bytes are
   buffered.
3. **Multi-token bearer auth registry** with optional per-token
   `expiresAt`. The legacy single-token shape continues to work
   unchanged; multi-token is preferred for production. Expired tokens
   are treated identically to unknown tokens in the response so a
   prober cannot fingerprint the registry. Constant-time comparison
   runs against EVERY token in the registry per request — even when
   the first matches — so a timing oracle cannot leak registry size
   or position.

After successful auth the request flows through the per-token rate
limiter (also Phase 4.3), then the streaming body read, then the
existing parse + admission + store flow.

#### Response-shape discipline (privacy-safe)

- `401 Unauthorized` body is identical for every failure mode (no
  token, malformed header, unknown token, expired token). The
  `WWW-Authenticate: Bearer realm="lfp2p-bridge"` header is always
  present (RFC 6750 §3).
- `413 Payload Too Large` body never echoes payload contents.
- `429 Too Many Requests` body never echoes token contents; the
  `Retry-After` header (RFC 7231 §7.1.3) carries the cooldown in
  whole seconds, clamped to `[1, 3600]` so a cooldown bug cannot
  advise the client to sleep for years.
- `503 Service Unavailable` is reserved for operator misconfiguration
  (auth shape invalid, options arg `null` from a legacy caller).

#### Per-token rate limiter

`BridgeHttpRateLimiter` is built on the engine's
`createRateLimitBucket` + `tryConsume` primitives (Phase 1.64). The
exponential-backoff math, self-healing on first success, and refill
semantics are byte-for-byte identical to the admission engine's
per-peer limiter — no logic duplication.

Per-token buckets live in process memory only. A future slice may
persist them via the same `AdmissionStateStore` pattern; today a
restart resets all HTTP-layer buckets but the admission engine's
per-peer budgets remain durable (Phase 4.2).

#### Operator misconfiguration

- An auth config whose `tokens` array is empty, contains duplicate
  ids, contains a token with non-ASCII characters, or contains a
  malformed `expiresAt`, throws at `normalizeAuthConfig` time. The
  handler surfaces this as `503 Bridge auth misconfigured` rather
  than failing open.
- A `null` options arg (sometimes supplied by older callers) is
  treated as misconfigured rather than throwing a TypeError. Tests
  pin this.

### State persistence (Phase 4.2)

Phase 4.1 held `TransportAdmissionState` in process memory only.
Phase 4.2 closes that gap with an optional `AdmissionStateStore`
that snapshots the full state on every successful admit.

- **Snapshot, not event-log.** The Phase 1.64 audit log is FIFO-
  evicted at capacity, so it cannot serve as the source of truth
  for a startup replay. We persist the full state snapshot
  instead. Size is bounded by the engine's own per-field caps
  (replay-cache `maxEntries`, audit-log `capacity`, etc.).
- **Fail-closed save.** `BridgeAdmissionGateway.admitAndPersist`
  writes the new state via `stateStore.save` BEFORE advancing the
  in-memory reference. A save failure throws and the in-memory
  state DOES NOT advance. `BridgeService.acceptDelivery` translates
  the throw into a rejection response with reason
  `admission-persist-failed:<ErrorClassName>` — a stable static
  label, never the underlying IO message (per Phase 3.1
  privacy-safe logging).
- **Atomic on disk.** `JsonFileAdmissionStateStore` writes to a
  sibling temp file (`<filePath>.<pid>.<suffix>.tmp`) then
  `fs.rename`s. POSIX guarantees same-filesystem rename is atomic,
  so a crash mid-write leaves either the prior file intact OR the
  new file fully in place — never a partial state.
- **Refuses to start on corruption.**
  `BridgeAdmissionGateway.create({stateStore})` propagates load
  errors (`AdmissionStateCorruptError` for shape mismatches; raw
  `SyntaxError` would similarly propagate from malformed JSON).
  The operator decides whether to delete the bad snapshot and
  restart with a clean budget. We deliberately do NOT silently
  start fresh on corruption — that would let an attacker who
  corrupted the file (or a buggy upgrade producing an incompatible
  shape) gain a fresh budget every restart.
- **Set serialization discipline.** The only non-JSON-native field
  in `TransportAdmissionState` is `appliedEventIds: ReadonlySet<string>`.
  The serializer emits it as a sorted array; the deserializer
  rehydrates a frozen `Set`. Deep-freezing on load matches the
  Phase 3.2 integrity-suite invariant — the rehydrated state is
  Object.isFrozen at every nested node.
- **Pinned wire version.** Snapshots carry an explicit
  `version: 'lfp2p.admission-state-snapshot.v1'` field. A future
  incompatible shape change requires a new version, and a
  mismatched version is a structural corruption (the deserializer
  throws), not a silent reinterpretation.
- **Concurrency.** The gateway docs continue to require sequential
  `admit` calls per instance. The persistence layer does not add
  any locking — it inherits whatever guarantees the bridge runtime
  already provides.

## Implementation evidence

- Engine: `packages/trust-safety/src/transport-admission/`
  (Phase 1.64).
- Bridge wiring: `apps/bridge-service/src/admission-gateway.ts`,
  `BridgeService` constructor + `acceptDelivery`.
- Tests: `packages/trust-safety/src/__tests__/` (engine);
  `apps/bridge-service/src/admission-gateway.test.ts` (wiring,
  14 tests pinning happy path, byte cap, kind allowlist,
  drop-duplicate, per-peer isolation, peerId fallback,
  signature-before-admission ordering, state-advance, and
  privacy-safe rejection reasons).
- 4 valid + 2 invalid fixtures covering accepted / rate-limited /
  quarantined / media-rejected.
- Exit reports: `docs/implementation/phase-1.64-exit-report.md`,
  `docs/implementation/phase-4.1-exit-report.md`.
