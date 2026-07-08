# Phase 5.12C — Device wrap metadata emission exit report

Status: **Partial implementation**
Date: 2026-07-07
Branch: `agent/phase-512e-sender-wiring`

## Scope

This follow-up completes the local emission side of Phase 5.12C: the PWA can now emit `identity.device.authorized` events that include the current device's public wrap metadata.

PR #164 made the protocol and projection accept `wrapPublicKey` / `wrapKeyRef`; this slice exposes the PWA helper that actually publishes those fields through the locally-emitted identity path.

## Implemented

- `apps/pwa/src/pwa-identity-emit.ts`
  - Adds `EmitDeviceAuthorizedInput`.
  - Adds `emitDeviceAuthorizedEvent`.
  - Supports optional `wrapPublicKey` / `wrapKeyRef` publication.
  - Rejects half-published wrap metadata before signing.
  - Keeps private wrap keys out of identity events and logs.

- `apps/pwa/src/pwa-identity-emit.test.ts`
  - Covers authorizing a device with wrap metadata.
  - Verifies the projection stores `wrapPublicKey` / `wrapKeyRef`.
  - Covers half-published metadata rejection at the PWA boundary.

## Safety properties

- Only public wrap metadata is emitted.
- The private X25519 wrap key remains local-only.
- The controller still signs `identity.device.authorized`; callers cannot self-authorize devices without controller authority.
- The projection lifecycle still enforces monotonic epochs.

## Remaining work

- Wire the actual device-session bootstrap/contact-card publication path to call this helper using `LocalDeviceSession.wrap.keypair.publicKey` and `LocalDeviceSession.wrap.keyRef`.
- Phase 5.12E-sender: use resolved peer recipient devices from Phase 5.12D to build mailbox/chat encrypted envelope events through `createEnvelopeEvent` / `createSignedEnvelopeEvent`.
- Enable app-shell mailbox routing and foreground sweep only after sender/recipient key resolution is fully wired.

## Validation

Connector-only edit. Full local `pnpm test` / `pnpm build` was not run in this environment.
