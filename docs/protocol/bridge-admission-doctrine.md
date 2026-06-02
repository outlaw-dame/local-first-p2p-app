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

## Implementation evidence

- Package: `packages/trust-safety/src/transport-admission/`
- 735 tests pass across the monorepo; ~60 of those exercise the
  admission slice directly.
- 4 valid + 2 invalid fixtures covering accepted / rate-limited /
  quarantined / media-rejected.
- Exit report: `docs/implementation/phase-1.64-exit-report.md`.
