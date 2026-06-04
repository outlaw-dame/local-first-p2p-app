# Phase Exit Report: Phase 1.71 — Block-evasion hardening pack

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

Phase 1.71 is the block-evasion hardening slice that surfaced during
the "how does our system handle block evasion?" review. It addresses
two concrete gaps in the existing T&S stack:

1. The Phase 1.70.A keyword matchers were literal-character. A
   determined adversary could evade them with leet substitution
   (`sp0iler`), zero-width spaces, Cyrillic homoglyphs (`ѕpoiler`),
   full-width Unicode (`ＳＰＯＩＬＥＲ`), or combining diacritics
   (`spoîler`).
2. The Phase 1.63 reports projection had no per-reporter throttling,
   so a single reporter could weaponize the system with hundreds of
   spurious reports against a target.

Phase 1.71 is intentionally narrow: it hardens existing protocol
surfaces without adding new event kinds. No new ADR is required.

## Completed work

### Phase 1.71.A — Unicode normalization on the keyword match path

`packages/trust-safety/src/local-controls/selector.ts`:

- New `normalizeForKeywordMatch(input)` pure helper applied to both
  haystack and needle in every non-semantic match kind (`substring`,
  `word`, `phrase`, `hashtag`).
- Pipeline: NFKD compatibility decomposition → lowercase →
  strip zero-width / format code points → strip combining marks
  (`\p{M}`) → confusables map.
- 38-entry confusables map covering Cyrillic + Greek homoglyphs +
  common leet-speak substitutions. Map is a `Map<string, string>`
  (immune to prototype pollution).
- All patterns are compiled once at module load against literal
  source. No regex is compiled against attacker text.
- The combining-mark strip is applied through a constant `/\p{M}/gu`
  pattern; documented trade-off for non-Latin scripts (the
  normalized form is used ONLY for matching; rendered text and
  stored keywords are untouched).

### Phase 1.71.B — Report-rate cap on `safety.report.created`

`packages/trust-safety/src/errors.ts`:

- New stable error code `TS_REPORT_RATE_LIMITED`.

`packages/trust-safety/src/reports-appeals/projection.ts`:

- New `reportsByReporterSubjectDay: Readonly<Record<string, ReadonlyArray<string>>>`
  index on `ReportsAppealsState`. Bucket key is
  `JSON.stringify([reporterKey, utcDay, subjectKey])` so an
  attacker who crafts a reporter id containing the delimiter
  cannot collide with a legitimate user's bucket.
- `DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY = 10` constant.
- `ApplyReportAppealEventOptions.maxReportsPerReporterSubjectDay`
  configurable per-call.
- Cap fires AFTER `appliedEventIds` replay no-op AND AFTER
  `byReportIdempotencyKey` duplicate dedup, so replay determinism
  is preserved and no replay-time `TS_REPORT_RATE_LIMITED` throws
  occur.
- `seedReportsAppealsState` forwards the options for store rebuild.

`packages/trust-safety/src/reports-appeals/index.ts`:

- Exports `DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY` and
  `ApplyReportAppealEventOptions`.

### Tests

`packages/trust-safety/src/__tests__/phase-1.71.test.ts` — 32 new
adversarial tests:

- **Phase 1.71.A — substring matcher (8 tests):** literal control,
  leet, zero-width space, zero-width joiner, Cyrillic homoglyph,
  full-width Unicode, stacked evasions, false-positive sanity.
- **Phase 1.71.A — word matcher (3 tests):** literal token, leet
  token, boundary still enforced after normalization.
- **Phase 1.71.A — hashtag matcher (4 tests):** normal tag,
  homoglyph tag, leet tag, longer-tag-with-prefix not matched.
- **Phase 1.71.A — phrase matcher (4 tests):** literal, leet +
  zero-width, whitespace-collapsed runs, subset not matched.
- **Phase 1.71.A — combined block + keyword evasion (1 test):**
  blocked actor + leet-spoofed keyword resolves to `hide` (block
  wins under `mostRestrictive`).
- **Phase 1.71.A — DoS resistance (2 tests):** sub-200ms / sub-500ms
  on 20 000-char pathological inputs.
- **Phase 1.71.B — default cap behavior (4 tests):** accepts up to
  cap, throws on over-cap, idempotency dedup doesn't consume budget,
  replay doesn't consume budget.
- **Phase 1.71.B — cap key partitioning (3 tests):** cap resets per
  UTC day, per subject, per reporter.
- **Phase 1.71.B — bucket-key hardening (1 test):** attacker-crafted
  delimiter-containing actorId cannot collide with legitimate user's
  bucket (JSON-encoded composite key).
- **Phase 1.71.B — configurable + opt-out (2 tests):** custom cap
  respected; `Infinity` disables.

### Hardening review caught one real bug

While doing the post-implementation hardening sweep, I caught that
my first cut of the bucket-key construction used `::` as a
delimiter without escaping. An attacker who chose an actorId
containing literal `::` could have collided with a legitimate
user's bucket and exhausted their budget remotely. Switched to
`JSON.stringify` of a 3-element array, which quotes each component
unambiguously. Pinned by a new test.

### Doctrine

`docs/protocol/block-evasion-resilience.md` — canonical doctrine
covering:
- The full normalization pipeline (step-by-step + trade-offs).
- The defeat matrix (what does and doesn't match after the
  hardening).
- The rate-cap construction (bucket key, default value,
  configurability, interaction with idempotency + replay).
- Explicit non-defenses (sock-puppets, coordinated brigading) with
  pointers to the right future slice.
- Cross-projection composition with `decideVisibility` and the
  Phase 1.62 allowlist.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean (after switching the regex literal to
                 #        explicit ​-style escape sequences;
                 #        no-irregular-whitespace was correctly
                 #        catching invisible source chars)
pnpm test        # 1083 passing (1051 → 1083, +32)
pnpm build       # clean
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|:---:|---|
| Keyword matchers resist leet, zero-width, Cyrillic, full-width, combining-diacritic evasions | ✓ | 21 substring/word/hashtag/phrase tests |
| Normalization is linear-time and pinned by adversarial timing tests | ✓ | sub-second on 20 000-char inputs |
| No regex compiled against attacker text | ✓ | all patterns are module-level constants |
| Prototype-pollution defense holds at the confusables map and the rate-cap index | ✓ | `Map` for confusables; `assertId` upstream validation |
| Report rate cap fires per (reporter, subject, UTC day) | ✓ | 4 default-behavior + 3 partitioning tests |
| Cap composes with idempotency + replay without double-charging | ✓ | replay test + dedup test |
| Cap key cannot be collided by an adversarial reporter id | ✓ | JSON-encoded composite + dedicated hardening test |
| New `TS_REPORT_RATE_LIMITED` error code stable + exported | ✓ | `errors.ts` |
| Doctrine doc covers defeat matrix + non-defenses + composition | ✓ | `block-evasion-resilience.md` |

## Deferred work

- **Semantic keyword matcher pipeline.** The protocol shape exists
  (`matchKind: 'semantic'`); the PWA-side embedding pipeline does
  not. Real defense against whole-word substitution (`heads-up`
  instead of `spoiler`) requires this.
- **Per-stranger "first contact" UX guard.** Pairs with Phase 5
  chat. Surface a warning before any payload renders from someone
  outside the user's contact graph.
- **Coordinated-brigading detection.** Cross-reporter velocity
  analytics on the moderation side. Outside the protocol layer.
- **Confusables-table expansion.** Hebrew, mathematical fraktur,
  fullwidth digit subtleties. Add incrementally as real evasion
  patterns are observed.

## Decision

This phase is:

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: Both pieces of the block-evasion hardening pack are shipped
end-to-end with adversarial tests, the hardening sweep caught and
fixed a real bucket-key collision bug before commit, and the
doctrine doc gives downstream contributors a clear map of what is
and is not defended.
