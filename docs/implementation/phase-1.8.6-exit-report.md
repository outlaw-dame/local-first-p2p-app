# Phase Exit Report: Phase 1.8.6 — Live wiring of applyAdmissionBand into transport-admission

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

Closes the Phase 1.8.3 admission-band-to-engine integration that
was deferred from the original surface-integration slice. Adds a
pure helper that bridges the Phase 1.8.3 doctrine band table to the
Phase 1.64 `RateLimitConfig` shape, and wires the bridge into
`runAdmissionChecks` via an optional context lookup.

**Engine math is unchanged.** All 60+ pre-1.8.6 transport-admission
tests continue to pass. The integration is parameter-only: when a
lookup is supplied the engine uses the per-peer modulated config;
when no lookup is supplied the engine sees byte-identical behavior.

## Completed work

### `packages/trust-safety/src/transport-admission/reputation-modulation.ts` (new)

- `modulateRateLimitConfig(baseline, score)` — pure helper applying
  the Phase 1.8.3 doctrine multipliers to a `RateLimitConfig`:
  - high band ⇒ `capacity × 2`, `refillRatePerSecond × 2`, `baseBackoffMs × 0.5`
  - mid band ⇒ identity (no-op)
  - low band ⇒ `× 0.5 / × 0.5 / × 1.5`
  - untrusted (default for unknown peers) ⇒ `× 0.25 / × 0.25 / × 2`
- The doctrine's `cooldownExponentMultiplier` maps to `baseBackoffMs`
  here — the existing rate-limit has a fixed `2^(n−1)` growth law
  and no separate exponent parameter; dialing the initial cooldown
  scales the whole geometric-progression schedule, preserving the
  doctrine intent.
- Capacity rounded down with a floor of 1 (so a tiny baseline +
  untrusted band can't degenerate to 0 tokens).
- `baseBackoffMs` clamped at `maxBackoffMs` so the rate-limit
  invariant `baseBackoffMs ≤ maxBackoffMs` always holds.
- Resulting config re-validated via `validateRateLimitConfig` —
  defense-in-depth.
- `modulateDefaultRateLimit(score)` convenience.

### `packages/trust-safety/src/transport-admission/admission.ts` (extended)

- `AdmissionContext.reputationScoreLookup?: (peerId) => number | undefined`.
- `AdmissionOutputs.reputationBand?: 'high' | 'mid' | 'low' | 'untrusted'`
  — privacy-safe stable string per Phase 3.1 (the raw score is
  never logged).
- `runAdmissionChecks` refactored to a thin wrapper that computes
  the per-peer modulated `effectiveRateConfig` once, delegates to
  the private `runAdmissionChecksInner`, and decorates the final
  output with `reputationBand` when set. Every check path
  (early-reject through rate-limit through admit) reports the same
  band; the band is computed once.
- When no lookup is provided, the wrapper returns the inner result
  unmodified — byte-identical to pre-1.8.6 behavior. Existing
  tests pin this.

### `transport-admission/index.ts` (extended)

- Exports `modulateRateLimitConfig`, `modulateDefaultRateLimit`,
  `ModulatedRateLimit`.

### 15 new adversarial tests (`phase-1.8.6-reputation-modulation.test.ts`)

- Doctrine band table verbatim across all four bands (4 tests).
- Capacity floor (rounds tiny capacity up to 1).
- `baseBackoffMs ≤ maxBackoffMs` invariant preserved across
  modulation (modulated config validates cleanly).
- Output frozen.
- Bad baseline throws (defense-in-depth on the validator backstop).
- `modulateDefaultRateLimit` uses the package default.
- Engine wiring (5 tests):
  - no lookup → no band on outputs (byte-identical to pre-1.8.6),
  - lookup returning `undefined` → `'untrusted'` band,
  - lookup returning high score → `'high'` band,
  - **high-band peer admits more in a fresh-bucket burst than an
    untrusted peer** (end-to-end behavioral pin: high cap 120 vs
    untrusted cap 15 over 30 iterations),
  - audit-log entry shape preserved when band is set.
- Regression — defaults preserve pre-1.8.6 behavior (1 test).

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1477 passing (1428 → 1477, +15 here + 34 in 1.8.7)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                  | Status | Evidence                                               |
| ---------------------------------------------------------- | :----: | ------------------------------------------------------ |
| Doctrine band table multipliers applied verbatim           |   ✓    | 4 dedicated tests                                      |
| Engine math UNCHANGED (no duplication, no drift)           |   ✓    | 60+ existing tests pass; integration is parameter-only |
| Default behavior (no lookup) byte-identical to pre-1.8.6   |   ✓    | regression test                                        |
| Unknown peer collapses to `'untrusted'` band (fail-closed) |   ✓    | dedicated test                                         |
| Audit-safe band string on outputs (no raw score)           |   ✓    | type pins `'high' \| 'mid' \| 'low' \| 'untrusted'`    |
| Defense-in-depth on bad baseline / modulator drift         |   ✓    | bad-baseline throws + modulated config re-validated    |

## Deferred

- **Bucket-state migration on band change.** Today a peer's
  in-flight bucket retains its existing `tokens` count when their
  band shifts; only the refill/capacity going forward changes.
  Tightening this (e.g. clamping tokens to the new capacity) is
  additive and can land in a future slice.
- **Audit-log integration** of the `reputationBand` field. Today
  the band is exposed on `AdmissionOutputs` but the audit log
  entry shape is unchanged. A future slice can extend the audit
  shape additively.
- **Sync-client wiring** that supplies the `reputationScoreLookup`
  from the device's local `LocalReputationState`. Today the lookup
  is plumbed but not yet auto-populated — callers opt in explicitly.

## Decision

- [x] accepted as complete

Reason: the bridge between Phase 1.8.3 surface integration and the
Phase 1.64 engine is structurally complete and pin-tested. Engine
math is preserved by design (no algorithm copies, only parameter
multiplication). Defaults preserve byte-identical behavior. The
fail-closed default for unknown peers matches the doctrine.
