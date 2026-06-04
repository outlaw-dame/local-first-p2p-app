# Phase Exit Report: Phase 4.1 — Bridge transport-admission wiring

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

Phase 4.1 wires the existing Phase 1.64 trust-safety
transport-admission engine into `apps/bridge-service`. The engine,
projection, audit log, fixtures, and 80+ adversarial tests have
existed since Phase 1.64; the bridge runtime simply did not call
them. Phase 4.1 closes that documented deferral.

Per the bridge-admission doctrine, production deployments MUST
admit every delivery through the engine before storing it. Pre-phase,
the bridge ran signature + scope checks but no rate limiting, no
peer reputation, no replay-cache, no byte cap, and no kind
allowlist. Any one of those gaps is a real DoS vector on a
production bridge.

This phase is **integration-only**: no new protocol shapes, no new
event kinds, no engine logic changes. The smallest concrete bridge
slice the doctrine demands.

## Completed work

### `apps/bridge-service/src/admission-gateway.ts` (new, 191 lines)

- `BridgeAdmissionGateway` class owns the `TransportAdmissionState`.
  Single `admit(request, nowMs)` method runs the engine and returns
  a structured decision with a doctrine-compliant `reason` string.
- `estimateEnvelopeByteSize(event)` — `TextEncoder.encode(JSON.stringify(event)).length`.
  Documented upper bound for text-frame transports.
- `buildAdmissionEnvelope(request)` — projects the bridge delivery
  into the engine's input shape. Peer-id fallback:
  `request.peerId ?? event.deviceId`. Empty-string peerId treated
  as omitted. Documented gap on report-event delivery (reports
  ride `ReportAppealEvent`, not `SignedEventEnvelope`, and are not
  delivered through this bridge surface today).
- Privacy-safe logging discipline: reason strings contain only the
  engine's stable action label + reason code, never envelope
  payload. Pinned by test.
- Exhaustiveness check on the action enum: a future engine action
  variant produces an `unknown:` reason rather than silently
  acting as `accept`.

### `apps/bridge-service/src/service.ts` (extended)

- `BridgeService` constructor accepts an optional `admission`
  option. When supplied, `acceptDelivery` runs admission AFTER
  signature verification and BEFORE the store mutation.
- **Order rationale**: signature verification runs FIRST so a forged
  envelope cannot burn the legitimate producer's per-peer
  rate-limit budget. Pinned by the
  `admission runs AFTER signature verification` test.
- `InMemoryBridgeService` forwards the `admission` option to the
  base class.

### `apps/bridge-service/src/types.ts` (extended)

- `BridgeDeliveryRequest.peerId?: string` — optional transport-level
  peer identifier. Documented production-wiring expectation.
- `BridgeAdmissionGatewayHandle` — opaque type-only handle declared
  here to keep `BridgeServiceOptions` free of a cycle with the
  gateway implementation file.
- `BridgeServiceOptions.admission?: BridgeAdmissionGatewayHandle`.

### `apps/bridge-service/src/admission-gateway.test.ts` (new, 14 tests)

Pins the wiring contract:

- **Backward compat** (1): a service without `admission` behaves
  exactly as before.
- **Happy path** (2): admitted envelope → confirmed delivery; the
  gateway's state advances; the audit log gains a redacted entry
  per delivery (no payload contents).
- **Reject paths** (3): byte cap rejects oversized envelopes; kind
  allowlist rejects disallowed kinds; replay-cache drop-duplicate
  fires before the bridge's idempotency dedup.
- **Per-peer rate limiting** (1): peer-A's exhaustion does not
  affect peer-B's budget.
- **peerId fallback** (3): no peerId → bucketed under `deviceId`;
  explicit peerId → bucketed under that; empty-string peerId →
  fallback.
- **Order invariant** (1): a tampered signature is rejected
  WITHOUT advancing admission state — the legitimate producer's
  budget cannot be burned by a forged envelope.
- **State advance** (2): the gateway's state reference changes on
  every admit call; each accept appends an audit entry.
- **Privacy-safe rejection** (1): rejection reasons contain only
  stable action + code labels; never the envelope payload.

### Doctrine

`docs/protocol/bridge-admission-doctrine.md` — appended a new
"Runtime wiring (Phase 4.1, 2026-06-04)" section covering the
integration layer, ordering rationale, backward-compat stance,
peerId discipline, and the explicit state-persistence deferral
(Phase 4.2). Updated the implementation-evidence section to point
at both the engine and the bridge wiring tests.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1149 passing (1135 → 1149, +14)
pnpm build       # clean
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|:---:|---|
| `BridgeService.acceptDelivery` runs the engine when configured | ✓ | `admission-gateway.test.ts` |
| Admission runs AFTER signature verification | ✓ | dedicated test confirming no state advance on tampered envelope |
| Admission runs BEFORE store mutation | ✓ | reject path test (no record persisted) |
| Backward compatibility: existing bridge tests pass unmodified | ✓ | 1135 → 1149 only adds new tests |
| Per-peer rate-limit and reputation buckets are independent | ✓ | dedicated test |
| peerId fallback to deviceId is correct + documented | ✓ | three peerId tests |
| Rejection reasons are privacy-safe (no payload contents) | ✓ | dedicated test |
| Doctrine documents the runtime wiring | ✓ | new section in `bridge-admission-doctrine.md` |

## Deferred work

- **Phase 4.2 — admission state persistence.** Today the
  `TransportAdmissionState` lives in process memory only. A bridge
  restart loses all rate-limit buckets, reputation, replay cache,
  and quarantine records. Persistence requires either a new
  bridge-store table or replay-from-`transport.event.*` events on
  startup. Either approach needs a small schema design slice.
- **Embedded-report admission for `safety.report.created` envelopes.**
  Reports today ride the `ReportAppealEvent` envelope family
  (`lfp2p.report-appeal-event.v1`), not `SignedEventEnvelope`. When
  a future bridge slice opens a report delivery surface, the
  `embeddedReport` field of `AdmissionEnvelope` becomes wireable.
- **Production operator-authority key rotation.** The
  `AdmissionConfig.operatorAuthority` is supplied at gateway
  construction. A production runtime that rotates the
  bridge-operator key needs a hot-swap surface (rebuilding the
  gateway is fine for v1).
- **Multi-bridge advisory reputation propagation.** Per the
  Phase 1.64 doctrine, an operator may consume advisory reputation
  feeds from other bridges. The wire format and ingestion runtime
  remain future work.

## Decision

This phase is:

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: The documented Phase 1.64 deferral ("wire the engine into
the bridge") is closed. The wiring is structurally correct (admission
runs in the right place relative to signature verification and store
mutation), backward-compatible (existing tests unmodified), and
adversarially tested (14 new tests covering the integration
contract). State persistence remains explicitly deferred to
Phase 4.2 as a clear next slice.
