# Phase Exit Report: Phase 2.3 (a + b) — Identity threat model + PWA identity audit/rotation UI

- Status: Accepted as complete (Phase 2.3a + Phase 2.3b shipped;
  Phase 2.3 remainder deferred behind ADRs)
- Date: 2026-06-03

## Phase scope

Phase 2.3 was originally a grab-bag of identity follow-ups. We
intentionally split out the two parts that are shippable right
now from the parts that require new ADRs:

| Sub-slice | Status | What it covers |
|---|---|---|
| **Phase 2.3a** | Shipped | Identity-specific threat-model document (`docs/threat-model/identity-control.md`) |
| **Phase 2.3b** | Shipped | PWA identity-audit view-model + React surface + rotation affordance |
| **Phase 2.3 remainder** | Deferred behind ADRs | Controller-key recovery / supersession; capability delegation chains; multi-controller accounts; cross-app identity-event sync |

The deferred items each require a dedicated ADR before code can
land. We do not pretend to defend a surface that does not yet
exist.

## Completed work

### Phase 2.3a — `docs/threat-model/identity-control.md`

A canonical threat model for the identity-control event family
covering ten threat scenarios with explicit defense status and
residual risk:

- **T-IDC-1 — Stale rotation rollback.** Defended by Phase 2.1's
  `previousPublicKey` cross-check + monotonic epoch.
- **T-IDC-2 — Device resurrection.** Identity events: defended by
  `requireControllerSigner`. Non-identity payload events:
  documented gap, target Phase 4.1 + verifier check #10.
- **T-IDC-3 — Post-revocation recovery gap.** No defense; Phase
  2.3 future ADR required.
- **T-IDC-4 — Bridge withholding revocation.** Inherent
  local-first limit; documented and mitigated by multi-bridge
  redundancy (Phase 4+) and out-of-band fingerprint re-verification.
- **T-IDC-5 — Stolen controller key.** Worst-case; no defense
  once the key is extracted. Recovery is T-IDC-3.
- **T-IDC-6 — Forged contact-card publication.** Defended by
  controller-signer requirement.
- **T-IDC-7 — Replay of contact-card publication.** Defended by
  eventId idempotency + sorted replay.
- **T-IDC-8 — Identity ID collision.** Cryptographically
  infeasible.
- **T-IDC-9 — Capability-proof gap on payload events.** No defense
  today; capability ADR required.
- **T-IDC-10 — Snapshot drift vs replay.** Mitigated by Phase
  2.2's replay-from-log helper; periodic integrity check is a
  future slice.

The document pairs with `docs/protocol/revocation-realism.md` (UX
language) and `docs/architecture/local-verifier.md` (boundary
enforcement) so each documented gap has a follow-up named.

### Phase 2.3b — PWA identity audit + rotation UI

Three new files:

- **`apps/pwa/src/pwa-identity-audit-state.ts`** (pure logic):
  - `buildIdentityAuditViewModel(projection, options?)` returns a
    frozen, totally-ordered view of devices, capabilities, and
    contact-card publication. `nextEpoch` is exposed so the
    rotation flow does not re-derive.
  - Device-row classification: `isController` (device's publicKey
    equals projection's `controllerPublicKey`) is rotation-disabled;
    `isRotatable` is true only when active AND not controller.
  - Capability-row classification: `isActive` reflects granted +
    not-expired (TTL-aware).
  - Stable ordering: controller-first → active by `authorizedAt` →
    revoked.
  - `shortPublicKeyFingerprint` produces a UI-display fingerprint
    (`first8…last8`) — explicitly NOT for trust decisions.
  - `prepareRotationIntent(viewModel, deviceId, newPublicKey)`
    pre-validates the rotation client-side and returns an intent
    structure (`identityId`, `deviceId`, `previousPublicKey`,
    `newPublicKey`, `epoch`). Refuses controller-device rotation,
    revoked devices, same-key reuse, and unknown devices.
- **`apps/pwa/src/pwa-identity-audit-state.test.ts`** — 17 tests
  pinning every classification rule, every refusal path, and the
  capability TTL semantics.
- **`apps/pwa/src/pwa-identity-audit.tsx`** — Framework7 React
  surface rendering devices, capabilities, contact-card
  publication. Non-controller active rows show a "Rotate key"
  button. On click:
  1. Generate a fresh `SigningKeypair` via `@lfp2p/crypto`.
  2. `prepareRotationIntent` (client-side precondition).
  3. `globalThis.confirm` with both OLD and NEW fingerprint
     displayed.
  4. `emitDeviceRotatedEvent` (Phase 2.2 helper) — signed by the
     in-memory controller keypair, persisted atomically through
     `appendLocalIdentityEvent`.
  5. Status line shows the new fingerprint; the audit refreshes.
  Controller-device rows show an explicit explanation that
  controller-key supersession is a separate (deferred) flow.

### Wiring

- `apps/pwa/src/root-app.tsx` mounts `<IdentityAudit>` on the
  home page when both `identity` and `keypair` are bootstrapped.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1051 passing (1034 → 1051, +17 audit-state tests)
pnpm build       # clean; PWA bundle 1,196 KB → 1,214 KB (≈ +18 KB)
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|:---:|---|
| Identity-specific threat-model doc exists and maps every gap to a future phase | ✓ | `docs/threat-model/identity-control.md` (10 threat scenarios + consolidated gap table) |
| PWA exposes the identity-control projection as an audit surface | ✓ | `IdentityAudit` mounted in `root-app.tsx` |
| Controller-key rotation is explicitly NOT available; the UI says why | ✓ | `isRotatable` rule + controller-row footer message + `prepareRotationIntent` refusal |
| Non-controller rotation works end-to-end | ✓ | `onRotate` → `prepareRotationIntent` → confirm → `emitDeviceRotatedEvent` → projection refresh |
| Rotation confirmation surfaces both OLD and NEW fingerprints | ✓ | `globalThis.confirm` text in `pwa-identity-audit.tsx` |
| Phase 2.3 remainder explicitly deferred with ADR markers | ✓ | This exit report + phase-map row |
| No regressions: existing 1034 tests still pass | ✓ | sweep clean |

## Deferred work (Phase 2.3 remainder)

Each item below requires a dedicated ADR before implementation.
They are NOT being treated as defended surfaces today.

- **Controller-key recovery / supersession.** Recovery requires
  a controller-key replacement semantic the protocol does not
  yet define (social recovery via trusted contacts, recovery
  shards, pre-recorded recovery authority). Open question:
  whether to bind recovery to MLS group membership (Phase 6) or
  to an independent recovery-authority log.
- **Capability delegation chains.** v1 capabilities are direct
  from the controller. Delegate-of-delegate requires (a) a
  capability-on-the-wire format so the recipient can verify the
  chain and (b) delegation-depth bounds. Pairs with verifier
  check #11.
- **Multi-controller accounts.** v1 is single-controller. A
  multi-controller model needs a quorum or threshold semantic
  for authority-changing events and a clear way to express
  "current controllers" in the projection.
- **Cross-app identity-event sync.** Today identity events
  ride the existing `'self'` privacy scope and are persisted
  locally. The cross-app account-local sync envelope (ADR-002,
  Phase 5.0) is the prerequisite for an identity event emitted
  on one device to materialize on another.

## Decision

This phase is:

- [x] accepted as complete for the 2.3a + 2.3b shipped slices,
- [x] explicitly partial for the remainder (each item has an
      ADR target),
- [ ] blocked,
- [ ] superseded by another phase.

The identity arc (Phase 2.1 → 2.2 → 2.3a + 2.3b) is closed at
the protocol + persistence + audit-UI altitude. Next work
pivots away from identity onto T&S block-evasion hardening
(Phase 1.71) per the recommended sequence in
`docs/implementation/next-development-path.md`.
