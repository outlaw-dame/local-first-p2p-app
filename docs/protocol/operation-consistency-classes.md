# Operation Consistency Classes

- Status: Draft
- Date: 2026-06-03
- Related ADRs:
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/006-local-first-trust-policy-engine-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/local-controls-portability.md`
  - `docs/protocol/identity-control-log.md`
  - `docs/protocol/bridge-admission-doctrine.md`
  - `docs/protocol/moderation-runtime-doctrine.md`
  - `docs/protocol/curation-doctrine.md`
  - `docs/protocol/labeler-runtime-doctrine.md`

## Purpose

This document classifies every protocol event by the consistency
guarantee its projection must enforce. The taxonomy exists to prevent
future drift in one specific direction: someone adopting a CRDT, a
last-writer-wins shortcut, or a relaxed sync primitive for an
operation whose security or audit semantics require a stricter model.

Each protocol event kind is assigned to exactly one class. When a new
event kind is introduced, its doctrine document (or exit report) MUST
declare the class it belongs to. Code review SHOULD treat a class
mismatch as a blocker.

This is a *taxonomy*, not a runtime contract. The runtime contracts
live in the per-kind validators and projections. The taxonomy is the
audit lens.

## The five classes

### Class A — Eventually consistent projection events

**Definition.** Events whose projection state converges across devices
under commutative apply, but which carry no authority transition and
no irreversible lifecycle gate. Re-ordering by Lamport clock or
deduplication by eventId is sufficient. Concurrent apply on two
devices and later merge is safe.

**Enforcement.** Pure `apply` function, frozen state, idempotency on
eventId. No "previous-state-required" check.

**Examples.**
- Local-control entry installations (block/mute/keyword/preference) —
  these are commutative and TTL-bound.
- Curation signals (boost/downrank/exclude) — bounded score deltas
  per event; concurrent application converges.
- Contact-card publication audit trail — projection retains "latest"
  by `createdAt`.

### Class B — Append-only lifecycle state machines

**Definition.** Events that transition a specific subject through a
named state machine with explicit legal transitions. Order matters;
illegal transitions throw `*_LIFECYCLE_TRANSITION`. Once a terminal
state is reached, subsequent events on the same subject are rejected
(or are no-ops for idempotent terminal arrivals like double-revoke).

**Enforcement.** Apply-time state machine check against the
projection's current sub-state for the subject. Stable
`*_LIFECYCLE_TRANSITION` error codes.

**Examples.**
- Reports / appeals lifecycle (`submitted → acknowledged → resolved`).
- Moderation queue lifecycle (`open → assigned → resolved`).
- Labeler profile re-publish supersession.
- Labeler subscription `active → unsubscribed`.
- Label `active → revoked`.
- Capability `granted → revoked`.
- Policy version chain (`active@vN → active@v(N+1) → deprecated`).

### Class C — Monotonic authority / epoch transitions

**Definition.** Events that transfer or revoke authority. Strictly
monotonic epoch enforcement against the projection's current epoch.
Controller-signed (or controller-delegated) only. A stale or replayed
event MUST NOT be able to roll the authority graph back to an earlier
state.

**Enforcement.** Apply-time check that `event.epoch > state.epoch`;
apply-time check that the signer is the controller key (or a current
delegate with a valid capability); apply-time check that any
`previous*` field matches the stored value (Phase 2.1's
`previousPublicKey` discipline for rotation).

**Examples.**
- `identity.controller.created`.
- `identity.device.authorized`.
- `identity.device.revoked`.
- `identity.device.rotated` (Phase 2.1 — preserves deviceId, swaps
  publicKey, `previousPublicKey` must match stored).
- `identity.capability.granted`.
- `identity.capability.revoked`.

### Class D — Encrypted payload / key-epoch transitions

**Definition.** Events that change which encryption keys decrypt
which payloads, or which subjects can read a private channel. The
keys themselves are out-of-band (MLS or a future key-epoch
protocol); the events carry only key-epoch identifiers and audit
metadata, never key material.

**Enforcement.** Strict monotonic key-epoch enforcement; rejection of
any event whose key-epoch is older than the current. The
projection records "current key-epoch" per channel; the
encryption-envelope runtime (ADR-002, deferred) verifies that the
ciphertext was encrypted under the declared epoch.

**Status today.** No Class D events have shipped yet. Reserved for:
- Private payload envelope (ADR-002).
- MLS group key schedule (Phase 6).
- Room key-epoch rotation.
- Private-channel membership revocation that invalidates a past key.

### Class E — Non-authoritative bridge / admission observations

**Definition.** Events that record *observations* by infrastructure
nodes (bridges, relays, super-peers). They never carry account
authority; they describe what a piece of infrastructure decided to
do (admit, quarantine, rate-limit, audit). They MAY be advisory
input to downstream policy but never authoritative.

**Enforcement.** Per-surface signer check (bridge-operator authority
for transport events; never an end-user signer). The projection
treats these as read-only audit data. No state-machine progression
on user-facing subjects.

**Examples.**
- `transport.event.accepted | rejected | quarantined`.
- `transport.peer.rate_limited | quarantined`.
- `transport.media.rejected`.

## Master event-kind → class index

| Event kind                                       | Class | Notes |
|--------------------------------------------------|:-----:|------|
| `identity.controller.created`                    |   C   | Controller-signed; once per state. |
| `identity.device.authorized`                     |   C   | Monotonic epoch. |
| `identity.device.revoked`                        |   C   | Monotonic epoch; idempotent on double-revoke. |
| `identity.device.rotated`                        |   C   | `previousPublicKey` must match stored key. |
| `identity.capability.granted`                    |   C   | Controller-signed; capability becomes Class B-able. |
| `identity.capability.revoked`                    |   B   | `granted → revoked` lifecycle on the capability. |
| `identity.contact-card.published`                |   A   | Projection retains latest by event order. |
| `contact.petname.set`                            |   A   | Last-write-wins per identityId by `createdAt`. |
| `note.created`                                   |   A   | Append-only authored content. |
| `outbox.test.created`                            |   A   | Test fixture. |
| `safety.account.blocked`                         |   A   | Entry installation; TTL-bound. |
| `safety.account.muted`                           |   A   | |
| `safety.account.allowlisted`                     |   A   | |
| `safety.domain.blocked`                          |   A   | |
| `safety.keyword.muted`                           |   A   | |
| `safety.thread.muted`                            |   A   | |
| `safety.post.hidden`                             |   A   | |
| `safety.label.preference.set`                    |   A   | |
| `safety.policy-list.subscribed | unsubscribed`   |   A   | |
| `safety.notification-preference.set`             |   A   | |
| `safety.preferences.snapshot`                    |   A   | Bootstrap; replaces prior state under strategy. |
| `safety.adult-content.gate.set`                  |   A   | |
| `safety.report.created`                          |   B   | Enters `submitted` state. |
| `safety.report.acknowledged`                     |   B   | `submitted → acknowledged`. |
| `safety.report.resolved`                         |   B   | Terminal. Skip-ack permitted. |
| `safety.appeal.created`                          |   B   | Enters `submitted`. |
| `safety.appeal.resolved`                         |   B   | Terminal. |
| `safety.labeler.profile.published`               |   B   | Re-publish supersedes per labelerId. |
| `safety.label-definition.published`              |   B   | Append-only by (namespace, labelKey). |
| `safety.labeler.subscribed`                      |   B   | `active → unsubscribed`. |
| `safety.labeler.unsubscribed`                    |   B   | Terminal. |
| `safety.label.applied`                           |   B   | `active → revoked` per (subject, issuer). |
| `safety.label.revoked`                           |   B   | Terminal; cross-labeler revoke rejected. |
| `safety.annotation.created`                      |   A   | |
| `safety.policy.created | updated | deprecated`   |   B   | Versioned chain; monotonic version. |
| `safety.policy.decision.recorded`                |   B   | Append-only by decisionId. |
| `moderation.queue.item.created`                  |   B   | Enters `open`. |
| `moderation.queue.item.assigned`                 |   B   | `open → assigned`. |
| `moderation.queue.item.resolved`                 |   B   | Terminal; skip-assignment permitted. |
| `curation.rule.created | disabled`               |   B   | `active → disabled`. |
| `curation.item.boosted | downranked | excluded`  |   A   | Bounded delta per event; commutative. |
| `curation.explanation.recorded`                  |   A   | |
| `transport.event.accepted | rejected | quarantined` |   E   | Bridge audit. |
| `transport.peer.rate_limited | quarantined`      |   E   | |
| `transport.media.rejected`                       |   E   | |

(Class D row is intentionally empty today — see Phase 5/6 future
work.)

## Why this matters

This taxonomy prevents three specific failure modes:

1. **A future CRDT for security-sensitive state.** A contributor
   wanting to use Loro or Yjs for "convenience" on a Class B or C
   subject would have to argue the taxonomy is wrong. CRDTs are
   appropriate for Class A and (with care) for non-security-critical
   payload bodies inside Class D; never for Class B or C.

2. **A relaxed sync primitive on authority transitions.** Last-writer-wins
   is appropriate for Class A; it would silently break Class C
   monotonicity guarantees if applied there. Inbound-sync code paths
   for different event kinds must NOT share an "advance checkpoint
   then apply" function that bypasses class-specific checks.

3. **Bridge over-reach.** Class E events MUST originate from
   infrastructure operators only. A bridge that signed a Class B or C
   event would be claiming authority it does not have. The admission
   engine already enforces this per surface; the taxonomy gives it a
   name.

## Cross-class invariants

- **Class A** apply never depends on prior state (commutativity).
- **Class B** apply consults the per-subject sub-state and either
  legal-transitions, idempotent-no-ops, or throws `*_LIFECYCLE_TRANSITION`.
- **Class C** apply consults the global epoch and the prior authority
  graph, and throws `*_EPOCH_NON_MONOTONIC` / `*_AUTHORITY_MISMATCH`
  / `*_DEVICE_NOT_FOUND` / `*_DEVICE_ALREADY_REVOKED` as appropriate.
- **Class D** apply consults the current key-epoch and the ciphertext's
  declared epoch. (Not yet implemented.)
- **Class E** apply is read-only as far as user-authored projections
  are concerned; it writes only to admission / audit state.

## What this is NOT

This document does not:

- specify the wire format of any event kind (per-kind doctrine docs do that);
- specify the projection schema (per-package projection modules do that);
- specify cryptographic key formats (`@lfp2p/crypto` and ADR-002 do that);
- create a runtime check. A future "class assertion in CI" against
  the per-kind validators is a possible follow-up, but the lens is
  the current value.

## Implementation evidence

- Class A enforcement is exercised by every "idempotency on eventId"
  test (e.g. Phase 1.62, Phase 1.66, Phase 1.69, Phase 1.70 suites).
- Class B enforcement is exercised by every
  `*_LIFECYCLE_TRANSITION` test (e.g. Phase 1.63 reports/appeals,
  Phase 1.66 label-revoke, Phase 1.67 policy-version-chain,
  Phase 2.1 device.rotated-on-revoked).
- Class C enforcement is exercised by Phase 2.1's epoch-monotonicity
  and `previousPublicKey`-match tests.
- Class D enforcement is pending Phase 5/6 implementation.
- Class E enforcement is exercised by Phase 1.64's bridge-operator
  authority cross-check in the admission engine.
