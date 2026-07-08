# Phase 5.12C — Local wrap metadata publication exit report

Status: **Partial implementation**
Date: 2026-07-08
Branch: `agent/phase-512e-envelope-sender`

## Scope

This slice bridges the gap between local device-session wrap keys and identity-control projection publication.

Earlier Phase 5.12C work made `identity.device.authorized` carry `wrapPublicKey` / `wrapKeyRef`, and PR #166 added the raw PWA emit helper. This slice adds an idempotent helper that can be called from app/bootstrap foreground paths to ensure the current local device's public wrap metadata is actually present in the projection.

It intentionally does **not** enable mailbox routing or convert mailbox/chat sends to encrypted envelope events yet.

## Implemented

- `apps/pwa/src/pwa-identity-emit.ts`
  - Adds `ensureLocalDeviceWrapMetadataPublished`.
  - Checks the current identity-control projection for the local session's device.
  - No-ops when the active projection already advertises the local session's wrap metadata.
  - Emits a controller-signed `identity.device.authorized` refresh at `epoch + 1` when metadata is missing or stale.
  - Fails closed when the controller keypair does not match the projection controller.
  - Fails closed when the local device is missing, revoked, or has a mismatched signing public key.

- `apps/pwa/src/pwa-identity-emit.test.ts`
  - Covers publishing missing local wrap metadata.
  - Covers the already-published no-op path.
  - Covers non-controller signer rejection.

## Safety properties

- Only the public X25519 wrap key and stable wrap-key reference are published.
- The private wrap key remains local-only.
- A controller-known projection is required before publication.
- Publication is signed by the identity controller and uses the next monotonic epoch.
- The helper refuses to publish if the local session does not match the active projection device.

## Remaining work

- Wire the PWA/bootstrap path to call `ensureLocalDeviceWrapMetadataPublished` after `DeviceIdentityManager.getOrCreatePrimaryDeviceSession` and identity projection load.
- Phase 5.12E-sender: use Phase 5.12D recipient resolution from synced peer projections and pass resolved recipients into `createEnvelopeEvent` / `createSignedEnvelopeEvent`.
- Enable app-shell mailbox routing and foreground sweep only after sender/recipient key resolution is fully wired.

## Validation

Connector-only edit. Full local `pnpm test` / `pnpm build` was not run in this environment.
