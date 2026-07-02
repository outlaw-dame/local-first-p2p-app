# Phase 5.0E follow-up triage

- Date: 2026-06-05
- Trigger: master CI red after commit `51a990c` ("Phase 5.0E: Recipient Key Wrapping Infrastructure"). 90 test failures across 15 files + 3 lint errors.
- Decision: fix forward (do NOT revert 5.0E — it ships real value for Phase 5.0 chat) by completing the integration.

## Root cause

Commit `51a990c` introduced a new protocol invariant in
`packages/protocol/src/index.ts` `validatePayloadPrivacyScope`:

| Privacy scope               | Pre-5.0E payload requirement      | Post-5.0E payload requirement                 |
| --------------------------- | --------------------------------- | --------------------------------------------- |
| `device-local`, `public`    | any non-private-shape JSON object | must NOT look like a private payload envelope |
| `self` (non-identity kinds) | any JSON object                   | MUST be a valid `PrivatePayloadEnvelopeV1`    |
| `dm`, `group`               | any JSON object                   | MUST be a valid `PrivatePayloadEnvelopeV1`    |

`looksLikePrivatePayloadEnvelope` checks for the presence of all of:
`version`, `algorithm`, `ciphertext`, `nonce`, `keyId`.
`validatePrivatePayloadEnvelope` additionally enforces:

- `version === 'lfp2p.private-payload.envelope.v1'`,
- `algorithm === 'aes-gcm-256'`,
- `ciphertext` is non-empty base64url,
- `nonce` decodes to exactly 12 bytes,
- `keyId` is non-empty,
- optional `recipientWraps` array (each with required identity / device
  / algorithm / wrappedKey / wrappingKeyRef fields).

Every existing test that built a `dm` / `group` / `self`-privacy
envelope with a plaintext payload (e.g. `{ body: 'hello' }`) now
throws at envelope construction time.

## Lint failures (3)

| File                             | Line | Issue                                           | Fix                                                           |
| -------------------------------- | ---- | ----------------------------------------------- | ------------------------------------------------------------- |
| `packages/crypto/src/index.ts`   | 12   | `KeyAgreementAlgorithm` imported but never used | Drop the import (it's exported via `export type *`) or use it |
| `packages/protocol/src/index.ts` | 229  | `any`                                           | Replace with `unknown` or a precise type                      |
| `packages/protocol/src/index.ts` | 447  | `any`                                           | Replace with `unknown` or a precise type                      |

## Failing test files — classification

15 files, ~90 test cases total. Each file falls into exactly one of two strategy families:

### Family A — switch to `public` privacy (10 files)

Tests in this family DO NOT exercise dm/group/self semantics; they
use those privacy scopes only because they need any envelope that
the bridge accepts (the bridge-safe scope set is `{dm, group, public}`).
Switching the fixture to `public` preserves test intent at zero cost.

| File                                                       | Test focus                                                                  | Why public is fine                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/bridge-service/src/admission-gateway.test.ts`        | Phase 4.1 admission engine (rate limit, byte cap, kind allowlist, peer rep) | Admission checks operate on envelope shape; privacy scope is just a bridge-safe gate |
| `apps/bridge-service/src/admission-state-store.test.ts`    | Phase 4.2 admission state persistence                                       | Same — testing the gateway, not encryption                                           |
| `apps/bridge-service/src/http-hardening.test.ts`           | Phase 4.3 HTTP-layer hardening (auth, size cap, rate limit)                 | Doesn't read the envelope body; only checks transport                                |
| `apps/bridge-service/src/inbound-read.test.ts`             | Bridge inbound-read pagination + cursor                                     | Tests storage + listing; privacy is incidental                                       |
| `apps/bridge-service/src/index.test.ts`                    | Public surface re-exports                                                   | Same                                                                                 |
| `apps/pwa/src/pwa-outbox-manual-gate.test.ts`              | Outbox manual-gate ordering                                                 | Privacy is incidental — testing scheduling                                           |
| `packages/local-store/src/inbound-sync.test.ts`            | Inbound-sync stamping                                                       | Storage path test                                                                    |
| `packages/sync-client/src/http-bridge-integration.test.ts` | HTTP bridge transport round-trip                                            | Wire-level test                                                                      |
| `packages/sync-client/src/inbound-runner.test.ts`          | Inbound runner scheduling                                                   | Scheduling — payload contents don't matter                                           |
| `packages/sync-client/src/outbox-jitter.test.ts`           | Outbox retry-jitter timing                                                  | Same                                                                                 |

### Family B — wrap in placeholder `PrivatePayloadEnvelopeV1` (5 files)

Tests in this family specifically exercise `dm` / `self` semantics
(privacy-scope enforcement, account-local sync, identity events).
Switching to `public` would silently change test coverage. The
correct fix is to use a placeholder valid private-payload envelope
shape in the existing payload position.

| File                                                 | Test focus                                                        | Why placeholder is right                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/sync-client/src/inbound-http.test.ts`      | Bridge inbound HTTP flow including DM events                      | DM is part of the surface being tested                        |
| `packages/sync-client/src/inbound-sync.test.ts`      | Inbound sync with both DM and self privacy scopes                 | Privacy-scope-routing behavior matters                        |
| `packages/sync-client/src/index.test.ts`             | Sync-client public surface                                        | Mixed-privacy fixtures across multiple tests                  |
| `packages/sync-client/src/phase-2.2.test.ts`         | Phase 2.2 identity persistence (`self`-scoped identity events)    | Identity events on `self` MUST pass through the new validator |
| `packages/sync-client/src/verifier-boundary.test.ts` | Boundary verifier exercising dm + self + identity envelope shapes | Mixed-privacy coverage                                        |

## Strategy

1. **Lint first** (3-minute fix, unblocks the build step).
2. **Create one shared placeholder helper** at the `@lfp2p/protocol`
   public surface so Family B tests reference a single canonical
   shape:

   ```ts
   // packages/protocol/src/index.ts (new export)
   export function placeholderPrivatePayloadEnvelope(
     overrides: Partial<{ keyId: string; ciphertext: string }> = {}
   ): PrivatePayloadEnvelopeV1 {
     return Object.freeze({
       version: PRIVATE_PAYLOAD_ENVELOPE_VERSION,
       algorithm: 'aes-gcm-256',
       ciphertext: overrides.ciphertext ?? 'AAAA',
       nonce: 'AAAAAAAAAAAAAAAA', // base64url of 12 zero bytes
       keyId: overrides.keyId ?? 'placeholder-key'
     });
   }
   ```

   Exporting from `@lfp2p/protocol` (not from a test util) is
   intentional: test fixtures across `apps/` + `packages/` would
   otherwise duplicate the shape. Single source of truth.

3. **Family A**: per-file mechanical sweep changing `privacy: 'dm'`
   / `'group'` to `privacy: 'public'` for fixtures where the test
   body does not branch on privacy scope.
4. **Family B**: per-file mechanical sweep replacing
   `payload: { body: ... }` with
   `payload: placeholderPrivatePayloadEnvelope({ keyId: ... })`.
5. **Verify** the full suite goes green before committing.

## Decision boundary I am NOT crossing

I am NOT changing the 5.0E protocol invariant itself. It is a real
hardening rule the chat slice depends on. I am only completing the
fixture migration that the original 5.0E commit did not finish.

If the original 5.0E author had a planned follow-up that this work
collides with, the conflict will surface at rebase time and is
resolvable: my changes touch only test fixtures + 3 lint sites,
never the 5.0E production surface.

## Outcome target

- All 90 failing tests pass.
- 3 lint errors resolved.
- 5.0E protocol invariant remains active (not weakened).
- 1.8.6 + 1.8.7 work unchanged.
- CI green.
