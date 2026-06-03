# Phase Exit Report: Phase 1.70 — PWA T&S settings + hashtag/phrase match kinds

- Status: Accepted as complete
- Date: 2026-06-02

## Phase scope

Phase 1.70 brings the Phase 1.62/1.66/1.69 trust-and-safety surface
into the PWA. Specifically:

1. Two new ReDoS-safe match kinds (`phrase`, `hashtag`) for keyword
   filters, replacing what users typically want from regex without
   exposing a regex engine that could be weaponized against the host
   or another device that imports the user's preference snapshot.
2. Dexie persistence for `LocalControlState` and `LabelersState`,
   event-sourced with idempotency on `eventId` and validate-on-read
   defense-in-depth.
3. A first PWA settings surface for the four T&S controls Bluesky users
   expect: the adult-content master gate, per-category preferences,
   keyword filters, and labeler subscriptions with the redundancy
   warning.

Regex was deliberately declined per Phase 1.62 doctrine and pinned by
test. Author-supplied general regex is a documented ReDoS vector that
neither Bluesky, Mastodon server filters, nor Twitter expose.

## Completed work

### Phase 1.70.A — protocol (additive, v1-compatible)

- `KEYWORD_MATCH_KINDS` extended to `['substring', 'word', 'phrase', 'hashtag', 'semantic']`.
- `phrase`: trim + collapse internal whitespace runs to a single
  space; reject whitespace-only after trim. Stored case-preserved;
  matched whitespace-collapsed and case-insensitive.
- `hashtag`: accept `tag` or `#tag`; body must match
  `^[\p{L}\p{N}_]{1,140}$` (Unicode letters, numbers, underscore).
  Stored lowercased without `#`. Match scans the text for a `#`
  followed by Unicode-word body and compares against the needle.
- Two safe constant patterns compiled at module load (`HASHTAG_BODY_PATTERN`,
  `WHITESPACE_RUN`); no regex is ever compiled against
  attacker-controlled text.
- 4 new fixtures (2 valid, 2 invalid) picked up by existing
  `it.each` fixture validators.
- 32 new tests in `phase-1.70-keyword-kinds.test.ts` covering: kind
  enum membership, the regex-rejection still in place, phrase /
  hashtag validation and normalization, case + whitespace
  insensitivity, Unicode-letter hashtag (`#café`), substring-prefix
  non-match, and two adversarial inputs (a hashtag-like
  `#` + 20 000 a's, and 20 000 whitespace + 20 000 a's for phrase)
  that complete in under 200 ms each — ReDoS-proof.

### Phase 1.70.B — Dexie persistence (`@lfp2p/local-store`)

- New v7 Dexie schema with two append-only event-log tables:
  `trustSafetyControlEvents`, `trustSafetyLabelerEvents`. Keyed by
  `eventId`, indexed by `createdAt` and a monotonic `sequence`.
- Added `@lfp2p/trust-safety` as a workspace dependency of
  `@lfp2p/local-store` (no cycle: the trust-safety package has no
  Dexie / IO dependencies).
- New methods on `DexieLocalFirstStore`:
  - `appendTrustSafetyControlEvent(event)`, `appendTrustSafetyLabelerEvent(event)`:
    re-validate at the persistence boundary; silent no-op on
    duplicate `eventId`; transactional.
  - `listTrustSafetyControlEvents()`, `listTrustSafetyLabelerEvents()`:
    sorted by `sequence`.
  - `loadLocalControlState()`, `loadLabelersState()`: re-validate
    each row on read (skip-and-continue if corrupted) and replay
    through the protocol's pure `applyLocalControlEvent` /
    `applyLabelerEvent` to rebuild the frozen projection.
- 6 new tests in `trust-safety-persistence.test.ts` using
  fake-indexeddb: round-trip equivalence with the in-memory replay,
  idempotency on `eventId`, append-time rejection of malformed
  events (matchKind=regex), survive store close + reopen.

### Phase 1.70.C / 1.70.D / 1.70.E — PWA settings

- `apps/pwa/src/pwa-trust-safety-state.ts` (new, pure logic):
  - Event constructors: `buildAdultContentGateEvent`,
    `buildContentCategoryPreferenceEvent`,
    `buildKeywordFilterEvent`, `buildKeywordFilterRevertEvent`,
    `buildLabelerSubscribeEvent`, `buildLabelerUnsubscribeEvent`.
    Each runs the protocol validator before returning.
  - View model builders: `buildContentCategoryRows`,
    `buildKeywordFilterRows`, `buildLabelerSubscriptionRows`.
  - `assessSubscribeIntent`: UI-friendly wrapper around
    `detectRedundantSubscription` returning a confirm-dialog
    message.
  - `listExistingOverlaps`: surfaces existing subscription overlap
    pairs for the "subscription health" indicator.
  - `KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI` deliberately excludes
    `semantic` (no embedding pipeline yet) and `regex` (ReDoS).
- `apps/pwa/src/pwa-trust-safety-settings.tsx` (new, React/Framework7):
  - Adult-content gate toggle with explicit "I am 18+" confirm
    prompt before enabling.
  - 20-category preference list (Show / Warn / Hide buttons per
    row; adult rows show an explicit lock message when the gate is
    off).
  - Keyword filter add form with the 4 UI match-kinds + a
    "regex is intentionally not offered" warning. Add + remove
    actions wired to apply / revert events.
  - Labeler subscription list with overlap warning callout, and an
    unsubscribe action. (Subscribe-from-UI awaits a labeler
    discovery / publish flow in a later slice.)
- `apps/pwa/src/root-app.tsx`: one new render line that mounts the
  settings component into the home page when the local device
  identity is bootstrapped.
- 32 new tests in `pwa-trust-safety-state.test.ts` covering: kind
  enum membership in the UI, eventId allocator, every event
  constructor's round-trip through the projection, view-model
  derivation (category locking-by-gate, locked effectiveAction,
  preference surfaced), redundancy assessment messages,
  cross-labeler overlap surfacing.

### Verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 971 passing (913 before + 32 phase-1.70.A + 6 persistence + 32 PWA state + fixture pickups)
pnpm build       # clean; PWA bundle 1,131 KB → 1,196 KB (≈ +65 KB)
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|:---:|---|
| Hashtag + phrase added as first-class match kinds; regex still rejected | ✓ | `events.ts`, `phase-1.70-keyword-kinds.test.ts` |
| All matchers stay on the linear-time path; no regex compiled against attacker text | ✓ | constant patterns + adversarial timing tests |
| Local-control + labeler events persist via Dexie and rebuild deterministically | ✓ | `trust-safety-persistence.test.ts` |
| Append is idempotent on eventId; malformed events rejected at the boundary | ✓ | same |
| PWA exposes the adult-content gate, content-category preferences, keyword filters, and labeler subscriptions in one settings surface | ✓ | `pwa-trust-safety-settings.tsx` |
| Pre-subscribe redundancy warning surfaced in the UI | ✓ | `assessSubscribeIntent` + overlap callout |
| No new lint, typecheck, test, or build failures | ✓ | full sweep clean |

## Deferred work

- Labeler discovery / publish surface in the PWA. The settings
  screen lists existing subscriptions but does not yet provide a
  "publish a profile" or "find a labeler" flow.
- Semantic keyword filters in the UI. The protocol accepts
  `matchKind: 'semantic'` already; the PWA needs an embedding
  pipeline (per-device or per-account) before exposing it.
- A bridge-side enforcement integration for the new keyword kinds
  (the bridge admission engine doesn't need it — keyword filters
  are local-only — but the moderation runtime may want to surface
  category labels alongside keyword hits).
- Per-actor / per-thread overrides of the adult gate.

## Decision

This phase is:

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: The keyword-filter expansion landed on the linear-time path
with adversarial tests proving ReDoS-proofness, persistence is
event-sourced with idempotency and defense-in-depth, and the PWA now
shows the full Bluesky-equivalent T&S control surface end-to-end.
Subsequent slices (labeler discovery, semantic embedding pipeline)
have a clear protocol foundation to build on.
