# Phase 5.12C — Wrap-key publication exit report

Status: **Partial implementation**
Date: 2026-07-07
Branch: `agent/wrap-key-publication`

## Scope

This slice publishes sender-visible wrap-key metadata through the identity-control device projection. It is the protocol/projection half of Phase 5.12C: `identity.device.authorized` can now carry an active device's `wrapPublicKey` and stable `wrapKeyRef`, and the projection retains those fields for Phase 5.12D recipient resolution.

The slice intentionally does not enable mailbox/chat sending. The sender path still needs to resolve peer projections and pass recipients to `createEnvelopeEvent` / `createSignedEnvelopeEvent`.

## Implemented

- `packages/identity/src/control-log.ts`
  - Adds optional `wrapPublicKey` / `wrapKeyRef` to `IdentityControlDevice`.
  - Retains wrap metadata when applying `identity.device.authorized`.
  - Enforces all-or-nothing publication: both fields must be present together or both absent.
  - Preserves wrap metadata when a device is later revoked so audit/projection replay remains stable while recipient resolution skips the revoked device.

- `packages/identity/src/validation.ts`
  - Extends `ValidatedIdentityEvent` for `identity.device.authorized` with optional wrap metadata.
  - Validates `wrapPublicKey` with the existing public-key wire-format guard.
  - Validates `wrapKeyRef` as a non-empty id.
  - Rejects half-published wrap metadata before projection mutation.

- `packages/identity/src/control-log-wrap-metadata.test.ts`
  - Covers projection of wrap metadata.
  - Covers preservation through revocation.
  - Covers half-published metadata rejection.
  - Covers malformed wrap public key rejection.

## Safety properties

- Only public wrap metadata is published; private wrap keys remain local-only and encrypted at rest by Phase 5.12B.
- Half-published metadata is rejected so senders cannot wrap to a public key with no stable key reference or to a key reference with no public key.
- Revoked devices can remain auditable while Phase 5.12D recipient resolution continues to exclude them.
- This does not weaken E2EE: it only gives senders enough public metadata to wrap per-event content keys to active peer devices.

## Remaining work

- Wire the local device-authorized emission path to include the current device session's `wrap.keypair.publicKey` and `wrap.keyRef` when authorizing/publishing device state.
- Ensure any contact-card serialization that includes device rows carries the same public wrap metadata.
- Phase 5.12E-sender: use Phase 5.12D recipient resolution in mailbox/chat send paths and pass the resolved recipients to `createEnvelopeEvent`.
- Enable app-shell mailbox routing and foreground sweep only after sender/recipient key resolution is fully wired.

## Validation

Connector-only edit. Full local `pnpm test` / `pnpm build` was not run in this environment.
