# Phase Exit Report: Phase 2.1 — Identity protocol core (validator + new event kinds)

- Status: Accepted as complete
- Date: 2026-06-03

## Phase scope

Phase 2.1 is the protocol-core slice of Phase 2 (Identity control log
v1), mirroring how Phase 1.61 was the protocol-core slice of the T&S
1.6x family. Specifically:

1. Stable `IDENTITY_*` error-code namespace and `IdentityError` class.
2. A pure shape validator (`validateIdentityEvent`) for the 7 v1
   event kinds, separate from the projection — anything that does
   not depend on existing state is rejected at validation time, not
   at apply time.
3. Two new event kinds:
   - `identity.device.rotated` — swap a device's public key in
     place while preserving the deviceId. Fixes the "rotate ≠ revoke
     + re-add" gap that v1 needed before Phase 5 (chat vertical
     slice) and Phase 6 (MLS) can begin.
   - `identity.contact-card.published` — formalize the audit trail
     for contact-card publications. The PWA already emits contact
     cards; the projection now retains the most recent digest.
4. First-class fixtures (7 valid + 6 invalid) and 39 adversarial
   tests.
5. Doctrine doc `docs/protocol/identity-control-log.md`.

## Completed work

### `@lfp2p/identity/errors.ts` (new)

- `IDENTITY_ERROR_CODES`: 22-code namespace prefixed `IDENTITY_*` so
  it doesn't collide with `CA_*` (`@lfp2p/content-addressing`) or
  `TS_*` (`@lfp2p/trust-safety`).
- `IdentityError` class with `code` field; messages format as
  `[CODE] <message>` and are not branch-stable.

### `@lfp2p/identity/validation.ts` (new)

- `IDENTITY_EVENT_VERSION = 'lfp2p.identity-event.v1'`.
- `IDENTITY_EVENT_KINDS` pins the 7 v1 kinds in canonical order.
- `validateIdentityEvent(value): ValidatedIdentityEvent` is a pure
  function. Returns a frozen, narrowed discriminated-union value or
  throws `IdentityError`.
- Enforces:
  - Version pinning, kind allowlist.
  - Prototype-pollution defense at every plain-object boundary
    (`__proto__`, `prototype`, `constructor`, `hasOwnProperty`,
    `isPrototypeOf`, `propertyIsEnumerable`, `toString`,
    `toLocaleString`, `valueOf`); also rejected when used as an id.
  - Public-key wire format (`^[A-Za-z0-9_-]{1,2048}$`).
  - Digest reference wire format
    (`^(sha-256|sha-512|blake3):[A-Za-z0-9_-]{20,4096}$`).
  - Epoch as safe positive integer.
  - Scope length bounds.
  - 16 KB serialized-payload size cap (belt-and-suspenders against
    an oversized payload slipping past the envelope layer).
  - `identity.device.rotated` cross-check:
    `newPublicKey !== previousPublicKey`.

### `@lfp2p/identity/control-log.ts` updates

- `applyIdentityControlEvent` re-runs the pure validator on identity
  events before any projection mutation (defense-in-depth).
- Added projection branches for `identity.device.rotated` and
  `identity.contact-card.published`.
- New projection state field
  `contactCardPublication?: IdentityContactCardPublication`.
- New `IdentityContactCardPublication` shape.
- `identity.device.rotated` lifecycle enforcement:
  - `IDENTITY_DEVICE_NOT_FOUND` when device is unknown.
  - `IDENTITY_LIFECYCLE_TRANSITION` when device is not `active`.
  - `IDENTITY_AUTHORITY_MISMATCH` when `previousPublicKey` does
    not match the stored key (prevents a stale rotation from
    rolling the key back to an earlier value).
  - `IDENTITY_DEVICE_REUSE` when `newPublicKey === previousPublicKey`.
  - Monotonic-epoch enforcement against `state.epoch`.
- `identity.contact-card.published`:
  - Requires controller-key signer.
  - Replaces the prior `contactCardPublication` (audit trail lives
    in the signed-event log; the projection retains only "latest").

### `@lfp2p/protocol` updates

- Added `identity.device.rotated` and `identity.contact-card.published`
  to the `EVENT_KINDS` allowlist (additive; backward-compatible).

### Public surface (`@lfp2p/identity/index.ts`)

Newly exported:
- `IDENTITY_ERROR_CODES`, `IdentityError`, `identityError`, `IdentityErrorCode`.
- `IDENTITY_EVENT_KINDS`, `IDENTITY_EVENT_VERSION`,
  `validateIdentityEvent`, `IdentityEventKind`, `ValidatedIdentityEvent`,
  `assertPlainObject` (helper for downstream consumers).
- `IdentityContactCardPublication`.

### Fixtures

`packages/identity/fixtures/valid/` (7):
- `controller-created.json`, `device-authorized.json`,
  `device-revoked.json`, `device-rotated.json`,
  `capability-granted.json`, `capability-revoked.json`,
  `contact-card-published.json`.

`packages/identity/fixtures/invalid/` (6):
- `forbidden-key-in-payload.json` (prototype-pollution defense).
- `invalid-public-key.json`.
- `unknown-kind.json`.
- `unknown-version.json`.
- `rotated-same-key.json` (newPublicKey === previousPublicKey).
- `epoch-non-integer.json`.

### Tests

`packages/identity/src/phase-2.1.test.ts` — 39 new tests:

- Public surface: kind list, version, error-code prefix.
- Validator: non-object rejection, version, kind, forbidden keys
  (both as payload keys via `JSON.parse` and as ids), public-key
  format, epoch hygiene (non-positive, non-integer), oversized
  payload, well-formedness + freezing, rotated self-key rejection,
  contact-card digest format.
- Fixtures: `it.each(valid)` and `it.each(invalid)` round-trip
  every fixture.
- Projection lifecycle:
  - `device.rotated` happy path (key swapped, epoch bumped).
  - `device.rotated` rejection for unknown device,
    authority mismatch, revoked device, non-monotonic epoch.
  - `contact-card.published` happy path; replacement; non-controller
    signer rejection.

### Verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 1010 passing (971 → 1010, +39)
pnpm build       # clean
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|:---:|---|
| Stable `IDENTITY_*` error namespace exists | ✓ | `errors.ts`; 22 codes |
| Pure shape validator separate from projection | ✓ | `validation.ts`; 39 tests |
| Prototype-pollution defense on every payload-object boundary | ✓ | `assertPlainObject`; `forbidden-key-in-payload.json` |
| `identity.device.rotated` lands with full state-aware enforcement | ✓ | projection + 4 rejection tests |
| `identity.contact-card.published` lands with the latest-publication semantic | ✓ | projection + 3 tests |
| Doctrine doc documents kinds, validator rules, and lifecycle | ✓ | `docs/protocol/identity-control-log.md` |
| Fixtures cover every kind + adversarial inputs | ✓ | 7 valid + 6 invalid |
| No regressions: existing identity tests still pass | ✓ | sweep clean |

## Deferred work

- **Phase 2.2 — Identity projection persistence + PWA wiring.** Store
  the projection in `@lfp2p/local-store` and emit events from the
  PWA's identity flows. Today the projection rebuilds from a
  signed-event array; the next slice persists the log and adds
  an emit/append flow analogous to Phase 1.70.B for T&S.
- **Account recovery flow.** Requires a controller-key replacement
  semantic that v1 does not define.
- **Capability delegation chains.** v1 capabilities are direct from
  the controller; delegate-of-delegate is a future slice.
- **Multi-controller accounts.** v1 is single-controller.
- **Threat model document for identity.** Belongs in a future
  slice alongside Phase 2.2 wiring.

## Decision

This phase is:

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: The identity-control protocol core now has the same shape
guarantees as the T&S protocol core: stable error codes, pure
validator separate from projection, prototype-pollution defense,
adversarial fixtures, lifecycle enforcement with stable error codes.
Phases 5 (chat vertical slice) and 6 (MLS) have a stable identity
foundation to build on; Phase 2.2 (persistence + PWA wiring) is the
next slice.
