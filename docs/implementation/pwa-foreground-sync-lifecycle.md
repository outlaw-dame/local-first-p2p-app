# PWA foreground sync lifecycle

The PWA now has a foreground-only sync lifecycle boundary. This layer connects browser lifecycle signals to the existing `ForegroundSyncController` without introducing a bridge transport, endpoint configuration, credentials, or background execution claims.

## Current behavior

- Startup requests a foreground sync once the React shell mounts.
- Browser `online` events request a foreground sync.
- `visibilitychange` requests a foreground sync only when the document becomes visible.
- The manual UI button requests a foreground sync explicitly.
- The current `run` implementation only refreshes local identity, event summaries, and pending outbox counts from local storage.

## Safety boundaries

- No bridge network transport is wired here.
- No credentials, bearer tokens, cookies, bridge URLs, or remote endpoints are introduced.
- Browser lifecycle events are treated as foreground opportunities, not durable background guarantees.
- Offline state is checked through the controller and skips sync without mutating controller state.
- The UI renders formatted controller results rather than raw error objects.

## Not implemented in this slice

- Sending pending outbox entries to a bridge.
- Pulling inbound bridge records.
- Authenticated bridge endpoint configuration.
- Service worker background sync.
- Push-triggered sync.
- Full peer-to-peer relay, super-peer, or handoff behavior.

Those pieces require explicit auth/config boundaries and must remain separate from this foreground lifecycle wiring.
