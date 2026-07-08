# Phase 5.12D Recipient Resolution Exit Report

Status: Partial implementation
Date: 2026-07-07
Branch: `agent/recipient-resolution`

## Scope

This slice adds the app-facing sender-side helper that turns local identity-control projections
into deterministic `@lfp2p/envelope` recipients for `createEnvelopeEvent`.

It does not enable mailbox/chat sending yet. Sender enablement still depends on Phase 5.12C
publishing wrap-key metadata into identity/contact-card projections and Phase 5.12E wiring
mailbox/chat emit paths to the envelope builder.

## Implemented

- `apps/pwa/src/pwa-recipient-resolution.ts`
  - Resolves recipient devices from local identity projections.
  - Skips revoked devices.
  - Skips active devices that do not yet publish `wrapPublicKey` or `wrapKeyRef`.
  - Rejects duplicate identity projections.
  - Supports an exact identity allow-list chosen by caller/UI.
  - Requires controller-known projections by default.
  - Delegates final recipient validation and deterministic sort order to
    `@lfp2p/envelope.resolveRecipients`.

- `apps/pwa/src/pwa-recipient-resolution.test.ts`
  - Covers deterministic ordering.
  - Covers revoked and keyless-device filtering.
  - Covers caller-selected identity allow-list behavior.
  - Covers controller-known default requirement.
  - Covers duplicate projection rejection.

## Safety properties

- No revoked device is wrapped to.
- No active-but-keyless device is guessed or silently filled.
- No controller-unknown projection is used by default.
- No private key material is handled by this helper; it only consumes public wrap metadata.
- Recipient validation remains centralized in `@lfp2p/envelope`.

## Remaining work

- Phase 5.12C: publish `wrapPublicKey` and `wrapKeyRef` in the identity/contact-card projection
  so peer devices can be resolved from real synced data.
- Phase 5.12E-sender: call this resolver from mailbox/chat sending and pass the resolved
  recipients into `createEnvelopeEvent` / `createSignedEnvelopeEvent`.
- Enable app-shell mailbox routing and foreground sweep only after sender/recipient key
  resolution is fully wired.

## Validation

Connector-only edit. I inspected the branch diff against `master`; before adding this exit report
the branch was ahead by two commits with only the new helper and test files. Full local
`pnpm test` / `pnpm build` was not run in this environment because the container cannot resolve
GitHub to clone/install dependencies.
