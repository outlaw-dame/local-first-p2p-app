# Threat Model: Identity Control Log

- Status: Draft
- Date: 2026-06-03
- Related ADRs:
  - `docs/adr/001-identity-control-log-v1.md`
- Related protocol docs:
  - `docs/protocol/identity-control-log.md`
  - `docs/protocol/operation-consistency-classes.md`
  - `docs/protocol/revocation-realism.md`
- Related architecture docs:
  - `docs/architecture/local-verifier.md`
- Related implementation docs:
  - `docs/implementation/phase-2.1-exit-report.md`
  - `docs/implementation/phase-2.2-exit-report.md`
- Owners: Protocol and runtime maintainers

## Feature / surface

This threat model covers the identity-control event family
(`@lfp2p/identity`) and its persistence + emission paths in
`@lfp2p/local-store`, `@lfp2p/sync-client`, and the PWA.

Included scope:

- the 7 identity event kinds (`identity.controller.created`,
  `identity.device.authorized | revoked | rotated`,
  `identity.capability.granted | revoked`,
  `identity.contact-card.published`),
- the projection's lifecycle and authority enforcement,
- the inbound verification pipeline (verifier check #7 + #8 from
  `docs/architecture/local-verifier.md`),
- the locally-emitted append path (`appendLocalIdentityEvent`),
- the PWA emit helpers (`emitContactCardPublishedEvent`,
  `emitDeviceRotatedEvent`),
- the contact-card publication digest as an audit commitment.

Excluded scope:

- Controller-key recovery / supersession (no ADR yet; the
  recovery path itself does not exist today and is treated as
  future work, not as a defended surface).
- Capability proof-on-the-wire (capabilities exist in the
  identity log; capability _proofs_ attached to regular events
  are not yet specified).
- Multi-controller accounts (v1 is single-controller).
- MLS group key schedule — Class D events are out of scope for
  this document.

## Assets

- **Controller key** (private). Compromise = total account
  compromise. Held on the bootstrap device only today.
- **Device keys** (private, per device). Compromise = ability to
  sign payload events as that device until revocation.
- **Identity-control log** (signed events). Integrity protected
  by signatures; availability protected by replay/checkpoints.
- **`IdentityControlState` projection** (frozen, deterministic).
  The PWA reads from this for trust cues, capability checks,
  and the verifier's authority decisions.
- **Contact-card publication digests.** Public commitment to a
  contact-card content that may itself be private; the digest
  must not leak more than intended.

## Trust boundaries

- **Device / device-storage boundary.** Private keys never
  leave the device; the encrypted-key-material flow in
  `@lfp2p/crypto` protects the at-rest key.
- **Device / bridge boundary.** Bridges never see private
  payloads (per `bridge-admission-doctrine.md`). Bridges do see
  signed identity event metadata (kind, author, eventId,
  lamport, timestamps, privacy scope).
- **Controller / device boundary.** Today the bootstrap device
  also holds the controller key. A future ADR may split them.
- **Account / device boundary.** A device is authorized by a
  controller-signed `identity.device.authorized`. Once
  revoked, the device is structurally barred from authoring
  future identity events under that identity.

## Actors

- Honest local user.
- Honest peer / honest controller of another account.
- Attacker holding a _stolen device key_ but not the controller key.
- Attacker holding a _stolen controller key_ (worst-case).
- Attacker controlling a bridge but not any account key.
- Attacker controlling a peer but no key (replay-only attacker).

---

## Threat scenarios

### T-IDC-1 — Stale rotation rollback

**Attack.** Attacker replays an older
`identity.device.rotated` event whose `newPublicKey` is a key
the user has since rotated away from. If applied, the device
identity rolls back to the old key, allowing the attacker
(who may still hold that old key) to sign events.

**Defense.**

- Phase 2.1 `applyDeviceRotated` requires
  `event.payload.previousPublicKey === state.devices[deviceId].publicKey`.
  A stale rotation event whose `previousPublicKey` references
  a _now-stale_ publicKey is rejected with
  `IDENTITY_AUTHORITY_MISMATCH`.
- Monotonic-epoch enforcement
  (`event.payload.epoch > state.epoch`) also rejects stale
  rotation events whose epoch has already been surpassed.
- The verifier boundary's check #8 runs both before any state
  is committed.

**Residual risk.** None at the protocol layer. A device that
has not yet replayed the _latest_ rotation may temporarily
hold a stale `state.devices[deviceId].publicKey`; once it
syncs the canonical chain it converges.

**Pinned by.** `phase-2.1.test.ts` — "rejects rotation with
non-monotonic epoch" + "rejects rotation when previousPublicKey
does not match the stored key".

### T-IDC-2 — Device resurrection

**Attack.** A device key the user has revoked attempts to sign
a new identity event (e.g. self-re-authorize, grant a new
capability, publish a contact card).

**Defense.**

- `requireControllerSigner` checks that
  `event.signature.publicKey === state.controllerPublicKey`.
  A revoked device's key cannot resurrect itself because the
  controller key is not the revoked device's key (unless the
  revoked device IS the bootstrap controller — see T-IDC-5).
- For non-identity events (payload events authored by the
  revoked device), the future verifier extension MUST cross-check
  `event.signature.publicKey` against
  `state.devices[event.deviceId].status === 'active'`. **This
  cross-check is not yet implemented as a verifier hard fail
  for non-identity payload events** — it is deferred to the
  Phase 4.1 trust-policy engine integration (see "Gaps" below).

**Residual risk.** Today, a payload event signed by a revoked
device's key passes signature verification (the key is still
mathematically valid). The verifier _currently does not_ reject
a signature-valid event from a revoked device on the inbound
path. Downstream selectors and bridge admission may catch it
(Phase 4.1 deferral).

**Mitigation status.** Documented gap. Phase 4.1 wiring of
the transport-admission engine + a verifier follow-up
(verifier check #10 = "signer device is active on the
authoritative identity-control projection") is the natural
defense.

### T-IDC-3 — Post-revocation recovery gap

**Attack.** Not strictly an attack; a structural risk. A user
revokes all of their devices (e.g. lost all devices). They
have no way to recover the account because the controller key
was held on those devices.

**Defense.** None today.

**Mitigation status.** Documented limitation. A future ADR is
required to specify a recovery flow (social recovery via
trusted contacts; recovery shards; pre-recorded recovery
authority). Until then, the doctrinal answer is "bootstrap a
new identity, re-publish a new contact card with a fresh
`controllerPublicKey`, and rely on out-of-band fingerprint
re-verification." This is explicitly documented in
`revocation-realism.md`.

### T-IDC-4 — Bridge withholding revocation

**Attack.** Adversarial bridge silently drops a user's
revocation event so the user's peers continue to honor the
revoked device.

**Defense.**

- Revocation events are signed; the bridge cannot _forge_
  one. It can only _withhold_.
- Sync checkpoints are monotonic per `(sourceId, streamId, scope)`.
  A peer whose checkpoint cursor advances without seeing the
  revocation will be unaware of it; that's the attack's foothold.
- Mitigation depends on the peer's ability to detect a stale
  view: re-bootstrapping from a fresh bridge, contact-card
  re-publication with a new digest, or out-of-band fingerprint
  verification all surface the discrepancy.

**Residual risk.** Real and documented. Per
`revocation-realism.md`, "no guaranteed propagation timing"
is an inherent limit of local-first sync. Multi-bridge
redundancy (Phase 4+ when the bridge runtime supports
fallback) and a future "revocation-included-up-through"
indicator on the contact card mitigate but cannot eliminate.

### T-IDC-5 — Stolen controller key

**Attack.** Attacker obtains the controller key material
(physical device theft + key extraction; phishing of an
encrypted key + the protection key; supply-chain attack on
`@lfp2p/crypto`). With it, the attacker can sign any identity
event, including device-authorize for an attacker-controlled
device, capability-grant, and contact-card-publish.

**Defense today.**

- Encrypted-key-material at rest with a non-extractable
  protection key (`@lfp2p/crypto`); requires extracting the
  protection key first.
- Same-device requirement: the controller key today lives on
  the bootstrap device; multi-device theft is harder than
  single-device theft.

**Defense gap.** Once the attacker has the key, there is no
defense at the protocol layer today. They become the
controller. Recovery requires Phase 2.3 controller-key
supersession (deferred — see T-IDC-3).

**Mitigation status.** Documented worst case. The honest UX
should encourage users to encrypt their device storage,
require a device unlock for high-stakes actions, and (once the
rotation UI ships) regularly re-verify fingerprints with
trusted contacts so a quiet takeover surfaces sooner.

### T-IDC-6 — Forged contact-card publication

**Attack.** An attacker who does not hold the controller key
publishes a contact-card publication event claiming to
supersede the legitimate one.

**Defense.**

- `applyContactCardPublished` calls `requireControllerSigner`.
  An event whose signer is not the controller is rejected.
- The verifier's signature check (#2) precedes; an event with
  an invalid signature never reaches the projection.

**Residual risk.** None at the protocol layer. The attacker
would need the controller key — which is T-IDC-5, not T-IDC-6.

**Pinned by.** `phase-2.2.test.ts` — `emitContactCardPublishedEvent`
test "requires the controller signer (a non-controller key is
rejected)".

### T-IDC-7 — Replay of a contact-card publication

**Attack.** Attacker replays an older
`identity.contact-card.published` event after the user has
published a newer card. If applied, the projection's "current
publication digest" rolls back to the old digest.

**Defense.**

- Idempotency on `eventId`: a re-played event is a silent
  no-op at the store-append boundary.
- Projection logic: `applyContactCardPublished` always sets
  the publication to the _current_ event's values. If the
  event is replayed in-order (older one _first_ on a new
  device), the latest one still wins because it lands last.
- `seedIdentityControlProjection` sorts events by Lamport
  clock, `createdAt`, and `eventId` before reduce. A replayed
  older event lands in its correct sort position and is
  overridden by the newer event in the same replay.

**Residual risk.** Low. A device that has _only_ the old event
(never received the new one) does see the stale publication
digest. This is fundamental to local-first sync, not a bug.

### T-IDC-8 — Identity ID collision

**Attack.** Two different controllers attempt to claim the
same `identityId` so a peer cannot tell whose events they're
reading.

**Defense.**

- The `identityId` convention (per protocol shape) is
  controller-public-key-derived. An attacker who does not hold
  the controller key cannot produce an event whose
  `author === identityId` AND whose
  `signature.publicKey === controllerPublicKey`. Cryptographic
  collision is infeasible.
- `applyControllerCreated` rejects re-emission of the
  controller-created event onto a state that already has a
  controller key.

**Residual risk.** None at the cryptographic layer.

### T-IDC-9 — Capability-proof gap on payload events

**Attack.** An event author claims a capability they do not
have (e.g., "I am allowed to write into the moderation queue
even though my device's `outbox.send` capability was revoked").

**Defense.** Capabilities are recorded in the identity-control
log. The downstream consumer (moderation tools, trust-policy
engine) MUST cross-check
`state.capabilities[capabilityId].status === 'granted'` AND
the event's claimed capability ID before honoring the action.

**Defense gap.** Today, **no protocol event carries a
capability proof on the wire**. Capabilities exist only in the
identity log; their _use_ by payload events is unspecified.

**Mitigation status.** Documented future work. A capability-on-the-wire
ADR is needed before chat (Phase 5), moderation tools (future),
or the bridge admission engine (Phase 4.1) can structurally
enforce capability-bound writes.

### T-IDC-10 — Snapshot drift vs replay

**Attack.** The persisted `identityControlProjections` snapshot
is corrupted (Dexie bug, partial write, attacker with disk
access). A subsequent identity event is applied on top of a
drifted snapshot, producing a state that diverges from the
canonical log.

**Defense.**

- Phase 2.2 introduces `listLocalIdentityEvents(identityId)` +
  caller-side `seedIdentityControlProjection` as the
  rebuild-from-log path. The snapshot is a _cache_; the log is
  the source of truth.
- Phase 2.1 added defense-in-depth re-validation in
  `applyIdentityControlEvent`: every identity event is
  validated through `validateIdentityEvent` before mutation.
  A corrupted snapshot whose `epoch` is too low gets
  _replayed-and-corrected_ on next reseed.

**Residual risk.** The window between a corrupted snapshot and
the next reseed produces a temporarily-wrong projection. A
periodic integrity check (replay the log, compare to the
snapshot, alert on mismatch) is the natural follow-up. Not
shipped today.

---

## Gaps and deferrals (consolidated)

| Gap                                                            | Target                                               | Status     |
| -------------------------------------------------------------- | ---------------------------------------------------- | ---------- |
| Verifier hard-fail on signer-device-revoked for payload events | Phase 4.1 (transport admission) + verifier check #10 | Documented |
| Controller-key recovery / supersession                         | Phase 2.3 (future, new ADR required)                 | Documented |
| Capability proof-on-the-wire                                   | Future capability ADR + verifier check #11           | Documented |
| Multi-controller accounts                                      | Future ADR                                           | Documented |
| Periodic snapshot-vs-log integrity check                       | Phase 2.2 follow-on                                  | Documented |
| Multi-bridge redundancy for revocation propagation             | Phase 4+                                             | Documented |

## Acceptance for this threat model

This document is accepted as the canonical statement of:

- what the identity layer defends against today,
- what it does not yet defend against, with each gap mapped to
  a future phase,
- the relationship between identity events and the verifier
  boundary documented in `docs/architecture/local-verifier.md`.

It pairs with `docs/protocol/revocation-realism.md` (which
covers user-facing language for the same gaps) and the
existing `docs/threat-model/bridge-compromise.md` and
`docs/threat-model/trust-safety-and-abuse.md`.
