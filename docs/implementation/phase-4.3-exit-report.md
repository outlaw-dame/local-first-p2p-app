# Phase Exit Report: Phase 4.3 — Bridge HTTP-layer hardening

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

The Phase 4.1 admission engine runs AFTER the bridge has read and
parsed the delivery body. Phase 4.3 adds the cheap-first checks that
must precede admission:

1. Request body size cap, enforced via both `Content-Length`
   pre-check AND streaming accumulation (so a missing or lying
   `Content-Length` cannot bypass the cap).
2. Multi-token bearer auth registry with per-token `expiresAt`,
   replacing the single-token model. Backward compatible.
3. RFC 6750 `WWW-Authenticate` and RFC 7231 `Retry-After` header
   discipline.
4. Per-token HTTP rate limiter built on the Phase 1.64 engine's
   `tryConsume` primitive — no logic duplication.
5. Privacy-safe response bodies: 401/413/429 never echo payload or
   token contents. Identical 401 bodies for every auth failure so a
   prober cannot fingerprint the registry.

## Completed work

### `apps/bridge-service/src/http-hardening.ts` (new)

- `DEFAULT_MAX_REQUEST_BYTES = 1 MiB` matching the engine's
  `DEFAULT_MAX_BYTES_BY_SURFACE.bridge`. Hard ceiling at 64 MiB.
- `normalizeAuthConfig(auth)` validates both the legacy single-token
  shape and the multi-token shape, throws on misconfiguration
  (caught and surfaced as 503 by the handler).
- `authorizeRequest(request, auth, nowMs)` returns
  `{ status: 'authorized', tokenId } | 'unauthorized' | 'misconfigured'`.
  Constant-time comparison runs against EVERY token in the registry
  per request so a timing oracle cannot leak registry size or
  position. Expired tokens are indistinguishable from unknown tokens
  in the response.
- `checkDeclaredContentLength(request, maxBytes)` parses
  `Content-Length`. Returns `ok | too-large | invalid`.
- `readRequestBodyWithCap(request, maxBytes)` reads the body via
  `Request.body.getReader()` with a streaming byte accumulator;
  cancels the reader as soon as the cap is exceeded. Polyfill
  fallback for runtimes without `getReader()`.
- Standard response factories `unauthorizedResponse()`,
  `tooLargeResponse()`, `badRequestSizeHeaderResponse()`,
  `tooManyRequestsResponse(retryAfterMs)` with the right headers.
- `BridgeHttpRateLimiter` class wraps the engine's
  `createRateLimitBucket` + `tryConsume` primitives. Per-`tokenId`
  in-memory bucket map. The exponential-backoff math, self-healing
  on first success, and refill semantics are byte-for-byte identical
  to the admission engine's per-peer limiter — **zero logic
  duplication** per the project's quality bar.

### `apps/bridge-service/src/types.ts` (extended)

- `BridgeHttpAuthConfigLegacy` (the pre-Phase-4.3 single-token shape)
  preserved as a named type for backward compatibility.
- `BridgeAuthToken` and `BridgeHttpAuthConfigMulti` added for the
  multi-token registry.
- `BridgeHttpAuthConfig` is now a discriminated union of legacy + multi.
- `BridgeHttpHandlerOptions` extended with `maxRequestBytes`,
  `httpRateLimiter`, and `now` (injectable clock for deterministic
  tests).
- `BridgeHttpRateLimiterHandle` opaque type declared here to keep
  the options shape free of a cycle with the implementation file.

### `apps/bridge-service/src/service.ts` (extended)

Handlers `handleBridgeDeliveryRequest` and
`handleBridgeInboundReadRequest` rewritten to follow the cheap-first
order:

```
0. method check (existing)
0a. null-options check (backward compat → 503)
1. Content-Length pre-check (→ 413 or 400)
2. auth (→ 401 with WWW-Authenticate)
3. rate limit (→ 429 with Retry-After)
4. streaming body read with cap (→ 413)
5. JSON parse + existing admission + store flow
```

Legacy auth helpers (`authorizeBridgeHttpRequest`,
`isValidBridgeHttpAuthConfig`, `isValidBridgeAuthToken`,
`constantTimeEqual`) and unused legacy response helpers
(`bridgeDeliveryUnauthorizedResponse`, `bridgeReadUnauthorizedResponse`,
`bridgeUnauthorizedHeaders` legacy variants) removed — the
multi-token registry in `http-hardening.ts` is the single source
of truth. Two thin endpoint-specific 401 response factories
(`bridgeDeliveryUnauthorizedResponse`, `bridgeReadUnauthorizedResponse`)
remain to preserve the documented body shapes for each endpoint
(delivery includes `idempotencyKey: 'unknown'`; read does not).

### 23 new adversarial tests (`http-hardening.test.ts`)

- **Body size cap (4)**: Content-Length above cap → 413; malformed
  Content-Length → 400; streaming cap fires without Content-Length;
  request that fits the configured smaller cap is accepted.
- **Multi-token auth (5)**: known token A admits; known token B
  admits; unknown token → 401 + WWW-Authenticate; expired token →
  identical 401 body to unknown (no fingerprinting); legacy
  single-token shape continues to work.
- **normalizeAuthConfig validation (4)**: empty tokens array,
  duplicate ids, non-ASCII token, malformed expiresAt all rejected
  with TypeError (caught by handler → 503).
- **Per-token rate limiter (3)**: per-token isolation; exhaustion
  advances the cooldown; recovery resumes after the cooldown elapses.
- **Rate limiter wired into handler (2)**: 429 + Retry-After on
  exhaustion; different tokens consume independent buckets.
- **Privacy-safe response bodies (3)**: 401 body never echoes
  presented token; 413 body never echoes payload; 429 body never
  echoes presented token.
- **Inbound-read endpoint (2)**: same 413 discipline; legacy 401
  body shape (`{ reason: 'Unauthorized' }`) preserved with
  WWW-Authenticate header.

### Doctrine

`docs/protocol/bridge-admission-doctrine.md` — new "HTTP-layer
hardening (Phase 4.3)" section covering the cheap-first ordering,
response-shape discipline, per-token rate limiter design (single
source of truth), and operator misconfiguration handling.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1193 passing (1170 → 1193, +23)
pnpm build       # clean
```

All existing bridge tests (including the pre-Phase-4.3 auth tests
that pin specific 401 body shapes for delivery vs inbound-read)
continue to pass unmodified.

## Acceptance criteria

| Criterion | Status | Evidence |
|---|:---:|---|
| Body size cap enforced via Content-Length AND streaming | ✓ | 4 tests covering both paths |
| Multi-token registry with per-token expiresAt | ✓ | 5 tests |
| Backward compat with legacy single-token shape | ✓ | dedicated test |
| Expired token indistinguishable from unknown in response | ✓ | body-equality test |
| Constant-time comparison runs against every token per request | ✓ | implementation; full-loop construction in `authorizeRequest` |
| WWW-Authenticate header on every 401 | ✓ | RFC 6750 |
| Retry-After header on every 429 | ✓ | RFC 7231 |
| Per-token rate limiter reuses engine primitives (no duplication) | ✓ | `BridgeHttpRateLimiter` wraps `tryConsume` |
| Privacy-safe response bodies (no payload or token echo) | ✓ | 3 dedicated tests |
| Doctrine documents the cheap-first ordering and response discipline | ✓ | new section |
| `normalizeAuthConfig` rejects misconfiguration (4 cases) | ✓ | 4 tests |

## Deferred work

- **Persistent per-token rate-limit buckets.** Today the
  `BridgeHttpRateLimiter` is in-memory only; a restart resets all
  HTTP-layer buckets while the admission engine's per-peer buckets
  remain durable (Phase 4.2). A future slice may extend the
  `AdmissionStateStore` pattern to cover HTTP buckets.
- **Persistent token registry / hot rotation.** Tokens are supplied
  at handler-options time. A future slice would back the registry
  with a file/DB so the operator can rotate without a restart.
- **Auth audit log.** Successful and failed auth attempts could be
  written to an operator-side audit log; today the bridge does not
  expose such a log. Phase 3.1 privacy-safe-logging doctrine applies
  if/when this is added.
- **mTLS / OAuth2 / JWT auth schemes.** v1 ships bearer-only.
- **WebSocket / Durable Streams reader.** A future slice will add
  these surfaces. The same hardening pattern applies; this slice
  established the foundation.

## Decision

This phase is:

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: The HTTP-layer hardening closes a real DoS surface (memory
exhaustion via huge POST bodies) and a real authentication
limitation (single shared token) without breaking any pre-existing
test. The per-token rate limiter is built on engine primitives so
exponential-backoff and self-healing semantics are identical to the
admission engine's per-peer limiter — no duplication. Privacy-safe
response discipline is pinned by adversarial tests.
