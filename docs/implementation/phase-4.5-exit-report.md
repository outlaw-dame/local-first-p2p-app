# Phase 4.5 — Production Bridge Runtime Hardening: Exit Report

- Status: Complete
- Date: 2026-06-29
- PR: #118
- Depends on: Phase 4.1–4.4 exit reports, `docs/protocol/bridge-admission-doctrine.md`

## What shipped

### Check #9 — user-block transport (`decideUserBlockTransport`)

`decideUserBlockTransport` from `@lfp2p/trust-safety/local-controls` is now wired into `BridgeAdmissionGateway` as an opt-in check after the rate-limit check (#8) and before state persistence. Wiring:

- `BridgeDeliveryRequest.recipientActorId?: string` — new optional field.
- `AdmissionGatewayOptions.localControlStateLookup?: (recipientActorId) => LocalControlState | undefined` — opt-in injection point.
- When both are present, the gateway calls `decideUserBlockTransport` and on `shouldReject: true` returns a `reject` outcome with reason `policy.local-preference`.

Doctrine non-negotiables enforced and pinned by tests:

- The lookup result is **never stored in the audit log** — local-policy state must not reach any operator-visible log surface.
- **No reputation penalty** for `policy.local-preference` — the block is the recipient's preference, not evidence of sender misbehaviour.
- When no lookup is configured, the admission output is **byte-identical to pre-4.5** (regression test pins this).
- Expired blocks are transparent to the gateway — the TTL check is inside `decideUserBlockTransport`, not duplicated here.

### Check #10 — `acceptReportDelivery` type contract

`safety.report.created` events ride `ReportAppealEvent` envelopes, not `SignedEventEnvelope`, so check #10 cannot be wired into the `acceptDelivery` hot path. A dedicated entry point establishes the type contract for Phase 5's report-forwarding HTTP surface:

- `ReportDeliveryRequest` / `ReportDeliveryResult` exported types.
- `BridgeAdmissionGateway.acceptReportDelivery(request)` validates: schema + version, byte-size cap, `decideReportForwarding` structural check (from Phase 1.63).
- Rejects private-subject reports without encrypted evidence (Phase 1.63 non-negotiable).
- No HTTP route is wired yet — this lands in Phase 5.

### Persistent HTTP rate-limit buckets (`JsonFileHttpRateLimitStore`)

`RateLimitBucketState` (token count, last-refill timestamp, consecutive-refusal count) is serializable. New persistence layer in `http-hardening.ts`:

- `HttpRateLimitStore` interface: `load() → Map<tokenId, RateLimitBucketState>`, `save(map) → Promise<void>`.
- `InMemoryHttpRateLimitStore` (default — no-op save, for tests/embedding).
- `JsonFileHttpRateLimitStore` — atomic temp-file-then-rename, `0o600` file permissions, snapshot versioned `lfp2p.http-rate-limit-snapshot.v1`. Fail-closed on load corruption (refuses to start).
- `BridgeHttpRateLimiter` accepts optional `store`. Write-coalesced: mutations set a dirty flag; a flush timer (default 5 s) saves if dirty; a graceful-shutdown hook flushes immediately. **Saving is never on the synchronous request hot-path** — a flood attack cannot exhaust disk I/O by triggering per-request saves.

### Persistent token registry with hot rotation (`BridgeTokenRegistry`)

New `token-registry.ts` module:

- `AuthToken = { tokenId, hashedValue, expiresAt? }` — token values are stored as `sha-256` hex hashes; **plaintext never lands in files or logs** (Phase 3.1 doctrine).
- `hashBearerToken(plaintext) → string` — exported for callers building the registry.
- `TokenRegistryStore` interface: `load() → ReadonlyArray<AuthToken>`, `save(tokens) → Promise<void>`.
- `InMemoryTokenRegistryStore` and `JsonFileTokenRegistryStore` (atomic rename, versioned `lfp2p.token-registry.v1`, fail-closed on corruption).
- `BridgeTokenRegistry` — `addToken`, `revokeToken` take effect immediately on the next request without a process restart; `validateBearerToken` hashes the incoming bearer value before constant-time comparison against stored `hashedValue` fields; expired tokens return the same response shape as unknown tokens (no expiry oracle).

### Auth audit log (`AuthAuditLog`)

New `auth-audit-log.ts` module:

- `AuthAuditRecord = { timestamp, tokenIdPrefix?, outcome, clientIp?, requestPath }`.
  - `tokenIdPrefix` is the **first 8 chars of `tokenId`** — only populated when a configured token was identified (accepted, expired, or explicitly-revoked); unmatched rejections carry no prefix to avoid logging a prefix derived from the presented secret.
  - `clientIp` is retained only in the operator-local log; omitted when not available.
- `AuthAuditLog` — bounded FIFO (configurable capacity, default 10 000 entries).
- `AuthAuditStore` interface, `JsonFileAuthAuditStore` implementation (append-and-rotate pattern).
- Phase 3.1 redaction rules enforced: no payload content, no encryption keys, no private actor ids in any record field.

### Operator authority hot rotation

`BridgeAdmissionGateway.rotateOperatorAuthority(newAuthority)` atomically replaces the operator authority in the in-memory admission config. Takes effect on the next `admit` call without a process restart.

## New files

| File | Purpose |
|------|---------|
| `apps/bridge-service/src/token-registry.ts` | `AuthToken`, `BridgeTokenRegistry`, `JsonFileTokenRegistryStore` |
| `apps/bridge-service/src/auth-audit-log.ts` | `AuthAuditLog`, `JsonFileAuthAuditStore`, `AuthAuditRecord` |
| `apps/bridge-service/src/phase-4.5.test.ts` | 30 adversarial tests |

## Modified files

| File | Change |
|------|--------|
| `apps/bridge-service/src/admission-gateway.ts` | Check #9 wiring, `acceptReportDelivery`, `rotateOperatorAuthority`, `admitAndPersist` restructure |
| `apps/bridge-service/src/http-hardening.ts` | `RateLimitBucketState`, `HttpRateLimitStore`, `JsonFileHttpRateLimitStore` |
| `apps/bridge-service/src/index.ts` | Re-exports for new modules |

## Test coverage (30 new tests)

- Check #9: block rejects with `policy.local-preference`; expired block passes through; absent `recipientActorId` skips check; no-lookup is byte-identical to pre-4.5; lookup result absent from audit log; no reputation penalty.
- Check #10: valid public-subject report accepted; wrong version rejected; byte-size cap rejected; private-evidence-leak-risk rejected; non-report kind accepted without running forwarding check.
- `JsonFileHttpRateLimitStore`: round-trip, cold-start, corrupt-JSON refused, dirty-flag lifecycle, buckets survive simulated restart.
- `BridgeTokenRegistry`: add/validate; revoke takes effect immediately; add authorises immediately; expired token; unknown bearer; persists across instances; duplicate tokenId rejected; invalid hashedValue rejected.
- `AuthAuditLog`: accepted + rejected entries written; FIFO capacity eviction; tokenIdPrefix is first-8-chars only (never full hash); unmatched rejection carries no prefix; persists and loads from `JsonFileAuthAuditStore`.
- `rotateOperatorAuthority`: new authority takes effect immediately on next admit.

## Deferred

- PGlite/SQL-backed stores for any of the above.
- Full mTLS / OAuth2 / JWT auth (Phase 19).
- Report delivery HTTP route (Phase 5 surface work).
- Multi-bridge advisory reputation propagation (Phase 4.6 — now shipped separately).
