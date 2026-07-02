# ADR-016: Virtual Delivery Service v1

- Status: Proposed
- Date: 2026-07-01
- Roadmap phase: Phase 6 — MLS private group encryption v1
- Related docs:
  - `docs/specification/08-security/mls-virtual-delivery-service.md`
  - `docs/specification/08-security/mls-fork-detection-and-recovery.md`
  - `docs/adr/012-mls-dependency-and-group-keying-v1.md`
  - `docs/adr/015-mls-library-selection-v1.md`
  - `docs/protocol/bridge-admission-doctrine.md`
- Depends on:
  - ADR-008 adaptive reachability / infrastructure capability surfaces
  - Phase 1.64 transport admission engine
  - Phase 5 mailbox specifications (`docs/specification/05-mailbox/`)

## Context

RFC 9420 architecturally assumes a Delivery Service (DS) that (a) stores and serves KeyPackages, (b) fans out handshake and application messages, and (c) — in most deployments — serializes commits so every member sees one linear epoch history.

All three assumptions collide with this protocol's doctrine: infrastructure is availability, never authority. A bridge that serializes commits becomes the group's ordering authority; a mandatory KeyPackage directory becomes a membership chokepoint; a required fan-out server becomes a single censorship point.

Alternatives considered:

1. **Hosted DS per group** (Matrix/Wire-style): simplest MLS integration; rejected — creates exactly the latest-state/ordering authority the doctrine forbids, and groups die with their server.
2. **Member-elected DS** (one member serializes commits): no infrastructure authority, but elects a member as authority instead; unavailable elections stall the group; rejected as v1 model (revisitable for high-churn groups).
3. **Total-order broadcast substrate** (consensus/log service): heavyweight, reintroduces infrastructure authority with extra steps; rejected.
4. **Decomposed "virtual" DS**: DS functions become optional provider capabilities on existing surfaces; ordering is not provided at all — clients tolerate concurrent commits via fork detection and signed recovery. Chosen.

The cost of option 4 is honest: without a serializer, commit races happen. The protocol pays for that with the fork detection/recovery machinery already designed in Phase 4 (`mls.fork.detected`, `mls.fork.recovery.published`, deterministic fallback), rather than paying with a central authority.

## Decision

Adopt the **virtual Delivery Service** model: the DS role is decomposed into three optional provider capabilities that any delivery surface (bridge, relay, super-peer, mailbox host) MAY advertise, with every authority-bearing decision kept client-side.

- `availability.mls-key-package-store` — store/serve signed KeyPackage publications.
- `availability.mls-welcome-delivery` — route encrypted Welcomes as mailbox delivery envelopes.
- `availability.mls-message-fanout` — store-and-forward MLS handshake/application ciphertext with advisory ordering hints.

No surface serializes commits. Commit acceptance is client-side epoch validation; conflicts resolve through the fork detection and recovery specification.

Normative requirements live in `docs/specification/08-security/mls-virtual-delivery-service.md`; this ADR records the decision and the bridge-side design.

## What the bridge does and does not see

The bridge acting as a virtual DS handles only:

- signed KeyPackage publications (public join material by design);
- Welcome ciphertext and routing metadata (recipient device address);
- MLS handshake/application ciphertext, group routing labels, sizes, timing.

It never sees: group payload plaintext, group secrets, membership decisions (it observes traffic, not authority), or epoch validity (it cannot distinguish a winning commit from a losing one).

Admission of MLS traffic reuses the Phase 1.64 engine unchanged: schema check, replay cache, privacy-scope-per-surface, kind allowlist, byte caps, compression-bomb guard, peer quarantine, rate limits.

## Key-package store design

Store record shape (service-local storage; the publication itself is the signed protocol object):

```txt
KeyPackagePublication
  keyPackage        opaque RFC 9420 KeyPackage bytes (or BlockRef)
  controllerId      binding to protocol identity
  deviceId          binding to authorized device
  ciphersuite       must match the pinned v1 suite
  notAfter          expiry; store must not serve past it
  lastResort        boolean; exactly one active per device
  signature         device signature over the publication
```

Store semantics:

- validate structure, signature, expiry, byte cap on publish; **never** validate membership;
- consume-once serving for ordinary KeyPackages; repeatable serving for the last-resort KeyPackage when the pool is empty;
- per-device publication cap and per-requester fetch rate limits (depletion defense);
- delete on observed device revocation as hygiene — clients re-validate device authorization regardless;
- store state is Class E infrastructure observation: rebuildable, non-authoritative, not synced as protocol truth.

## Welcome and fan-out design

- Welcomes ride the existing mailbox delivery-envelope path; the store-side work is routing ciphertext to a device inbox with mailbox TTL/caps. Sealed-recipient delivery is used where the mailbox profile supports it.
- Fan-out attaches an optional per-group monotonic sequence as an **ordering hint**. Hints accelerate catch-up and fork _detection_; they are prohibited as an input to fork _resolution_ (a hint-trusting client would hand ordering authority back to the surface).

## Consequences

- Groups work with zero infrastructure (direct sessions, Portable Sync Drops) — the DS capabilities only improve latency and offline catch-up.
- Multi-surface publication is the availability strategy and the withholding defense; no DS failover protocol is needed because nothing fails over — capabilities are stateless-ish caches of signed material.
- Commit races are a normal, specified condition rather than an outage. UX must tolerate short `forked` windows in high-concurrency groups.
- Bridge operators gain three narrowly-scoped capabilities to advertise, each cleanly rate-limitable and audit-safe (KeyPackage digests and group labels follow existing redaction rules).

## Non-goals

- No implementation in this ADR (bridge endpoints, Dexie schema, provider adapters follow in Phase 6 implementation plans).
- No member-elected DS or ordering service (revisit only with evidence that fork rates are unacceptable at target group sizes).
- No change to mailbox authority semantics: Welcome delivery state is mailbox state, not group state.

## Threat model

| Threat                                           | Mitigation                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Surface withholds commits to partition a group   | Multi-surface publication; direct/sync-drop fallback; membership-digest mismatch surfaces the gap             |
| KeyPackage pool depletion by hostile fetcher     | Rate limits, per-requester caps, last-resort KeyPackage                                                       |
| Store serves stale/revoked KeyPackages           | Client-side expiry + device-authorization re-validation; store deletion is hygiene only                       |
| Surface forges or mutates records                | Everything is signed; mutation fails client validation                                                        |
| Surface equivocates (different views per member) | Signed records + membership digests + fork recovery converge state when members compare notes                 |
| Ordering-hint manipulation                       | Hints are advisory by specification; resolution inputs are signed candidates only                             |
| Metadata harvesting by DS-capable surface        | Pseudonymous group routing labels (spec open question), privacy-safe logging rules, mailbox sealed recipients |

## Follow-up

- Bridge implementation plan: KeyPackage store endpoints + persistence, Welcome routing over the existing mailbox path, fan-out with ordering hints, admission wiring.
- Registry entries for the three capabilities and the `key-package-exhausted` / `key-package-expired` error codes.
- Fixtures: KeyPackage lifecycle (publish/serve/consume/expire/last-resort), depletion attack, no-plaintext proof, zero-DS group operation.
- Pseudonymous group routing label design (spec open question).

## References

- RFC 9420, Section 2 (Operating Environment: Delivery Service assumptions).
- MLS Architecture (RFC 9750): Delivery Service functional description.
- ADR-008: Adaptive Reachability and Ephemeral Infrastructure v1.
- `docs/protocol/bridge-admission-doctrine.md` (Phase 1.64 admission engine).
