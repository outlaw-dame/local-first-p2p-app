# Block-Evasion Resilience Doctrine

- Status: Draft
- Date: 2026-06-04
- Related ADRs:
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
- Related protocol docs:
  - `docs/protocol/local-controls-portability.md`
  - `docs/protocol/operation-consistency-classes.md`
- Related threat models:
  - `docs/threat-model/trust-safety-and-abuse.md`
  - `docs/threat-model/identity-control.md`
- Related implementation docs:
  - `docs/implementation/phase-1.71-exit-report.md`

## Purpose

Document the protocol's stance on block-evasion resilience: which
attacks we structurally defend against, which attacks we make
expensive but cannot fully prevent, and which attacks are out of
scope for a pseudonymous local-first system. The intended reader is
a contributor adding a new T&S surface (chat, social outbox, media
manifest, etc.) who needs to know how their slice should compose
with the existing defenses.

This doctrine pairs with `revocation-realism.md` (UX honesty about
deletion) and `identity-control.md` (cryptographic-identity threat
model). Where those documents say "here's what we can't promise,"
this one says "here's how we make adversaries pay more."

## What Phase 1.71 ships

### Phase 1.71.A — Unicode normalization on the keyword match path

Every non-semantic keyword matcher (`substring`, `word`, `phrase`,
`hashtag`) now runs both haystack and needle through a fixed
normalization pipeline before comparison:

1. `String.prototype.normalize('NFKD')` — compatibility
   decomposition. Full-width (`ＳＰＯＩＬＥＲ`), circled letters
   (`ⓢⓟⓞⓘⓛⓔⓡ`), mathematical alphanumerics, and ligatures collapse
   to base ASCII letters; precomposed diacritics decompose into base
   letter + combining marks.
2. `toLowerCase()` (deliberately not locale-aware — JS default
   `toLowerCase()` is non-locale; this gives stable cross-device
   behavior regardless of system locale).
3. Strip zero-width / format code points (`U+200B-U+200D`, `U+2060`,
   `U+FEFF`) AND every Unicode combining mark (`\p{M}`) via
   constant precompiled patterns.
4. Apply a fixed table of common visual confusables:
   - Cyrillic lowercase letters that look like Latin: `а→a`,
     `е→e`, `і→i`, `ј→j`, `о→o`, `р→p`, `с→c`, `у→y`, `х→x`,
     `ѕ→s`, `ԁ→d`, `һ→h`, `ӏ→l`.
   - Greek lowercase letters that look like Latin: `α→a`,
     `ε→e`, `ι→i`, `ν→v`, `ο→o`, `ρ→p`, `τ→t`, `μ→u`.
   - Common leet-speak intentional evasions: `0→o`, `1→l`,
     `3→e`, `4→a`, `5→s`, `7→t`, `8→b`, `@→a`, `$→s`.

#### What this defeats

| Evasion                        | Filter `spoiler` matches |
| ------------------------------ | :----------------------: |
| Plain `spoiler` (control)      |            ✓             |
| `Spoiler` (case)               |            ✓             |
| `SPOILER` (case)               |            ✓             |
| `sp0iler` (leet)               |            ✓             |
| `sp​oiler` (zero-width space)  |            ✓             |
| `sp‍oiler` (zero-width joiner) |            ✓             |
| `ѕpoiler` (Cyrillic ѕ U+0455)  |            ✓             |
| `ＳＰＯＩＬＥＲ` (full-width)  |            ✓             |
| `ⓢⓟⓞⓘⓛⓔⓡ` (circled letters)    |            ✓             |
| `sp​0îler` (stacked evasions)  |            ✓             |

#### What this deliberately does NOT defeat

- **Whole-word substitution** (`heads-up` instead of `spoiler`). No
  literal-character matcher can; this is what `matchKind: 'semantic'`
  is for. Phase 1.71 does not ship the semantic matcher pipeline;
  the host callback hook remains.
- **Adversarial language drift** (calling it "marshmallow" because
  everyone knows what that means in context). Same answer: semantic
  matchers or per-community labelers.
- **Combining-mark-aware semantics in non-Latin scripts.** Stripping
  combining marks via `\p{M}` collapses Arabic / Devanagari / Hebrew
  / Indic distinctions that are semantically essential. This is the
  documented trade-off: the normalized form is used ONLY for
  matching; the user's stored keyword and the rendered post text are
  untouched. A user who needs strict matching on those scripts
  should use `matchKind: 'semantic'` once the embedding pipeline
  ships, where the semantic comparison is performed by a script-aware
  host model.

#### Performance and safety

- All patterns are compiled once at module load against literal
  source. No regex is ever compiled against attacker-controlled
  text.
- The confusables table is a `Map<string, string>`, not a plain
  object — immune to prototype-pollution lookups.
- The normalization pipeline is linear-time in the input length.
- Output is at most ~1.1× input length (NFKD has bounded growth;
  the confusables map is 1:1).
- Adversarial timing tests pin both pathological zero-width-padded
  and full-width-padded inputs at sub-second on 20 000-char inputs.

### Phase 1.71.B — Report-rate cap on `safety.report.created`

`applyReportAppealEvent` enforces a per-`(reporter, subject, UTC day)`
cap on `safety.report.created` events with stable error code
`TS_REPORT_RATE_LIMITED`.

#### Default cap

`DEFAULT_MAX_REPORTS_PER_REPORTER_SUBJECT_DAY = 10`. Tuned
conservatively: a legitimate user filing more than 10 reports against
the same target in a single day is unusual; a weaponized report flood
is far more likely.

#### Cap key construction

The bucket key is `JSON.stringify([reporterKey, utcDay, subjectKey])`:

- `reporterKey` is discriminator-aware (`actor::<id>`,
  `community::<id>`, `pseudonym::<id>`) so an attacker cannot bypass
  the cap by switching the reporter `kind` field.
- `utcDay` is `report.createdAt.slice(0, 10)` (`YYYY-MM-DD`). The
  receiver does NOT use its own clock — a clock-skewed report would
  otherwise fall into the wrong bucket. The `createdAt` field is
  signed when the envelope is signed, so a malicious reporter cannot
  trivially rewrite it without producing detectable backdating.
- `subjectKey` reuses the existing `subjectKey(SafetySubjectRef)`
  helper from `curation-runtime/projection.ts`.
- `JSON.stringify` quotes each component so an attacker who crafts a
  reporter id containing the literal delimiter (e.g.
  `alice"]::2026-06-03"::event_X`) lands in their own JSON-quoted
  bucket, not in the legitimate user's. Pinned by test.

#### Interaction with replay and idempotency

The cap fires AFTER the existing idempotency-key duplicate check and
the `appliedEventIds` replay no-op:

1. Replay of the same `eventId` → no-op (no budget consumed).
2. Duplicate `idempotencyKey` → no-op (no budget consumed).
3. New report → check cap, throw `TS_REPORT_RATE_LIMITED` if
   exhausted, else apply.

Replay determinism is preserved: an event that was originally
rejected for rate-limiting was never added to the store, so the
replay never sees it.

#### Configurability

`applyReportAppealEvent`'s 4th argument is
`options: { maxReportsPerReporterSubjectDay?: number }`. Consumers
that need a higher (or unlimited) cap can pass any positive number
or `Infinity`. `seedReportsAppealsState` forwards the option for
store rebuilds.

#### What this defeats

| Scenario                                                                    | Behavior                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------- |
| 1 user files 10 distinct reports against 1 target in 1 day                  | accepted                                          |
| Same user files an 11th distinct report on the same day                     | `TS_REPORT_RATE_LIMITED`                          |
| Same user files 10 against subject A, then 10 against subject B             | accepted (per-subject budget)                     |
| Same user files 10 on 2026-06-03 then 10 on 2026-06-04                      | accepted (per-day budget)                         |
| Two different users each file 10 against same target on same day            | accepted (per-reporter budget)                    |
| Same user replays the same `eventId` 1000 times                             | accepted as 1 (replay idempotent, no budget)      |
| Same user replays the same `idempotencyKey` 1000 times under new `eventId`s | accepted as 1 (dedup, no budget)                  |
| Attacker crafts a reporter id to collide with a victim's bucket             | lands in attacker's own bucket (JSON-encoded key) |

#### What this deliberately does NOT defeat

- **Sock-puppet reports** (attacker creates a new identity per
  report). This is the fundamental local-first limit — see
  `identity-control.md` T-IDC-3 and the next-development-path
  defer markers. Mitigations live at the bridge level (Phase 4.1
  peer reputation) and at the application level (per-stranger UX
  guards, future).
- **Coordinated brigading** (10 different real users each file 10
  reports against the same target on the same day = 100 reports).
  This is real coordinated reporting; the cap is intentionally per
  reporter, not per target. Detecting coordination is moderation-side
  analytics, out of scope for this slice.

## Cross-projection composition

The Phase 1.71 hardening composes cleanly with the existing T&S
layer:

- `decideVisibility` runs every signal (block + mute + keyword +
  label + thread + post + notification) through `mostRestrictive`
  combination. A keyword match against a leet-spoofed evasion +
  a user-set block on the actor produces `hide`, not `collapse`,
  because the block is stricter. Pinned by test
  "a blocked actor PLUS a leet-spoofed keyword still resolves to
  hide".
- The report-rate cap does NOT interact with `decideVisibility` —
  reports are a separate Class B projection on the moderation side,
  not a user-local visibility decision.

## Future work

| Item                                                                          | Target                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Semantic keyword matcher pipeline (host-supplied embedding) in the PWA        | Future T&S slice — protocol shape exists               |
| Per-stranger "first contact" warning UX before any payload renders            | Future T&S + PWA slice                                 |
| Coordinated-brigading detection (cross-reporter, per-target velocity)         | Moderation-tools analytics, outside the protocol       |
| Confusables expansion (Hebrew / Greek capitals / mathematical fraktur / etc.) | Incremental — driven by real observed evasion patterns |

## Implementation evidence

- `packages/trust-safety/src/local-controls/selector.ts` —
  `normalizeForKeywordMatch` pipeline + applied to all four
  non-semantic match kinds.
- `packages/trust-safety/src/reports-appeals/projection.ts` —
  `reporterSubjectDayKey`, `reportsByReporterSubjectDay` index,
  cap enforcement in `applyReportAppealEvent`.
- `packages/trust-safety/src/__tests__/phase-1.71.test.ts` — 32
  adversarial tests across both pieces.
- New stable error code `TS_REPORT_RATE_LIMITED`.
- Doctrine: `docs/protocol/block-evasion-resilience.md` (this doc).
- Exit report: `docs/implementation/phase-1.71-exit-report.md`.
