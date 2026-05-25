# PWA outbox delivery dry-run planner

The PWA outbox delivery planner is a read-only observability boundary. It reports whether pending local outbox work exists and whether the bridge transport boundary is disabled, invalid, missing `fetch`, or prepared.

This slice does not enable delivery.

## What it does

- Accepts a pending outbox count snapshot.
- Reuses the guarded PWA bridge transport preparation boundary.
- Produces a deterministic status message for the UI.
- Keeps delivery explicitly disabled.
- Exposes only status fields, not a transport object.

## What it must not do

- It must not call `transport.send(...)`.
- It must not call `processOutboxBatch(...)`.
- It must not claim, update, or mutate local outbox entries.
- It must not register foreground, background, service worker, or push delivery hooks.
- It must not add credentials, authentication, cookies, or implicit network state.
- It must not send network requests while planning.

## UI contract

The PWA may display the planner output as read-only status, for example:

```text
3 pending outbox entries; bridge transport is prepared; delivery remains disabled.
```

This is observability only. A prepared transport means a future caller could explicitly use the transport boundary, not that delivery is active.

## Future requirements before delivery

Before real delivery is enabled, the project still needs separate slices for:

- dev-only manual delivery gating,
- explicit bridge authentication,
- client-side rate limits and delivery budgets,
- retry and backoff policy integration,
- safe terminal failure surfaces,
- foreground sync wiring guarded by single-flight and online checks.
