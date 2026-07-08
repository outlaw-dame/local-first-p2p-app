# Phase 5.12C bootstrap wrap publication exit report

Status: implementation slice complete.

## Scope

This slice wires the already-merged local wrap metadata publication helper into the PWA startup
path without depending on PR #169.

The goal is to make the current local device's public X25519 wrap metadata appear in the
identity-control projection once that projection is controller-known, so later sender-side
recipient resolution can discover this device from real synced identity data.

## Implemented

- `apps/pwa/src/pwa-wrap-metadata-bootstrap.ts`
  - Adds `ensurePwaLocalWrapMetadataPublished`.
  - Defers publication when the identity projection is missing or not controller-known.
  - Calls `ensureLocalDeviceWrapMetadataPublished` only when the projection is ready.
  - Returns status objects instead of throwing into app startup.
  - Preserves the previous projection snapshot on publication failure.

- `apps/pwa/src/root-app-bootstrap.tsx`
  - Adds a small `BootstrapRootApp` wrapper.
  - Runs the wrap-publication bootstrap from app startup.
  - Uses a short-lived store handle so `RootApp` store ownership remains unchanged.

- `apps/pwa/src/main.tsx`
  - Mounts `BootstrapRootApp` instead of `RootApp` directly.

- `apps/pwa/src/pwa-wrap-metadata-bootstrap.test.ts`
  - Covers first-run/not-ready deferral.
  - Covers publishing missing wrap metadata after the controller-known projection exists.
  - Covers already-published no-op behavior.
  - Covers fail-closed mismatch surfacing without widening trust.

## Safety properties

- The private wrap key is never published.
- Publication is attempted only after the identity projection is controller-known.
- Controller mismatch or projection/device mismatch does not crash the app shell.
- The bootstrap wrapper does not enable mailbox routing, foreground sweeps, or mailbox/chat send
  migration.
- The implementation is independent of PR #169 and does not touch its branch.

## Remaining work

- Merge the PR #169 sender replay fix once its formatting/CI issue is handled.
- After PR #169 lands, wire mailbox/chat send paths to the recipient resolver and sender helper.
- Enable app-shell mailbox routing and foreground sweep only after both inbound and outbound key
  resolution are wired and validated.

## Validation

Connector-only edit. Local `pnpm test`, `pnpm build`, `pnpm lint`, and `pnpm format:check` were
not run in this environment.
