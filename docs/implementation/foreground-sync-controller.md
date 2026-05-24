# Foreground sync controller

Status: implemented as a first lifecycle-safe sync orchestration primitive.

## Purpose

`ForegroundSyncController` gives the PWA and other light-peer clients a small, browser-honest way to request sync work from foreground lifecycle events without assuming reliable background execution.

It does not perform transport I/O by itself. Callers provide the actual `run` function, which can compose existing sync-client primitives such as outbox processing, inbound HTTP pulls, and inbound batch application.

## Contract

The controller accepts sync requests from explicit foreground triggers:

- `startup`
- `manual`
- `online`
- `visible`
- `timer`

For each request, it decides whether to run or skip before invoking caller-provided sync work.

The controller enforces:

- single-flight execution so overlapping lifecycle events do not start duplicate sync loops,
- online gating through a caller-provided `isOnline` function,
- exponential backoff with bounded jitter after failures,
- manual backoff bypass for user-initiated retry actions,
- structured status snapshots for UI-safe sync health displays.

## Failure behavior

Run failures are captured into a failed result and reflected in controller state. The controller does not throw for normal sync-run failures; this lets UI code render a stable status without crashing the app shell.

The next retry time is computed using the same bounded backoff helper used by outbox processing. This keeps retry behavior consistent across sync layers.

Offline and backoff skips do not mutate failure counters. Already-running skips also avoid mutation and prevent duplicate transport calls.

## Browser boundaries

This is intentionally a foreground controller, not a service worker daemon. Browsers can pause tabs, throttle timers, and restrict background work, especially on mobile platforms. Future PWA integration should treat this controller as a foreground/resume/manual/online trigger coordinator, not as a guarantee that sync happens while the app is closed.

## Current boundaries

This slice does not yet provide:

- real bridge endpoint configuration,
- authenticated bridge transport setup,
- automatic PWA event-listener wiring,
- service-worker background sync,
- multi-source fan-out,
- encrypted mailbox authorization,
- user-visible sync settings.

Those belong in later orchestration and product slices.