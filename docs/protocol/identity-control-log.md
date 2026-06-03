# Identity Control Log Doctrine

- Status: Draft
- Date: 2026-06-03
- Related ADRs:
  - `docs/adr/001-identity-control-log-v1.md`
- Related implementation docs:
  - `docs/implementation/phase-2.1-exit-report.md`
- Package: `@lfp2p/identity`

## Goal

Define the canonical event-source shape and lifecycle constraints for
the identity control log. Every device authorization, key rotation,
capability grant, and contact-card publication for an account flows
through this log. The projection state derived from a replay is the
single source of truth for "which devices can speak for this identity,
under which capabilities, and which contact-card digest is current."

## Why an event log

A flat snapshot ("here is the device list") cannot answer the audit
question that matters most: "when did this device gain or lose
authority, and who signed off?" The control log preserves the
authority chain by construction:

- Every authority-changing event is signed by the controller key.
- The projection refuses to land an event whose signer is not the
  controller (and refuses any event before `identity.controller.created`).
- Monotonic `epoch` numbers prevent a stolen older event from
  rewinding the live state.

## Event kinds (v1)

| Kind                                | Payload fields                                                       | Effect on projection |
|------------------------------------|----------------------------------------------------------------------|----------------------|
| `identity.controller.created`       | `controllerPublicKey`, `initialDeviceId`                             | Sets the controller key once. Subsequent re-emits fail closed. The initial device is recorded as `active` and signs the event with the controller key. |
| `identity.device.authorized`        | `authorizedDeviceId`, `authorizedPublicKey`, `epoch`                  | Adds an `active` device row. Monotonic-epoch enforced. |
| `identity.device.revoked`           | `revokedDeviceId`, `epoch`                                            | Flips the device to `revoked`. Idempotent on a device already revoked. |
| `identity.device.rotated`           | `deviceId`, `previousPublicKey`, `newPublicKey`, `epoch`              | Swaps the device's public key in place. `previousPublicKey` MUST match the stored key. `newPublicKey` MUST differ. Cannot rotate a revoked device. |
| `identity.capability.granted`       | `capabilityId`, `delegateDeviceId`, `scope`, `expiresAt`              | Adds a `granted` capability row. |
| `identity.capability.revoked`       | `capabilityId`, `delegateDeviceId`                                    | Flips the capability to `revoked`. Idempotent on already-revoked. `delegateDeviceId` MUST match the granted row. |
| `identity.contact-card.published`   | `contactCardDigest`, `capturedAt`                                     | Records the most recent contact-card publication. Older publications remain in the signed-event log for audit; the projection retains only the latest. |

## Pure-shape validator

`validateIdentityEvent(value)` is a pure function. It accepts an
unknown value (the unsigned payload bundle of `{version, kind, payload}`)
and returns a strongly-typed, frozen `ValidatedIdentityEvent`, or
throws an `IdentityError` with a stable `IDENTITY_*` code.

The validator enforces:

- **Version pinning**: `version === "lfp2p.identity-event.v1"`; unknown
  versions throw `IDENTITY_UNKNOWN_VERSION`.
- **Kind allowlist**: `kind` must be one of `IDENTITY_EVENT_KINDS`;
  unknown kinds throw `IDENTITY_UNKNOWN_KIND`.
- **Prototype-pollution defense**: payload keys (and every string
  treated as an id) must not be `__proto__`, `prototype`,
  `constructor`, `hasOwnProperty`, `isPrototypeOf`,
  `propertyIsEnumerable`, `toString`, `toLocaleString`, or `valueOf`.
  Defense applies at every payload-object boundary; throws
  `IDENTITY_FORBIDDEN_KEY`.
- **Public key wire format**: base64url-encoded, 1–2048 chars in
  `[A-Za-z0-9_-]`. Throws `IDENTITY_INVALID_PUBLIC_KEY`.
- **Digest reference wire format**: `<algorithm>:<base64url>` with
  algorithm in {`sha-256`, `sha-512`, `blake3`}. Throws
  `IDENTITY_INVALID_DIGEST`.
- **Epoch hygiene**: every `epoch` field must be a safe positive
  integer; non-positive or non-integer throws `IDENTITY_INVALID_NUMBER`.
- **Scope bounds**: 1–256 characters.
- **Payload size cap**: serialized JSON ≤ 16 KB; otherwise
  `IDENTITY_PAYLOAD_TOO_LARGE`. (Belt-and-suspenders: the envelope
  layer already caps the envelope size.)
- **Self-consistency cross-checks**:
  - `identity.device.rotated`: `newPublicKey !== previousPublicKey`
    (throws `IDENTITY_DEVICE_REUSE`).

## Lifecycle constraints (projection)

The projection (`applyIdentityControlEvent`) enforces what the pure
validator cannot — anything that depends on existing state:

- Every non-`controller.created` event MUST be signed by the
  controller key. A non-controller signer throws.
- `identity.controller.created` MAY only be applied once per state
  (`IDENTITY_DUPLICATE_CONTROLLER`).
- `identity.device.authorized` and `.revoked` and `.rotated` enforce
  monotonic `epoch` against `state.epoch`.
- `identity.device.rotated` additionally:
  - Throws `IDENTITY_DEVICE_NOT_FOUND` if the deviceId is unknown.
  - Throws `IDENTITY_LIFECYCLE_TRANSITION` if the device is not
    `active`.
  - Throws `IDENTITY_AUTHORITY_MISMATCH` if `previousPublicKey` does
    not match the stored key (this prevents a stale rotation event
    from rolling the key back to an earlier value).
- `identity.capability.revoked` is idempotent on a capability already
  revoked.

## Privacy stance

Identity events are private by nature: they carry an
account-controller key and a device public key. The PWA's existing
storage flow uses the `'self'` envelope privacy scope. Bridges and
super-peers MUST NOT decrypt identity events; identity-state mirroring
is the user's account-local sync only, end-to-end encrypted.

The contact-card digest is published as a public reference for the
account; the *contents* of the contact card live in
`@lfp2p/local-store`'s `contactProfiles` table and a downstream
contact-card document signed separately. The digest is the
audit-trail commitment, not the content.

## What this is NOT

This document does not prescribe:

- The MLS group key schedule (separate ADR).
- The capability delegation algebra (delegation-of-delegation is
  out of scope for v1; capabilities are direct from the controller).
- Account recovery (a separate slice — recovery requires a
  controller-key replacement flow that v1 does not define).
- Multi-controller accounts (v1 is single-controller; multi-controller
  remains future work).

## Implementation evidence

- Package: `packages/identity/src/`
- Modules: `errors.ts`, `validation.ts`, `control-log.ts`,
  `index.ts`.
- Fixtures: 7 valid + 6 invalid under `packages/identity/fixtures/`.
- 39 new Phase 2.1 tests in `phase-2.1.test.ts`.
- Exit report: `docs/implementation/phase-2.1-exit-report.md`.
