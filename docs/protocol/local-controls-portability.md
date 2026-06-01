# Local Controls Portability — Doctrine

- Status: Draft
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related implementation docs:
  - `docs/implementation/trust-safety-phase-plan.md`
  - `docs/implementation/phase-1.62-exit-report.md`
- Package: `@lfp2p/trust-safety/local-controls`

## The problem

In Nostr, the user identity is the constant. The user's moderation,
curation, and notification preferences are not. Every new client a user
signs into starts from a blank slate; the user re-blocks, re-mutes,
re-configures keyword filters, re-subscribes to community block lists,
re-tunes label preferences. Two users on the same identity but two
different clients see different feeds.

This is not a Nostr-specific problem. Any protocol that treats identity
and preference state as belonging to different layers will reproduce it.

This document records the doctrine for solving it inside the local-first
p2p architecture without leaking those preferences to public flows.

## Decision

User moderation and curation preferences are represented as **signed
account-local events** in the same envelope format as every other durable
event in this architecture, with the same identity-control authority.
Any app a user signs into as the same controller identity can subscribe
to their account-local sync and replay those events to reconstruct the
preferences locally.

The runtime answer ships in `@lfp2p/trust-safety/local-controls` as:

- A discriminated union of 12 event kinds (`LocalControlEvent`) covering
  blocks, mutes, allowlist, hidden posts, muted threads, keyword filters
  (text and semantic), label preferences, notification preferences, and
  policy-list subscriptions.
- A pure projection (`LocalControlState`, `applyLocalControlEvent`,
  `seedLocalControlState`) that any app can build deterministically from
  the same event log.
- A pure selector (`decideVisibility`) that any app can call to apply
  the preferences to a candidate post / actor / thread / notification.
- A canonical snapshot (`exportPreferencesSnapshot` /
  `importPreferencesSnapshot` / `safety.preferences.snapshot` event) for
  apps that join the account late and do not have the full event log.

## Privacy boundary (non-negotiable)

- `LocalControlEvent` envelopes **MUST** use privacy scope
  `device-local` or `account-local`. Any other scope is rejected at
  validation time by `assertLocalControlEnvelopeScope` with
  `TS_PRIVATE_LEAK`.
- `device-local` events do not sync across the user's other apps. They
  are a single device's local UI state.
- `account-local` events sync to the user's other apps over the user's
  own private sync surface and **must not** be readable by bridges,
  relays, super-peers, public indexes, labelers the user has not
  explicitly authorized, or any networked third party.
- The user's private block graph is therefore not public by default.
  Blocks may still produce transport-side consequences at the bridge or
  relay surface — see Phase 1.64 — but those consequences are
  infrastructure-scoped, not announcements.
- Reports, evidence bundles, and any other sensitive material in this
  family are encrypted at the envelope layer per ADR-002.

## Cross-app contract (SHOULD / MUST)

Every app in this architecture that consumes a user's account-local
sync MUST follow these rules:

1. **Apply the kinds you can interpret.** A chat-only app may safely
   apply blocks, mutes, allowlist, keyword filters, label preferences,
   and notification preferences. A feed app additionally applies
   curation hits.
2. **Ignore the kinds you cannot interpret.** A chat-only app that has
   no concept of `recommendation-exclude` MUST NOT discard, rewrite, or
   "translate" that preference — it MUST leave the event intact in the
   shared log so the user's other apps can apply it.
3. **Never publish them.** Apps MUST NOT re-broadcast local-control
   events at non-private scope. Apps MUST NOT include local-control
   state in public profiles, analytics, telemetry, or recommendation
   inputs.
4. **Hard safety wins.** Apps MUST NOT silently downgrade hard-safety
   labels (e.g. `media-safety.csam`) just because the user has
   allowlisted the producer. `decideVisibility` enforces this when the
   host passes `hardSafety: true` on the matching `SelectorLabelHit`.
5. **Fail closed on unknown versions.** Apps MUST refuse to apply a
   `safety.preferences.snapshot` whose `schema` field is not in the set
   they understand. `validateLocalControlSnapshot` already enforces
   this for the current schema.
6. **Refuse stale snapshots by default.** A snapshot whose `capturedAt`
   is older than the currently applied snapshot SHOULD NOT be applied
   without explicit user intent. `assertSnapshotIsNotStale` is provided
   for callers that want this guard.
7. **Preserve event idempotency across apps.** Apps SHOULD preserve
   `appliedEventIds` across snapshot import so an event that arrives
   twice — once via the event log and once embedded in a snapshot —
   does not double-apply. The default `preserveAppliedEventIds: true`
   option does this.

## How the snapshot solves the bootstrap problem

A new app signed into the same controller identity joins the user's
`account-local` sync. It receives at minimum:

- the most recent `safety.preferences.snapshot` event, and
- every `LocalControlEvent` newer than the snapshot's
  `includesUpThroughEventId`.

The app:

1. Validates the snapshot's schema. Unknown schema → refuse.
2. Calls `importPreferencesSnapshot(empty, snapshot)`. Default merge
   strategy is `union`, so any device-local-only state already present
   on this device is preserved.
3. Replays the post-snapshot events with `applyLocalControlEvent` in
   order. Replay is idempotent on `eventId`.
4. The user's preferences are now in effect on the new app without any
   reconfiguration.

When the user changes a preference on any app, that app emits a fresh
`LocalControlEvent` at `account-local` scope. The event reaches every
other app on the next sync.

When state grows large enough that replaying from snapshot+events is
expensive, any app may emit a fresh `safety.preferences.snapshot` that
captures everything up to its current `appliedEventIds` and supersedes
the older snapshot.

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| A relay learns the user's private block graph | Block events are `account-local`-scoped; the user's account-local sync must be end-to-end encrypted before transit. Bridges/relays without the user's key cannot read them. |
| A malicious app on the user's device reads block list and exfiltrates | Out of scope for the protocol; app sandboxing is the OS's job. The protocol still wins by removing the "I never blocked them in the first place" excuse: the user can audit by listing `LocalControlEvent`s in their store. |
| A malicious snapshot from an attacker fakes a "clear all blocks" state | Snapshots must be in a signed envelope from the user's own controller identity. Apps refuse snapshots not authored by the user. (The protocol layer in `@lfp2p/protocol` enforces signature verification; this package validates the payload shape.) |
| An older snapshot replayed via stale sync would erase newer state | `assertSnapshotIsNotStale` + default `union` merge keep newer state. `replace` strategy is opt-in and surfaced to users. |
| A misconfigured app rewrites `safety.account.blocked` into a non-private scope | Validation at the envelope layer (`assertLocalControlEnvelopeScope`) fails closed with `TS_PRIVATE_LEAK`. Bridges that receive such an event drop it. |
| A user-supplied regex in a keyword filter causes ReDoS | `matchKind` enum does not include `regex`; `semantic` requires a precomputed embedding ref so no regex is ever compiled. |
| An ML model identifier mismatch causes silent semantic-mismatch | Semantic entries carry `embeddingModel`; hosts compare against their own loaded model and refuse to apply mismatched entries. The selector hands the entry to the host matcher; if the matcher returns false (including on model mismatch), no decision is taken. |

## What this is NOT

This document does not prescribe:

- the wire format of account-local sync (that lives in `@lfp2p/sync-client`),
- the encryption envelope (that lives in ADR-002),
- how an app surfaces preferences to the user (that's product),
- a global block list, a social trust graph, or any other public
  enforcement mechanism — those are not the user's preferences.

## Implementation evidence

- Package: `packages/trust-safety/src/local-controls/`
- 622 tests pass across the monorepo (243 in trust-safety, ~80 of which
  exercise the local-controls slice directly).
- 15 valid + 11 invalid fixtures including TTL, allowlist, semantic
  match, policy-list subscription, notification preference, and full
  snapshot.
- Exit report: `docs/implementation/phase-1.62-exit-report.md`.
