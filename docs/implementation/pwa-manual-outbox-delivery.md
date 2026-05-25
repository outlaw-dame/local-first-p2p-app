# PWA manual outbox delivery gate

The PWA manual outbox delivery gate is a development-only, explicit-click delivery path. It is intended to validate the existing outbox processing pipeline without enabling automatic sync.

## Required gates

Manual delivery only runs when all of these are true:

- Vite dev mode is active through `import.meta.env.DEV === true` or `MODE=development`.
- `VITE_LFP2P_MANUAL_OUTBOX_DELIVERY_ENABLED=true` is set.
- The bridge config boundary is valid and transport preparation succeeds.
- The user explicitly clicks the manual delivery button.
- The requested batch size is a positive safe integer no greater than `5`.

The PWA UI currently calls the manual gate with a batch size of `1`.

## Safety boundaries

This slice does not add automatic delivery. It does not attach delivery to startup, online events, visibility changes, foreground sync, service workers, background sync, push, or timers.

The UI action is single-flight guarded so repeated taps cannot overlap delivery attempts. The button is disabled when the gate is closed, there are no pending entries, or a manual attempt is already running.

## Still missing before production delivery

Before automatic or production delivery is enabled, the project still needs:

- explicit bridge authentication,
- client delivery budgets and rate limits,
- production-safe auth token handling,
- stronger operator/error visibility,
- foreground sync delivery integration with single-flight and online checks,
- clear retry-budget and terminal failure surfaces.
