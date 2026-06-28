# Phase 4.5 — Production Bridge Runtime Hardening

- Status: Draft
- Date: 2026-06-28
- Roadmap position: between Phase 4.4 (Durable Streams) and Phase 5 (Bridge Resumability)
- Depends on:
  - `docs/implementation/phase-4.1-exit-report.md` — admission gateway
  - `docs/implementation/phase-4.2-exit-report.md` — admission state persistence
  - `docs/implementation/phase-4.3-exit-report.md` — HTTP-layer hardening
  - `docs/implementation/phase-4.4-exit-report.md` — Durable Streams
  - `docs/protocol/bridge-admission-doctrine.md` — check order + non-negotiables

## Purpose

Phases 4.1–4.4 built the bridge runtime but left several concrete gaps
with explicit "deferred" markers in their exit reports. This phase closes
them before bridge resumability (Phase 5) widens the transport surface
further and before the relay/super-peer policy layer (Phase 4.6) adds
a second enforcement tier.

Three categories of work:

1. **T&S deferral closures** — admission doctrine checks #9 and #10
   exist in `@lfp2p/trust-safety` but are not wired into the gateway.
2. **Persistent rate-limiting and token management** — HTTP-layer rate
   limits and the token registry are in-memory only; a bridge restart
   silently resets abuse budgets and cannot rotate credentials without
   a process restart.
3. **Auth audit log** — successful and failed authentication attempts
   produce no operator-side log today.

## T&S deferral closures

### Check #9 — user-block transport (`decideUserBlockTransport`)

`decideUserBlockTransport(state, { producerActorId, recipientUserId? }, nowMs)`
exists in `@lfp2p/trust-safety/local-controls` and is covered by tests
in `transport-deferrals.test.ts`. It is not called from
`admission-gateway.ts`.

Wiring requires:

- Add optional `recipientActorId?: string` to `AdmissionInput` (alongside
  the existing `producerActorId`).
- Add optional `localControlStateLookup?: (recipientActorId: string) => LocalControlState | undefined`
  to `BridgeAdmissionGatewayOptions`. The bridge operator supplies this;
  it is opt-in — omitting it skips the check entirely.
- In `buildAdmissionInput`, populate `recipientActorId` from
  `BridgeDeliveryRequest.recipientActorId` (new optional field).
- In `BridgeAdmissionGateway.admit`, after check #8 (rate limit) and
  before persisting the new state, call `decideUserBlockTransport` when
  `localControlStateLookup` and `recipientActorId` are both present.
- On `shouldReject: true`, return a `reject` outcome with reason
  `policy.local-preference` (no reputation penalty — the block is the
  recipient's preference, not evidence of sender misbehaviour).

Doctrine non-negotiables:
- The lookup result is never stored in the audit log (it is local-policy
  state, not a bridge-level decision).
- When no lookup is wired, the admission output is byte-identical to
  pre-4.5 (regression-pinned by test).

### Check #10 — report-forwarding (`canBridgeForwardReport` / `decideReportForwarding`)

`decideReportForwarding(report)` exists in `@lfp2p/trust-safety` and is
covered by `transport-deferrals.test.ts`.

**Current blocker**: `safety.report.created` events ride the
`ReportAppealEvent` envelope family (`lfp2p.report-appeal-event.v1`),
not `SignedEventEnvelope`. They are not delivered through the bridge's
`acceptDelivery` path today. Check #10 is therefore not wireable in
the `SignedEventEnvelope` admission path.

**Resolution**: document the structural dependency explicitly. Phase 4.5
does NOT wire check #10 at the `acceptDelivery` layer; it DOES add a
dedicated `acceptReportDelivery(request)` entry point that:
- accepts a `ReportAppealEvent` envelope,
- validates schema + version,
- checks byte size,
- calls `decideReportForwarding` and rejects when `shouldForward` is false,
- returns a `BridgeDeliveryResult`.

This dedicated entry point is a no-op in `BridgeService` today (no HTTP
route is wired to it), but it establishes the type contract for Phase 5's
report-forwarding HTTP surface without forcing the check into the
`SignedEventEnvelope` path.

## Persistent rate-limiting and token management

### Persistent per-token HTTP rate-limit buckets

The `BridgeHttpRateLimiter` (Phase 4.3) holds per-`tokenId` rate-limit
buckets in memory. A bridge restart resets all HTTP-layer budgets while
the admission engine's per-peer buckets survive (Phase 4.2).

Required work:
- Extract `RateLimitBucketState` (bucket token count + last-refill timestamp
  + consecutive-refusal count) as a serializable plain object in
  `http-hardening.ts`.
- Add `HttpRateLimitStore` interface (two methods: `load() → Map<string, RateLimitBucketState>`,
  `save(map) → void`). Default: `InMemoryHttpRateLimitStore` (no-op save).
- Add `JsonFileHttpRateLimitStore` — atomic temp-rename, same pattern
  as `JsonFileAdmissionStateStore`. Snapshot carries
  `version: 'lfp2p.http-rate-limit-snapshot.v1'`.
- `BridgeHttpRateLimiter` constructor accepts optional `store` option.
  On construction: call `store.load()` and seed the in-memory map.
  After every successful `tryConsume` or refusal that mutates state:
  call `store.save(currentMap)`.
- Fail-closed on load corruption: refuse to start (matches Phase 4.2
  `JsonFileAdmissionStateStore` behaviour).

### Persistent token registry with hot rotation

Tokens are currently supplied at `BridgeAuthOptions` construction time
and cannot change without restarting the process.

Required work:
- Define `TokenRegistryStore` interface:
  - `load() → ReadonlyArray<AuthToken>`
  - `save(tokens: ReadonlyArray<AuthToken>) → void`
  - `AuthToken = { tokenId: string; hashedValue: string; expiresAt?: string }`
- `JsonFileTokenRegistryStore` — atomic temp-rename with
  `version: 'lfp2p.token-registry.v1'`.
- `BridgeHttpRateLimiter` / `BridgeService` handler updated to consult the
  registry snapshot on every request rather than a frozen options object,
  allowing `rotateToken({ add?, revoke? })` to take effect without restart.
- `BridgeAdmissionGateway` (or a new `BridgeTokenRegistry` class) exposes:
  - `addToken(token: AuthToken) → void`
  - `revokeToken(tokenId: string) → void`
  - Token values are stored as `sha-256` hashes; plaintext never lands in
    files or logs per Phase 3.1 doctrine.
- Hot key-rotation of `AdmissionConfig.operatorAuthority`: add
  `gateway.rotateOperatorAuthority(newAuthority)` that atomically replaces
  the authority in the in-memory config and persists it in the admission
  state snapshot.

## Auth audit log

Successful and failed auth attempts produce no operator-side log today.

Required work:
- Define `AuthAuditRecord`:
  ```
  { timestamp: string; tokenIdPrefix: string; outcome: 'accepted' | 'rejected' | 'expired';
    clientIp?: string; requestPath: string; }
  ```
  `tokenIdPrefix` = first 8 chars of `tokenId` (never the hash, never
  plaintext). `clientIp` is omitted when not available; when present it
  is retained only in an operator-local log.
- `AuthAuditLog` — bounded FIFO (default 10 000 entries), with optional
  `JsonFileAuthAuditStore`. Phase 3.1 redaction rules apply: no payload
  content, no encryption keys, no private actor ids.
- Wire into `validateBearerToken` return path in `http-hardening.ts`.

## Required tests

- `decideUserBlockTransport` wired: block rejects with `policy.local-preference`; expired block passes; no-lookup admission is byte-identical to pre-4.5.
- `acceptReportDelivery` type contract: valid public-subject report accepted; private-subject with unencrypted evidence rejected; wrong version rejected.
- `JsonFileHttpRateLimitStore`: round-trip, cold-start, corrupt-JSON refused, atomic-rename verified.
- `BridgeHttpRateLimiter` with persistent store: buckets survive a simulated restart.
- Token registry hot rotation: `revokeToken` takes effect on next request without restart; `addToken` immediately authorises.
- Auth audit log: accepted + rejected entries written; tokenIdPrefix is prefix-only (never full hash); capacity eviction is FIFO.
- Operator authority rotation: `rotateOperatorAuthority` persists and takes effect immediately; old-authority events are rejected.

## Non-goals

- Full mTLS / OAuth2 / JWT auth schemes (deferred to Phase 19).
- Multi-bridge advisory reputation propagation (Phase 4.6).
- Report delivery HTTP route (Phase 5 surface work).
- PGlite-backed stores for any of the above.

## Exit criteria

- Admission doctrine check #9 is wired (with opt-in lookup).
- `acceptReportDelivery` type contract exists (no HTTP route required).
- HTTP-layer rate-limit buckets survive a bridge restart.
- Token registry supports hot rotation without process restart.
- Operator authority hot-rotatable.
- Auth audit log with Phase 3.1 redaction.
- All 2250+ tests continue to pass; no existing admission behaviour changes
  when new options are omitted.
