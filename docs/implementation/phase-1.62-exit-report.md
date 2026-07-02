# Phase Exit Report: Phase 1.62 — Local User Controls

- Status: Accepted as foundation-only / partial (see Decision)
- Date: 2026-05-31
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/trust-safety-event-policy.md`
- Related implementation docs:
  - `docs/implementation/trust-safety-phase-plan.md`
  - `docs/implementation/phase-1.61-exit-report.md`
- Related threat models:
  - `docs/threat-model/trust-safety-and-abuse.md`

## Phase scope

Phase 1.62 was meant to ship the seven local user-control event types plus deterministic projection state and a visibility selector — all _private by default_, all replayable from the event log on store reopen, none of them allowed to leak into bridge or public flows.

Per the plan, the deliverables were:

- Event kinds: `safety.account.blocked`, `safety.account.muted`, `safety.domain.blocked`, `safety.keyword.muted`, `safety.thread.muted`, `safety.post.hidden`, `safety.label.preference.set`.
- Projection tables: `blockedActors`, `mutedActors`, `blockedDomains`, `mutedKeywords`, `mutedThreads`, `hiddenPosts`, `safetyLabelPreferences`.
- Privacy doctrine: local controls private by default; mutes/hides/keyword filters/feed preferences/label preferences are not bridge analytics; blocks may affect transport but the private block graph does not become public.

Per the trust-safety phase plan's exit criteria, Phase 1.62 is foundation-complete when:

- local controls apply deterministically in local views,
- local controls survive store reopen and projection rebuild,
- private preference state is not sent to public sync / search / curation flows,
- tests cover malformed local-safety events and private/public leakage.

## Completed work

Added under `packages/trust-safety/src/local-controls/`:

- **`events.ts`** — `LocalControlEvent` discriminated union (7 kinds × `apply | revert` actions), pinned version `lfp2p.local-control-event.v1`, per-kind payload validators with bounded length / control-character / pattern checks. `assertLocalControlEnvelopeScope` enforces that the carrier envelope's privacy scope is one of `device-local` or `account-local` — every networked or public scope is rejected with `TS_PRIVATE_LEAK`. `safety.keyword.muted` only accepts `matchKind` of `substring` or `word`; user-supplied regexes are explicitly excluded as a ReDoS defense. `safety.label.preference.set` only accepts user-facing preference actions (`allow`, `warn`, `collapse`, `blur-media`, `hide`, `downrank`) — infrastructure actions like `reject-transport` or `escalate-review` are not user preferences and are rejected here.
- **`projection.ts`** — `LocalControlState` frozen snapshot with 7 keyed records and an `appliedEventIds` set for idempotency on replay. `createEmptyLocalControlState` for the empty state. `applyLocalControlEvent(state, event)` is deterministic, pure, validates the event before mutating, freezes the returned state, and is idempotent on `eventId`. `seedLocalControlState(events)` is the canonical store-rebuild path: replaying the same event log produces the same final state on every reopen. Records are constructed by spread-then-define so adversarial keys like `__proto__` land on a real own-property of a fresh object rather than altering the prototype chain.
- **`selector.ts`** — `decideVisibility(state, context)` returns the most restrictive applicable decision from `show | downrank | warn | blur-media | collapse | hide`. Decisions: blocked actor / blocked domain / hidden post id → `hide`; muted thread / muted actor `all` / muted keyword hit → `collapse`; muted actor `feed` / muted actor `replies` / muted actor `notifications` → `downrank`; label preference → mapped per `LabelPreferenceAction`. Keyword matching is implemented with a hand-rolled ASCII word-boundary scanner — **no user-supplied regex is ever compiled**, eliminating the ReDoS surface area.
- 8 valid + 6 invalid fixtures under `packages/trust-safety/fixtures/local-controls/`. Loader test asserts every documented fixture exists and is accepted/rejected as expected.
- 59 new tests across 4 test files: event validation per kind, scope guard (rejects every networked scope), projection happy paths, idempotency, apply/revert symmetry, store-reopen replay equivalence, prototype-pollution guard, selector decisions per signal, keyword substring vs word matching, literal-treatment of `.*` keywords (no regex compilation), label-preference mapping, most-restrictive combination.

No Dexie / local-store / PWA / bridge / sync-client coupling. The package boundary set in Phase 1.61 is preserved.

## Tests and verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 581 passing (196 in trust-safety, 59 of those new for 1.62)
pnpm build       # clean
```

Additional verification:

- Replay equivalence verified in `local-controls-projection.test.ts` via `seedLocalControlState(events)` and step-by-step `applyLocalControlEvent` producing equal snapshots.
- Idempotency verified by applying the same event twice and asserting the returned reference is identical (`expect(twice).toBe(once)`) — the projection short-circuits when `eventId` is already in `appliedEventIds`.
- ReDoS-safety verified by feeding `keyword: '.*'` into the selector and asserting it matches only the literal characters, not a regex.
- Prototype-pollution guard verified by issuing `targetActorId: '__proto__'` and asserting `Object.prototype.polluted` is unchanged.
- Privacy guard verified by enumerating every non-private `EnforcementScope` and asserting `TS_PRIVATE_LEAK` on each.

## Acceptance criteria

| Criterion                                                                     | Status | Evidence                                                                                                                        |
| ----------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------- |
| Local controls apply deterministically in local views                         |      ✓ | `applyLocalControlEvent` is pure, frozen, idempotent; `decideVisibility` is deterministic                                       |
| Local controls survive store reopen and projection rebuild                    |      ✓ | `seedLocalControlState` replay produces equal state on every call; tested explicitly                                            |
| Private preference state is not sent to public sync / search / curation flows |      ✓ | `assertLocalControlEnvelopeScope` rejects every networked scope; `PRIVATE_LOCAL_CONTROL_SCOPES = {device-local, account-local}` |
| Tests cover malformed local-safety events and private/public leakage          |      ✓ | 6 invalid fixtures + 14 explicit malformed-payload tests + 7-scope private-leak rejection test                                  |

## Security/privacy checks

- [x] No private plaintext in logs — package emits no logs.
- [x] Remote/untrusted input validation exists — every public entry uses `assertPlainObject` first; unknown kinds, unknown actions, unknown versions, and unknown enums fail closed.
- [x] Malicious/invalid input tests exist — ReDoS guard via no-regex-compilation, prototype-pollution guard, oversize length caps, control-character rejection in keywords and ids, URL-as-domain rejection.
- [x] Revocation/permission behavior — `revert` action removes entries deterministically and is idempotent like `apply`; reverting a never-applied entry is a safe no-op.
- [x] Derived state rebuild/delete behavior — `seedLocalControlState` is the rebuild path; deletion happens via `revert` events, not direct mutation.

## Deviations introduced or resolved

- The plan listed `safetyLabelPreferences` as a projection table. The implementation calls it `labelPreferences` and keys it by `${namespace}::${labelKey}` so a label and its namespace cannot be confused or shadowed. The shape is otherwise identical.
- The plan mentioned regex keyword matching as a possibility; this implementation excludes it on threat-model grounds (ReDoS). Adding regex later is an explicit ADR-level decision.
- The plan did not pin a label-preference action set. This implementation pins it to `LABEL_PREFERENCE_ACTIONS = ['allow', 'warn', 'collapse', 'blur-media', 'hide', 'downrank']` and rejects infrastructure actions there. A user cannot accidentally subscribe themselves to a `reject-transport` preference on a label.

## Phase 1.62.1 expansion (closing the cross-app portability and missing-control gaps)

After review the slice was extended to address every gap identified in the
Phase 1.62 review. Net additions:

- **5 new event kinds**: `safety.account.allowlisted` (visibility
  override), `safety.policy-list.subscribed` and `.unsubscribed`
  (subscription to external curation lists with trust level and allowed
  kinds), `safety.notification-preference.set` (per-channel
  preferences across mentions / replies / reactions / DMs from
  non-contacts / group invites / follows), `safety.preferences.snapshot`
  (canonical full-state event for cross-app bootstrap).
- **TTL on every applicable event**: optional `expiresAt`, validated
  not to precede `createdAt`. The selector takes a `now` parameter and
  skips expired entries — state remains pure. `pruneExpiredLocalControlState`
  is provided as an optional compaction step.
- **Semantic keyword filters**: `matchKind: 'semantic'` carrying
  `embeddingRef` (DigestRef), `embeddingModel` identifier, and optional
  `similarityThreshold ∈ [0, 1]`. The selector accepts a
  `semanticMatch?: SemanticKeywordMatcher` callback so the package
  stays ML-free; semantic entries without a host matcher are silently
  skipped, and host-matcher errors are contained.
- **Allowlist semantics**: allowlisted actors are not suppressed by
  non-hard-safety labels (`SelectorLabelHit.hardSafety` controls
  bypass). Hard-safety labels still apply. User blocks and user mutes
  still apply to allowlisted actors — the user actively chose those.
- **Cross-app portability**: `exportPreferencesSnapshot` /
  `importPreferencesSnapshot` plus `validateLocalControlSnapshot`
  (fail-closed on unknown schema). Three merge strategies: `union`
  (default, preserve local), `replace` (hard reset), `merge-newer-wins`
  (per-entry `since` comparison). `assertSnapshotIsNotStale` refuses to
  roll backward in time. `appliedEventIds` is preserved across import
  so events that arrive twice (via log + snapshot) do not double-apply.
  Doctrine doc: `docs/protocol/local-controls-portability.md`.
- **Notification preferences**: stored per channel; selector returns
  `collapse` for `mute`, `show` for `allow`.
- **Policy-list subscriptions**: recorded with `issuerActorId`,
  `allowedKinds`, and `trustLevel`. Actual list resolution belongs to
  Phase 1.63 / 1.64 — this slice only records the subscription.

41 new tests across `local-controls-expansion.test.ts` cover TTL
expiry, TTL not-yet-expired, pruning, allowlist vs label, allowlist vs
hard-safety, allowlist vs user-block (block wins), allowlist vs
keyword (keyword wins), expired allowlist, semantic matcher injection,
semantic matcher containment on throw, embedding-field-mixing
rejection, similarity-threshold bounds, notification preference apply
and revert, policy-list subscribe and unsubscribe, snapshot
round-trip, snapshot union/replace/newer-wins merges, snapshot stale
rejection, and snapshot-event-direct-apply rejection.

Total monorepo: 622 tests pass. Lint / typecheck / build clean.

## Remaining gaps

Out of scope for Phase 1.62.1, tracked for downstream work:

- Dexie projection persistence layer: a `localControlEvents` table + an atomic `applyLocalControlEvent` hook on the local store. Belongs to the local-store package.
- PWA UI integration: a settings surface that lets a user emit `apply`/`revert` events for each kind, plus per-app applicability indicators (this app supports filter X, this app does not).
- Account-local sync envelope wiring: account-local encryption (ADR-002) and the per-user subscribe-to-own-stream mechanism in `@lfp2p/sync-client`. The portability snapshot is content-ready but cannot move between apps until that wire format exists.
- Bridge-side enforcement of `safety.account.blocked` for multi-device delivery: Phase 1.64.
- Phase 1.63 (reports/appeals with encrypted evidence) and Phase 1.65 (curation runtime) consume `LocalControlState` indirectly via the selector; explicit integration tests will be added there.
- Host-side semantic embedding pipeline: the selector calls the host's matcher; an actual sentence-embedding model + wasm/onnx loader + cosine similarity comparison is a PWA/host concern, deliberately out of this package.
- Policy-list resolution runtime: the subscription is recorded, but actually fetching the external list and applying its entries belongs to Phase 1.64 (transport) and Phase 1.63 (trust-policy decision engine).

## Decision

This phase is:

- [ ] accepted as complete,
- [x] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason:

Phase 1.62's plan deliverables are met: the seven event kinds exist with their payloads validated, the projection is deterministic and replayable, the visibility selector returns most-restrictive decisions, the privacy boundary is enforced structurally, and 196 trust-safety tests (59 new for 1.62) pass alongside the rest of the monorepo (581 total). The package boundary set in Phase 1.61 is preserved (no Dexie, no UI, no bridge runtime coupling).

The phase is marked **foundation-only / partial** rather than fully Complete because Dexie persistence and PWA UI wiring are intentionally deferred to local-store and PWA slices respectively. Calling this "Complete" would overstate the integration; "foundation-only" matches the plan and the doctrine.
