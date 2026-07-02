# Phase Exit Report: Phase 3.1 — Privacy-safe logging policy

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

Phase 3.1 closes the longest-standing privacy hardening gap in the
codebase. Before this phase:

- Zero `console.*` calls existed in production source (verified by
  grep) — **by accident, not by structure**.
- A single careless `console.log(envelope)` in any future PR could
  silently leak a decrypted payload, the controller key, or the
  user's full block list.
- The quality bar in `docs/implementation/next-development-path.md`
  ("no private plaintext leakage in logs") was a habit, not a rule.

Phase 3.1 converts that into:

- A canonical doctrine (`docs/protocol/privacy-safe-logging.md`)
  defining what may and may not be logged, by category, with
  references to the existing Phase 1.64 audit-redaction primitives.
- A structural ESLint enforcement (`no-console`, `no-debugger`,
  `no-alert` scoped to `packages/*/src/**` and `apps/*/src/**`).
- A defense-in-depth audit-pin vitest suite that re-checks the same
  invariants by scanning the source tree directly — even if a future
  change weakens the ESLint config.

This was identified by the user as the highest-leverage, lowest-effort
hardening available given the existing protocol surface. It is also
the prerequisite for Phase 4.1 (bridge transport-admission wiring) —
the bridge runtime must not log private state, and the doctrine here
governs that.

## Completed work

### Phase 3.1.A — Doctrine

`docs/protocol/privacy-safe-logging.md` (new):

- **What this applies to**: every observable channel — `console.*`,
  `process.stdout/err`, server logs, future telemetry, `Error.message`
  text that flows downstream, audit-log entries, status lines that
  the user might screenshot.
- **What is private (never log directly)**, 8 categories: decrypted
  payload bodies; private signing keys + key material; controller /
  device public keys (T-IDC-2 fingerprinting); `LocalControlState`
  contents; `IdentityControlState` contents; inbound payload before
  decryption; DigestRef / ObjectRef / BlockRef bodies in full;
  sub-second `createdAt` timestamps.
- **What is loggable (safe by category)**, 5 categories: event
  identifiers and kinds; stable error codes; redacted refs via
  existing primitives; public scopes / kinds / counts; safe stack
  traces; test output.
- **Error-message hygiene**: every `Error("…")` and `tsError(code,
message)` MUST treat the message as a structural neutral
  description, not a reprint of the offending input. Existing
  validators in `@lfp2p/trust-safety/validation.ts`,
  `@lfp2p/identity/validation.ts`, and
  `@lfp2p/content-addressing/errors.ts` are the canonical examples.
- **User-facing status surfaces** (the PWA `lfp2p-muted-detail`
  lines): NOT a leak channel because they surface back to the data
  owner — but the messages MUST already be doctrine-compliant
  because the user may screenshot or paste them elsewhere.
- **Existing redaction primitives table**: `redactDigestRef`,
  `redactContentLink`, `redactBlockRef`, `redactDigestForAudit`,
  `redactBlockRefForAudit`. New surfaces ADD primitives to the
  existing modules; never inline.
- **Structural enforcement section** documents the ESLint rule.
- **Phase 1.64 audit log already compliant**: explicit cross-reference
  to the canonical implementation.
- **Decision flow for a new logging call site**: 4-step checklist.
- **What this is NOT**: not a replacement for end-to-end encryption;
  not a guarantee about third-party JS we don't ship today; not a
  guarantee about OS-level crash reports.

### Phase 3.1.B — Structural ESLint enforcement

`eslint.config.js`:

- New block scoped to `packages/*/src/**/*.{ts,tsx}` +
  `apps/*/src/**/*.{ts,tsx}`.
- Rejects `console.*`, `debugger`, and the alert family
  (`alert | confirm | prompt`).
- Excludes `*.test.{ts,tsx}`, `__tests__/`, and `*.config.{ts,tsx}`.
- Two existing intentional consent-prompt sites in the PWA
  (`pwa-identity-audit.tsx` for device rotation; `pwa-trust-safety-settings.tsx`
  for the adult-content gate) annotated with
  `// eslint-disable-next-line no-alert` + per-line justifying
  comments referencing the doctrine.

Pre-phase audit confirmed zero `console.*` and zero `debugger`
statements existed in production source, so no remediation was
required — the rule formalizes the existing behavior.

### Phase 3.1.C — Audit-pin test (defense-in-depth)

`packages/trust-safety/src/__tests__/phase-3.1-no-leak.test.ts` —
five new tests that walk the production source tree directly and
re-check the same invariants as the ESLint rule:

- **File collector sanity**: locates a non-trivial number of
  production source files (>20). Guards against a future refactor
  silently emptying the scan target.
- **No `console.*` in production**: scans for `console.{log|debug|info|warn|error|trace|table|dir|group|groupEnd}\(`;
  fails with file:line offender list and a pointer to the doctrine.
- **No `debugger` in production**: scans for `debugger;`.
- **Alert-family inventory pinned**: `INTENTIONAL_CONSENT_PROMPT_FILES`
  array enumerates the two existing consent-prompt files; the test
  fails on either drift direction (a new unannotated site, or an
  inventoried site that no longer has the call) with actionable
  guidance.
- **Inventory marker check**: each inventoried site has an
  `eslint-disable-next-line no-alert` marker within 3 lines above the
  call. If someone removes the marker, the test catches it even if
  ESLint is bypassed.

This is the structural duplicate of the ESLint rule. Defense-in-depth:
removing the ESLint rule does not silently weaken the privacy
guarantee; the test still fails.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean (rules now enforced)
pnpm test        # 1088 passing (1083 → 1088, +5 audit-pin tests)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                                                             | Status | Evidence                                                      |
| ----------------------------------------------------------------------------------------------------- | :----: | ------------------------------------------------------------- |
| Doctrine defines what may and may not be logged by category                                           |   ✓    | `privacy-safe-logging.md` — 8 private + 5 loggable categories |
| Doctrine names the existing redaction primitives                                                      |   ✓    | full table                                                    |
| Doctrine covers error-message hygiene                                                                 |   ✓    | dedicated section with code examples                          |
| ESLint rule rejects `console.*`/`debugger`/`alert` in production source                               |   ✓    | `eslint.config.js`                                            |
| Test files and config files are exempt                                                                |   ✓    | `ignores` block                                               |
| Two existing intentional consent prompts annotated with doctrine-compliant comments + disable markers |   ✓    | `pwa-identity-audit.tsx`, `pwa-trust-safety-settings.tsx`     |
| Defense-in-depth audit-pin test catches violations even if ESLint is weakened                         |   ✓    | `phase-3.1-no-leak.test.ts`                                   |
| Zero current production violations                                                                    |   ✓    | pre-phase grep + post-phase test pass                         |

## Hardening review caught

The audit-pin test's `ALERT_FAMILY_PATTERN` regex went through a
correction during development: my first cut used a lookbehind
`(?<![.\w])` that excluded matches preceded by `.`, which then missed
the `globalThis.confirm(` call sites entirely. Switched to
`(?<![A-Za-z0-9_$])` which excludes only identifier-character
predecessors, so `globalThis.confirm(` is caught while `myConfirm(`
(a hypothetical user function) is correctly skipped. Without this
correction the inventory-drift check would have been silently
permissive against the exact attack surface it's defending.

## Deferred work

- **Privacy-safe logging audit for the bridge service (Phase 4.1
  precursor).** When `apps/bridge-service` wires in the
  transport-admission engine, the operator dashboard / audit output
  MUST go through `redactDigestForAudit` / `redactBlockRefForAudit`
  and MUST NOT log payload contents. The audit-pin test will catch
  console violations; the doctrine governs the rest.
- **Privacy-safe logging audit for future CLI tools / scripts.** If we
  add a CLI surface in `tools/` or `scripts/`, the production roots
  list in the audit-pin test should be extended.
- **OS-level crash report guidance for the PWA.** The doctrine notes
  this is out of scope at the protocol layer; a future PWA-side
  threat-model addendum could surface the OS limitation to users.

## Decision

This phase is:

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: The privacy guarantee around "no leakage in logs" is now
both documented and structurally enforced at two layers (ESLint +
vitest audit-pin). The codebase's current zero-violation state is
locked in. The doctrine gives every future contributor a clear
decision-flow for new logging surfaces.
