# ADR-001: Identity Control Log v1 Model

- Status: Accepted
- Date: 2026-05-26
- Deciders: local-first-p2p-app maintainers
- Related docs:
  - docs/implementation/next-development-path.md
  - docs/implementation/known-deviations.md
  - docs/implementation/schema-and-storage-versioning.md
- Related PRs:

## Context

Current identity behavior is a local device bootstrap for the PWA vertical slice. The doctrine target requires account-level control through a root/controller identity, explicit device authority, revocation, and capability scoping. Without a decision record, future identity code may accidentally treat local bootstrap identity as canonical account identity.

## Decision

Adopt a root/controller identity model with an append-only identity control log.

1. The identity authority root is a controller key pair that defines account identity.
2. Device keys are delegated by controller-signed control events.
3. Capability grants are explicit log events bound to device keys, scopes, and expiration.
4. Revocation is explicit and monotonic through controller-signed revoke events.
5. Epoch/checkpoint values are part of control events and increase monotonically.
6. Local bootstrap device identity is treated as an adapter bootstrap path and must migrate into the control-log model once account identity is present.

## Scope

This decision applies to:

- protocol objects: identity control events and capability events,
- storage schemas: identity projection state and revocation checkpoints,
- runtime adapters: PWA, bridge, and future full-peer adapters,
- security/privacy boundaries: authority verification and revocation enforcement,
- tests/fixtures: valid and invalid control-log fixture sets.

This decision does not apply to:

- MLS group key schedules,
- payload encryption format details,
- naming proof protocols.

## Options considered

### Option A: Keep local device identity as canonical model

Pros:

- simple short-term implementation,
- no new protocol objects immediately.

Cons:

- no account-level authority separation,
- weak revocation model,
- difficult multi-device trust and recovery,
- high risk of protocol drift.

### Option B: Root/controller identity plus control log (chosen)

Pros:

- explicit authority graph,
- deterministic device authorization and revocation,
- compatible with future capability delegation and recovery,
- aligns with doctrine and full-peer compatibility goals.

Cons:

- additional protocol and projection complexity,
- requires migration planning from bootstrap identity state.

## Consequences

Positive consequences:

- identity expansion has a fixed authority model,
- capability and revocation behavior can be tested with fixtures,
- bridge and clients can validate authority without server trust.

Negative consequences / tradeoffs:

- new event types and validators are required before feature expansion,
- migration logic is required for existing local bootstrap identities.

## Security and privacy impact

- Private data affected: device-key bindings, capability grants, revocation history.
- Metadata exposed: delegation relationships and revocation timing metadata.
- New trust assumptions: controller key is the account authority root.
- Abuse/failure modes: stale revocation views, forged delegation events, replayed grants.
- Required tests:
  - reject unsigned or controller-mismatch control events,
  - reject non-monotonic epochs/checkpoints,
  - reject revoked device usage,
  - verify capability scope and expiry checks.

## Migration and compatibility

- Existing code affected: packages/identity, packages/protocol, packages/local-store.
- Storage migration needed: yes, identity projection tables/checkpoints are required.
- Fixture updates needed: yes, identity control event valid/invalid fixtures.
- Full-peer compatibility notes: full-peer and light-peer runtimes must consume the same control event objects.

## Exit criteria

This ADR is implemented when:

- [ ] Protocol identity control event schema is added.
- [ ] Capability grant/revoke event schema is added.
- [ ] Identity fixtures cover valid, invalid, replay, and revocation cases.
- [ ] Identity projection logic enforces monotonic checkpoints.
- [ ] Local bootstrap migration path is documented and tested.
