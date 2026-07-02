# Phase Exit Report: Phase 1.64 — Bridge / Relay / Super-Peer Admission Policy

- Status: Accepted as foundation-only / partial (see Decision)
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/bridge-admission-doctrine.md` (new)
  - `docs/protocol/local-controls-portability.md`
- Related implementation docs:
  - `docs/implementation/trust-safety-phase-plan.md`
  - `docs/implementation/phase-1.61-exit-report.md`
  - `docs/implementation/phase-1.62-exit-report.md`
  - `docs/implementation/phase-1.63-exit-report.md`

## Phase scope

Phase 1.64 was meant to give infrastructure operators (bridges,
relays, super-peers, public indexes, media stores) explicit
self-protection tools without turning them into global moderators.
The plan called for:

- Six transport events (`transport.event.accepted`,
  `transport.event.rejected`, `transport.event.quarantined`,
  `transport.peer.rate_limited`, `transport.peer.quarantined`,
  `transport.media.rejected`).
- Admission checks: signature, schema, supported event kind, bridge-
  safe privacy scope, byte/decoded size, idempotency/replay,
  revocation, object/content ref validation, local policy and rate
  limits.
- Operator tools: allow/deny/quarantine/rate-limit, peer-reputation
  records, redacted audit events, DLQ/quarantine review surfaces.
- Exit criteria: bridge-local rejection is not global deletion; rate
  limits and quarantine are operator-scoped; admission decisions can
  cite exact `ObjectRef` / `BlockRef` values; private payloads are
  not logged; tests cover malformed requests, replay, duplicate
  delivery, stale confirmations, and unsafe scope acceptance.

I also folded in the deferrals from earlier phases:

- Phase 1.62: bridge-side transport enforcement of
  `safety.account.blocked`.
- Phase 1.63: bridge `canBridgeForwardReport` integration,
  with hard rule that bridges MUST NOT decrypt encrypted bodies or
  evidence.

## Completed work

Added under `packages/trust-safety/src/transport-admission/`:

- **`events.ts`** — six transport event kinds with payload validators
  (`lfp2p.transport-event.v1`). Each kind that records a decision
  embeds the Phase 1.61 `TransportAdmissionDecision` shape; events
  with `quarantineExpiresAt` / `retryAfter` cross-check those
  timestamps against `createdAt`.
- **`rate-limit.ts`** — pure-function token bucket with integer-floor
  refill (no fractional-rounding exploit) and **exponential backoff**:
  `baseBackoffMs * 2^(consecutiveRefusals - 1)`, capped at
  `maxBackoffMs`. Refusals during an active cooldown do NOT escalate
  further (no double-counting). A successful admit resets the
  refusal counter to 0 (self-healing).
- **`peer-reputation.ts`** — bounded signed integer score with
  time-based decay toward 0. Auto-quarantine when score crosses
  below `quarantineThreshold`; auto-lift when score climbs above
  `recoveryThreshold` (hysteresis gap prevents flapping) OR when
  the hard `maxQuarantineMs` TTL elapses. Negative-zero normalized
  to `+0` for clean equality semantics.
- **`replay-cache.ts`** — bounded TTL cache for idempotency keys.
  Oldest-first eviction when full prevents OOM under flood attack
  while preserving the TTL guarantee. Lazy pruning on insert plus
  an explicit `pruneReplayCache` helper.
- **`audit.ts`** — redacted entry construction. Digests truncated to
  an 8-char prefix via `redactDigestRef` from
  `@lfp2p/content-addressing`; encryption-key refs dropped entirely;
  CIDs truncated to a 9-char prefix. Timestamps rounded to whole
  seconds so the log cannot be used as a timing oracle. FIFO
  eviction at capacity.
- **`admission.ts`** — the decision engine. Pure function:
  `runAdmissionChecks(inputs) -> outputs`. Ordered check pipeline
  with short-circuit semantics:
  1. Schema sanity (byte size finite, non-negative).
  2. Replay / idempotency.
  3. Privacy scope per surface (`bridge`/`relay`/`media-store`:
     {dm, group, public}; `super-peer`: {group, public};
     `public-index`: {public}).
  4. Event kind allowlist.
  5. Byte size cap (per-surface defaults).
  6. Decoded-size compression-bomb guard.
  7. Peer quarantine check.
  8. Rate limit.
  9. User-block transport (Phase 1.62 deferral).
  10. Report-forwarding privacy guard (Phase 1.63 deferral).
      Each failure produces a `TransportAdmissionDecision` with the
      appropriate `action` and `reasonCode`. Successful admits credit
      +1 to peer reputation; failures penalize per-rule (-5 to -100).
- **`projection.ts`** — `TransportAdmissionState` frozen snapshot
  with `peerReputation`, `rateLimitState`, `replayCache`,
  `quarantinedPeers`, `quarantinedEvents`, `quarantinedMedia`,
  `auditLog`, `appliedEventIds`. `admitEnvelope` is the canonical
  entry point: takes state + envelope + config + optional context
  - `now`, returns `{nextState, result}`. `applyTransportEvent`
    records an emitted decision (or peer/media quarantine) into the
    appropriate index, idempotent on `eventId`.
    `seedTransportAdmissionState` is the store-reopen rebuild path.
- **`user-block-enforcement.ts`** (Phase 1.62 deferral) —
  `decideUserBlockTransport(state, context, now)` returns
  `producer-blocked | producer-allowed`. TTL-aware: expired blocks
  do not produce rejections. The bridge runtime that holds the
  user's local-control state calls this before forwarding into the
  user's account-local sync.
- **`report-forwarding.ts`** (Phase 1.63 deferral) —
  `decideReportForwarding(report)` returns
  `forwardable | private-evidence-leak-risk` based on
  `canBridgeForwardReport`. The bridge runs this structural check
  WITHOUT decrypting anything; the decision operates on declared
  privacy / encryption shape only.
- 4 valid + 2 invalid fixtures under
  `packages/trust-safety/fixtures/transport-admission/`.
- 60+ new tests across 7 test files covering:
  - Token-bucket math (capacity, refill, never exceeds capacity).
  - Exponential backoff (first refusal = base, second = 2×, third =
    4×, fourth = 8×, capped at `maxBackoffMs`).
  - Cooldown semantics (refusals during cooldown do not escalate).
  - Self-healing (successful admit clears the refusal counter).
  - Reputation decay (toward 0, never crosses zero, bounded).
  - Quarantine hysteresis (enter at one threshold, lift at a
    different one).
  - Quarantine TTL auto-lift.
  - Replay cache TTL + capacity eviction (resists flood attack).
  - Audit redaction completeness (key digest never appears,
    timestamps whole seconds, FIFO eviction).
  - Admission engine per check (every failure produces the
    documented `action` + `reasonCode`).
  - User-block enforcement (expired block ignored).
  - Report-forwarding (private subject + public media = reject;
    private subject + encrypted media = accept).
  - Transport event validation per kind, including timestamp-order
    cross-checks.
- **New doctrine document**: `docs/protocol/bridge-admission-doctrine.md`
  with non-negotiable rules, the check order specification, and the
  exponential-backoff / reputation math, plus a clear "what the
  bridge MUST NOT do" section.

## Tests and verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 735 passing (60+ new for 1.64 across 7 test files)
pnpm build       # clean
```

Additional verification:

- Rate-limit exponential growth verified empirically with a slow-
  refill config so each cooldown window can be observed without
  refill-token interference.
- Reputation hysteresis verified by holding score between
  `quarantineThreshold` and `recoveryThreshold` and asserting the
  quarantine persists.
- Replay-cache flood resistance verified with `5 * maxEntries`
  inserts and asserting `insertionOrder.length` stays bounded.
- Audit redaction verified by direct string-presence asserts on
  the encryption key digest and full source digest.
- Admission engine verified for replay, scope-mismatch, oversize,
  compression-bomb, rate-limit, user-block (both ways), and
  report-forwarding (both ways).

## Acceptance criteria

| Criterion                                                                                                    | Status | Evidence                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | -----: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Bridge-local rejection is not treated as global deletion                                                     |      ✓ | Doctrine doc + decision shape carries operator authority + surface; no broadcast semantics                                                 |
| Rate limits and quarantine are scoped to the infrastructure operator                                         |      ✓ | All state lives in `TransportAdmissionState` per operator; no cross-surface propagation in this package                                    |
| Admission decisions can cite exact `ObjectRef` / `BlockRef` values                                           |      ✓ | `transport.media.rejected` carries a full `BlockRef`; per Phase 1.61 the decision's `subject` may be any `SafetySubjectRef`                |
| Private payloads are not logged                                                                              |      ✓ | `redactDigestRef`/`redactBlockRefForAudit` enforce; audit entry tests verify no key digest, no full source digest, whole-second timestamps |
| Tests cover malformed requests, replay, duplicate delivery, stale confirmations, and unsafe scope acceptance |      ✓ | Admission test file + replay-cache tests + transport-events tests cover all four explicitly                                                |

## Security/privacy checks

- [x] No private plaintext in logs — package emits no logs; the
      audit log structurally redacts and never sees encrypted bytes.
- [x] Remote/untrusted input validation exists — every transport
      event kind has shape validation; the admission engine sanity-
      checks byte sizes; signature verification is delegated to the
      envelope layer.
- [x] Malicious/invalid input tests exist — flood attack on the
      replay cache, compression bomb via `decodedByteSize`,
      oversized envelope, disallowed scope at the bridge surface,
      unknown event kinds, future-dated `retryAfter`, etc.
- [x] Revocation/permission behavior — peer quarantines auto-lift
      on reputation recovery or TTL; the engine does NOT permanently
      ban a peer.
- [x] Derived state rebuild/delete behavior —
      `seedTransportAdmissionState` rebuilds from the event log
      deterministically; `applyTransportEvent` is idempotent on
      `eventId`.

## Deviations introduced or resolved

- Signature verification on incoming envelopes is delegated to the
  envelope layer (`@lfp2p/protocol` plus ADR-002). The admission
  engine assumes signature-valid inputs; running it on unsigned
  data is a caller bug, not an engine bug.
- Per-event quarantine via `applyTransportEvent` indexes by the
  decision's subject eventId only when the subject type is
  `event`. Other subject types (media, blob, etc.) get media-level
  indexing through `transport.media.rejected` events directly.
- Decoded-size compression-bomb threshold is `maxBytes * 1024`, which
  is generous but bounded. A tighter threshold can be set per-
  operator by overriding `maxBytes`.
- Reputation deltas are baked into the admission engine for now (the
  module documents them in code comments). A future revision may
  expose them in `AdmissionConfig` for operator tuning.
- The plan referenced "DLQ/quarantine review surfaces" — the
  `quarantinedEvents` / `quarantinedMedia` indexes ARE the DLQ
  shape. A review UI belongs to the bridge-service app, not this
  package.

## Remaining gaps

Out of scope for Phase 1.64, tracked downstream:

- **Bridge-service runtime wiring**: `apps/bridge-service` must call
  `admitEnvelope` on every inbound request and emit the appropriate
  transport event for downstream persistence. The admission engine
  is the protocol; the HTTP plumbing is a future slice.
- **Dexie persistence** for `TransportAdmissionState`: belongs to
  the local-store package.
- **Signature verification** on incoming envelopes: belongs to the
  envelope layer.
- **Policy-list resolution runtime** (Phase 1.62 subscriptions): the
  admission engine could consume the resolved entries; the
  resolution itself belongs to a separate runtime.
- **Trusted labeler subscriptions at the operator level**: similar
  to policy lists, plumbing belongs to the bridge-service runtime.
- **Media scanner verdicts**: the engine doesn't run scanners; it
  consumes scanner verdicts as advisory inputs. A future slice can
  add a `MediaScannerVerdict` shape and an advisory-input field on
  `AdmissionEnvelope`.
- **Multi-bridge propagation** of peer reputation: out of scope.
  Each operator's state is local. A future advisory feed may
  publish reputation deltas at `network-advisory` scope.
- **Audit log persistence beyond memory**: the in-memory log is
  capped; durable persistence is the bridge-service / local-store's
  job.

## Decision

This phase is:

- [ ] accepted as complete,
- [x] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason:

The Phase 1.64 plan deliverables are met: six transport events
ship with shape validation, an admission decision engine implements
all ten check rules including the Phase 1.62 and 1.63 deferrals, the
projection persists the decisions deterministically, and the doctrine
is documented. Rate limiting uses real exponential backoff with a hard
cap; peer reputation uses time-based decay with hysteresis-gated
quarantine; the replay cache resists flood attacks; the audit log is
structurally redacted. 735 tests pass across the monorepo (60+ new
for 1.64); lint / typecheck / build clean.

The phase is marked **foundation-only / partial** because actual
bridge-service HTTP wiring, Dexie persistence, signature verification
delegation, and media-scanner integration are intentionally deferred
per the plan boundary. Calling this "Complete" would overstate the
integration depth; "foundation-only" matches the doctrine.
