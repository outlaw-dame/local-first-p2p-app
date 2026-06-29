# Device Model

- Status: Draft
- Specification series: 2
- Specification version: 0.x
- Scope: authorized devices and multi-device authority
- Profiles: Core, Messaging, Social, Offline, Security
- Related:
  - `docs/specification/02-identity/identity-root.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines devices as authorized protocol actors under an Identity Root.

A device can sign, store, decrypt, project, synchronize, or deliver protocol records only within the authority granted to it.

## Requirements

- A Device MUST be authorized by valid Identity Root / Controller authority before it can produce accepted authority-sensitive writes.
- A Device MUST NOT act outside its granted scope.
- Device authorization MUST be portable across providers and transports.
- Device revocation MUST be represented as authority-layer state, not provider-local state.
- Implementations MUST NOT treat possession of a mailbox, provider session, transport connection, push token, or local database as device authority.

## Device roles

A future stable profile may distinguish:

- primary user device;
- secondary user device;
- recovery device/share holder;
- read-only device;
- limited-scope device;
- space-admin device;
- provider/operator device;
- temporary session device.

Role names are informative until a later specification defines normative fields and capabilities.

## Authorization

Device authorization records SHOULD include:

- Identity Root reference;
- device identifier;
- public signing key or verification material;
- granted scopes;
- creation time or sequence marker;
- expiration, if any;
- issuer/controller proof;
- consistency class;
- revocation handling rules.

A device authorization record MUST be validated before device-produced authority-sensitive writes are accepted.

## Revocation

Device revocation is security-sensitive authority state.

Revocation MUST NOT be implemented as generic LWW state.

Revocation SHOULD be monotonic or lifecycle-based according to the relevant consistency class.

After a valid revocation is known and applicable, implementations MUST NOT accept new authority-sensitive writes from the revoked device.

## Device rotation

Device rotation SHOULD allow replacement of compromised, lost, or upgraded devices without changing the user's Identity Root.

Rotation flows SHOULD preserve:

- identity continuity;
- capability clarity;
- old-device revocation;
- replay protection;
- auditability;
- low-bandwidth sync priority for revocation state.

## Multi-device consistency

A user may have multiple authorized devices.

The intended model is:

```txt
Identity Root
  ↓
Authorized devices
  ↓
Per-device local replicas
  ↓
Signed records
  ↓
Selective sync
  ↓
Deterministic projection
  ↓
Converged user state
```

Devices SHOULD converge through signed records and deterministic projections, not through a single master server.

## Device vs Replica

A Device is an authorized actor.

A Replica is a copy of data.

A device may hold one or more replicas. A replica may exist on a device, provider, mailbox, super-peer, portable sync drop, or local store.

A replica MUST NOT be treated as a device merely because it contains data.

## Device vs Provider Session

Provider login, HTTP session, app-view session, push token, or mailbox credential MUST NOT be treated as protocol device authority unless bound to a valid device authorization record.

## Validation

Before accepting a device-signed authority-sensitive record, implementations MUST validate:

- device authorization;
- signer key binding;
- revocation state;
- granted scope;
- record type permission;
- applicable key epoch;
- consistency class;
- replay/idempotency behavior.

## Low-bandwidth behavior

Device authorization and revocation records SHOULD be prioritized over ordinary social content.

A low-bandwidth peer SHOULD be able to learn enough device state to reject revoked or unauthorized writes before applying dependent records.

## Security considerations

Device compromise is expected.

The protocol SHOULD support:

- revocation;
- rotation;
- scoped devices;
- recovery devices or shares;
- audit trails;
- safe degraded behavior when latest revocation state is unavailable.

Implementations SHOULD make stale device state visible to the user or application when it affects safety-sensitive decisions.

## Open questions

- Initial device identifier format.
- Required device scopes for Core Profile.
- Whether ordinary user devices can delegate limited capabilities in the first stable profile.
- How to present stale revocation state in offline mode.
