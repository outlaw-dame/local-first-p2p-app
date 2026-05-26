# Bridge Compromise Threat Model Note

- Status: Draft
- Date: 2026-05-26
- Related docs:
  - docs/implementation/schema-and-storage-versioning.md
  - docs/implementation/bridge-inbound-read-endpoint.md
  - docs/implementation/bridge-inbound-read-transport.md
  - docs/implementation/pwa-manual-outbox-delivery.md

## Scope

This note models adversarial and failure scenarios where the bridge or bridge-facing transport behavior is compromised, malformed, stale, replayed, or manipulated.

It covers:

- bridge delivery acknowledgements and status responses,
- inbound bridge-read records,
- outbox retry decisions influenced by bridge responses,
- metadata exposure and trust boundaries,
- current mitigations and remaining gaps.

It does not model full production perimeter defenses, secrets management systems, cloud tenancy controls, or native full-peer runtime behavior.

## Trust boundary

The bridge is an availability and transport helper. It is not canonical authority for private state or signed event validity.

Clients must not treat bridge metadata as proof of:

- event authenticity,
- event authorization,
- event semantic validity,
- identity authority transitions.

Signed-event validation and local policy validation remain client-side responsibilities.

## Threat scenarios

### 1. Forged bridge confirmation

Threat:

- A compromised bridge returns 2xx or `confirmed` responses for events it did not correctly process.

Impact:

- Client could incorrectly mark outbox entries confirmed and stop retrying.

Current mitigations:

- Response parsing rejects malformed/unsupported successful payload shapes.
- Non-retryable/permanent responses remain explicit.
- Stale-response guard exists for sequence-based ordering.

Remaining gaps:

- End-to-end bridge confirmation authenticity is not cryptographically bound.
- Production auditability and signed acknowledgements are not implemented.

### 2. Malformed bridge responses

Threat:

- Bridge returns malformed JSON, invalid schema, unsupported status value, or structurally unsafe payloads.

Impact:

- Parser confusion, false confirmations, inconsistent retry behavior.

Current mitigations:

- Defensive parsing and strict response mapping in sync-client.
- Malformed successful responses are treated as retryable failures.

Remaining gaps:

- No production telemetry standard yet for malformed-response spike detection.

### 3. Stale confirmations and reordering

Threat:

- Responses arrive late or out of order and overwrite fresher local decisions.

Impact:

- Local state could regress if stale metadata is trusted.

Current mitigations:

- Stale-response guard in outbox processing path.
- Idempotency keys to avoid duplicate semantic application.

Remaining gaps:

- Durable checkpoint/offset contract is not yet implemented for richer reader paths.

### 4. Duplicate delivery and replay

Threat:

- Bridge receives or emits duplicate delivery attempts or replayed records.

Impact:

- Duplicate processing, noisy conflicts, potential state churn.

Current mitigations:

- Idempotency conflict handling in bridge and client pathways.
- Duplicate handling tests in bridge store paths.

Remaining gaps:

- Replay-window and retention strategy is not finalized for production operation.

### 5. Bridge returns records it did not receive

Threat:

- Compromised bridge injects fabricated inbound records.

Impact:

- Client receives hostile or fabricated content through bridge-read APIs.

Current mitigations:

- Clients still validate signed envelope shape and local apply semantics.
- Inbound identity mismatch and limit checks exist in sync-client apply paths.

Remaining gaps:

- Signature authenticity checks in full inbound apply path need explicit policy and enforcement continuity.

### 6. Metadata exposure

Threat:

- Bridge or logs expose sensitive metadata (targets, timing, sequence activity patterns, auth configuration mistakes).

Impact:

- Privacy leakage and operational intelligence leakage.

Current mitigations:

- Credentials omitted by default in bridge HTTP transport.
- Dev-only auth boundaries in PWA config with explicit gating.

Remaining gaps:

- Production logging/redaction policy and token lifecycle controls need formalization.

### 7. Data loss and partial durability

Threat:

- Bridge store corruption, retention misconfiguration, or transient persistence failures.

Impact:

- Missing inbound records, unavailable delivery metadata, reduced sync completeness.

Current mitigations:

- Multiple store backends and tests around core conflict/duplicate behavior.
- Local-first architecture preserves local durable writes before sync.

Remaining gaps:

- Recovery playbooks and durability SLO instrumentation are not yet defined.

## Security and reliability requirements before production bridge posture

1. Explicit auth/token lifecycle policy (issuance, rotation, revocation, expiry).
2. Request/response size limits and abuse controls.
3. Rate limiting and DoS mitigation controls.
4. Structured redaction-safe logging policy.
5. Durable sync checkpoint/offset semantics implemented and tested.
6. Replay-window policy and duplicate retention bounds.
7. Store recovery and corruption handling plan.
8. Metrics/alerts for malformed responses, conflict spikes, and retry saturation.
9. Cross-backend consistency checks for duplicate/conflict semantics.
10. Operational runbook for degraded-mode behavior.

## Verification checklist (current)

The following must remain true:

- malformed 2xx responses do not confirm outbox entries,
- unsupported statuses do not confirm outbox entries,
- duplicate deliveries remain idempotent,
- conflicts remain explicit conflicts,
- stale responses do not overwrite fresher local state,
- bridge-safe scope checks remain enforced,
- signature checks remain enforced at bridge acceptance boundaries,
- local-first writes remain durable regardless of bridge availability.

## Residual risk summary

Current bridge hardening is suitable for controlled development slices, not production-grade hostile environments.

Production readiness requires closing the remaining gaps above, especially checkpoint durability, auth lifecycle policy, abuse controls, and operational observability.
