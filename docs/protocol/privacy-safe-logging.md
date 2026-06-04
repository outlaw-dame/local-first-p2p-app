# Privacy-Safe Logging Doctrine

- Status: Draft
- Date: 2026-06-04
- Related ADRs:
  - `docs/adr/001-identity-control-log-v1.md`
  - `docs/adr/002-private-payload-encryption-envelope-v1.md`
  - `docs/adr/004-trust-safety-moderation-curation-v1.md`
  - `docs/adr/005-content-addressing-and-object-references-v1.md`
- Related protocol docs:
  - `docs/protocol/bridge-admission-doctrine.md`
  - `docs/protocol/local-controls-portability.md`
  - `docs/protocol/identity-control-log.md`
  - `docs/protocol/operation-consistency-classes.md`
- Related threat models:
  - `docs/threat-model/trust-safety-and-abuse.md`
  - `docs/threat-model/bridge-compromise.md`
  - `docs/threat-model/identity-control.md`
- Related architecture docs:
  - `docs/architecture/local-verifier.md`
- Related implementation docs:
  - `docs/implementation/phase-3.1-exit-report.md`

## Purpose

Define what may and may not appear in any log surface the codebase
produces: console output, server logs, future telemetry, error
messages surfaced to UI, exception strings, audit-log entries, and
any other observable channel.

This doctrine generalizes the audit-redaction policy from Phase 1.64
(`@lfp2p/trust-safety/transport-admission/audit.ts`) into a
codebase-wide rule, and pins it structurally via the ESLint
`no-console` rule shipped in Phase 3.1.B. The combination — doctrine
+ enforced rule + audit-pin test — converts "we accidentally don't
log private data today" into "we structurally cannot log private
data without explicit opt-out review."

This is the canonical answer for the quality-bar item in
`docs/implementation/next-development-path.md`:

> Every next implementation PR should include … no private plaintext
> leakage in logs …

## What this applies to

| Surface                                                         | Doctrine applies? |
|-----------------------------------------------------------------|:-----------------:|
| `console.log`, `console.debug`, `console.info`, `console.warn`, `console.error` | ✓ |
| `process.stdout.write` / `process.stderr.write`                 | ✓ |
| Server access logs and structured server logs                   | ✓ |
| `Error.message` text that may be caught + logged downstream     | ✓ |
| Status lines displayed to the local user in their own session   | partial (see below) |
| `transport.event.*` audit-log entries from `@lfp2p/trust-safety` | ✓ via existing redaction helpers |
| Test output (`expect(...).toThrow(...)`, vitest reporter)        | excluded (see below) |
| External telemetry / crash-reporting integrations                | ✓ (none shipped yet; doctrine applies if added) |

## What is private (never log directly)

| Category | Concrete examples | Why |
|---|---|---|
| **Decrypted payload bodies** | `note.created.payload.body`, `safety.report.created.report.encryptedBodyRef` resolved contents, chat message bodies (future Phase 5), DM contents | The bridge-blindness contract depends on these never being observable outside the device. Logging breaks the contract. |
| **Private signing keys + key material** | Anything containing `privateKey`, `encryptedPrivateKey`, `protectionKey`, key bytes | Compromise = total identity compromise (T-IDC-5). |
| **Controller / device public keys in identity-control events** | `controllerPublicKey`, `authorizedPublicKey`, `newPublicKey` | Public keys are not secret, but their presence in logs makes correlation easier (T-IDC-2 fingerprinting). Log the `shortFingerprint` instead. |
| **`LocalControlState` projection contents** | The full list of blocked / muted / allowlisted actors, keyword filters, label preferences | These reveal the user's enforcement choices. Per Phase 1.62 doctrine they ride `account-local` or `device-local` scope; a log entry would break that scope. |
| **`IdentityControlState` projection contents** | The full device list with public keys | T-IDC-2 fingerprinting concern. |
| **Inbound payload before decryption** | The encrypted envelope `payload` field | The envelope itself is fine to log under its eventId; the payload field is the encrypted ciphertext blob — small and high-entropy but still attacker-controlled. Logging it gives a flood vector. |
| **DigestRef bodies in full** | Full SHA-256 hex / base64 of any object | Use `redactDigestRef` for the 8-char prefix form. |
| **Full `ObjectRef` / `BlockRef`** | Anything with a `digest`/`source.digest` | Use `redactBlockRef` / the audit-log redacted forms. |
| **`createdAt` with sub-second precision** | `2026-06-04T10:23:47.123Z` | Phase 1.64 audit log already truncates to whole seconds to avoid timing-oracle fingerprints. Generalize: any log of multiple events from the same actor SHOULD round to whole seconds. |

## What is loggable (safe by category)

| Category | Examples | Notes |
|---|---|---|
| **Event identifiers and kinds** | `eventId`, `kind`, `version` | These are wire-stable identifiers, not contents. |
| **Stable error codes** | `TS_PRIVATE_LEAK`, `IDENTITY_AUTHORITY_MISMATCH`, `TS_REPORT_RATE_LIMITED`, `CA_INVALID_CID`, etc. | The whole point of stable codes (Phase 1.61 + Phase 2.1) is to let callers and logs reference behaviour without leaking input. |
| **Redacted refs** | Output of `redactDigestRef`, `redactBlockRef`, `redactDigestForAudit`, `redactBlockRefForAudit` | The single source of truth for what "redacted" means. Always go through these helpers. |
| **Public scopes / kinds / counts** | `event.privacy === 'public'`, batch sizes, applied/skipped/rejected counters | Aggregate metadata only — never per-event payload. |
| **Stack traces** | `Error.stack` text that does not contain user payload | Conditional: only acceptable when the error's message itself is safe per this doctrine. |
| **Test output** | vitest expectations, fixture digests | Tests are not a production log surface. The doctrine still applies in spirit (avoid printing real user data into test snapshots) but the structural lint rule excludes test files. |

## Error-message hygiene

Every `Error("…")` and every `*Error(code, message)` constructor whose
message text ends up in a log MUST treat the message as a *human-readable
neutral description of the structural problem*, not a re-print of the
input that triggered it. Specifically:

- **Do not** include the payload field that failed validation. The
  field's existence + the validator's name is enough.
- **Do not** include the user's text content (keyword filter content,
  post body, etc.).
- **May** include type names, stable error codes, fixed enum values,
  and the structural property names being checked.
- **May** include numeric bounds (length cap, byte cap, epoch
  expectations).

The pattern used throughout `@lfp2p/trust-safety/validation.ts`,
`@lfp2p/identity/validation.ts`, and `@lfp2p/content-addressing/errors.ts`
is the canonical example:

```ts
// Good — structural and neutral:
throw tsError('TS_INVALID_INPUT', `${label}.payload must be a plain object`);
throw identityError('IDENTITY_INVALID_PUBLIC_KEY',
  `${label}: payload.${field} must be a base64url-encoded public key (1-2048 chars, [A-Za-z0-9_-])`);

// Bad — echoes potentially-private input back:
throw new Error(`Invalid payload: ${JSON.stringify(payload)}`); // NEVER
throw new Error(`Could not parse ${userMessageBody}`); // NEVER
```

When an error is caught and re-surfaced to the user, the surfacing
layer SHOULD prefer the stable code over the message text, with
the message used only as a humane fallback.

## User-facing status surfaces

The PWA's `lfp2p-muted-detail` status lines (e.g. in
`pwa-trust-safety-settings.tsx` and `pwa-identity-audit.tsx`) display
caught error messages back to the user. These are NOT a leak channel
because they surface back to the data owner in their own session.
However:

- The message MUST already be doctrine-compliant per the previous
  section, because the user may screenshot or paste the message
  elsewhere.
- The status line MUST NOT include the offending payload alongside
  the error. The user already authored the input; they don't need it
  echoed.
- Future telemetry / crash reporting that captures these status lines
  MUST be re-evaluated against this doctrine before shipping.

## Existing redaction primitives (use these, not bespoke logic)

| Primitive | Package | Use case |
|---|---|---|
| `redactDigestRef(ref)` | `@lfp2p/content-addressing` | Standalone digest reference in any log line. Returns `"<algorithm>:<8-char-prefix>…"`. |
| `redactContentLink(link)` | `@lfp2p/content-addressing` | Content-link form (`cid:…` or `digest:…`). |
| `redactBlockRef(ref)` | `@lfp2p/content-addressing` | Block reference body; encryption descriptor key digests are dropped entirely. |
| `redactDigestForAudit(ref)` | `@lfp2p/trust-safety/transport-admission` | Audit-log specific form: `"<algorithm>:<8-char>"` without ellipsis (more compact for high-volume audit). |
| `redactBlockRefForAudit(ref)` | `@lfp2p/trust-safety/transport-admission` | Block-ref audit form. |

If a future surface needs a new redaction shape (e.g. a different
prefix length), ADD a primitive to the existing module rather than
inlining the redaction in the call site.

## Structural enforcement (Phase 3.1.B)

`eslint.config.js` adds a rule scoped to `packages/*/src` and
`apps/*/src`:

- `no-console: error` — every `console.*` call is rejected.
- `no-debugger: error` — every `debugger` statement is rejected.
- `no-alert: error` — every `alert | confirm | prompt` call is
  rejected EXCEPT in the PWA UI components where they are deliberate
  consent prompts; those paths explicitly use `globalThis.confirm`
  with a doctrine-compliant message.

Test files (`*.test.ts`, `*.test.tsx`) are exempt — they need
`expect(...).toThrow(...)` matching error messages, and they may
inspect log output to assert behavior. Config files (`*.config.ts`,
`vite.config.ts`) are exempt for the same reason.

When a future surface genuinely needs to log (e.g. a CLI tool that
prints output to the user), the call site:

1. Authors the log line per this doctrine.
2. Adds `// eslint-disable-next-line no-console — <reason>` with a
   one-line justification.
3. Adds a test that pins the format of the output and asserts no
   forbidden category appears.

## Phase 1.64 audit log — already compliant

`@lfp2p/trust-safety/transport-admission/audit.ts` is the canonical
implementation of this doctrine for bridge / relay / super-peer
admission decisions. Its specific rules:

- No encryption-key DigestRef ever appears (only its redacted form).
- No full DigestRef body — `redactDigestForAudit` returns the
  8-char prefix.
- Timestamps round to whole seconds.
- FIFO eviction at capacity bounds storage growth.

When a downstream consumer (Phase 4.1 bridge runtime wiring) plumbs
this audit log to a server-side store or operator dashboard, it MUST
NOT enrich the entries with anything outside this allowed set. If
the operator wants more, the right move is to add a new field to the
audit shape AND verify it through this doctrine, not to extend the
log inline at the storage layer.

## Decision flow for a new logging call site

1. **What category is the data?** Private (forbidden) or loggable
   per the tables above.
2. **If loggable**: is there an existing redaction primitive for the
   ref/digest types involved? Use it.
3. **If forbidden**: is logging actually necessary? Most of the time
   the structural answer is "no — surface a stable code through the
   normal error path." If the answer is "yes," add a new audit
   surface with its own shape, redaction primitives, and tests; do
   not inline a `console.log`.
4. **Lint disable**: justified one-liners get reviewed; blanket
   `eslint-disable` blocks do not.

## What this is NOT

- A replacement for end-to-end encryption.  Logs are an *observable
  channel*; encryption protects content over the network. Both
  matter.
- A guarantee about third-party JavaScript loaded into the PWA.  We
  ship no third-party telemetry today; if we ever do, the choice MUST
  be re-evaluated against this doctrine and an explicit ADR.
- A guarantee about OS-level crash reports. The browser / OS may
  capture private state on a crash regardless of this doctrine. Users
  who care should disable OS-level reporting.

## Implementation evidence

- `eslint.config.js` — `no-console`, `no-debugger`, `no-alert` rules
  with test/config exemptions.
- `packages/content-addressing/src/redaction.ts` —
  `redactDigestRef`, `redactContentLink`, `redactBlockRef`.
- `packages/trust-safety/src/transport-admission/audit.ts` —
  `redactDigestForAudit`, `redactBlockRefForAudit`.
- `packages/trust-safety/src/__tests__/phase-3.1.test.ts` —
  audit-pin test confirming no `console.*` / `debugger` / `alert`
  appears in built production source.
- Exit report: `docs/implementation/phase-3.1-exit-report.md`.
