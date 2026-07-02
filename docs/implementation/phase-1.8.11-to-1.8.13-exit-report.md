# Phase Exit Report: Phase 1.8.11 + 1.8.12 + 1.8.13 — Final Phase 1.8 deferred work

- Status: Accepted as complete
- Date: 2026-06-05

## Phase scope

Closes the three remaining deferred items called out at the end of
the Phase 1.8.10 exit report:

- **Phase 1.8.11** — external OpenRank adapter package,
- **Phase 1.8.12** — aggregator-event ingestion at the sync-client
  inbound layer,
- **Phase 1.8.13** — cross-device sync opt-in flow (design +
  minimum implementation).

After this slice, the Phase 1.8 reputation graph track has **no
remaining deferred items**.

## Completed work

### Phase 1.8.11 — `@lfp2p/openrank-adapter` package (new)

A NEW workspace package that lives **outside protocol core** per
the Phase 1.8 doctrine. The doctrine boundary is explicit:
adopting OpenRank as a primary dependency would centralise the
trust root. Users opt in by subscribing to an OpenRank-derived
labeler via Phase 1.66; that labeler runs this adapter.

- `packages/openrank-adapter/package.json` declares the package
  name `@lfp2p/openrank-adapter` with `@lfp2p/trust-safety` as its
  only workspace dependency.
- `packages/openrank-adapter/tsconfig.json` extends the base config
  with composite-references to `trust-safety` + `content-addressing`.
- `tsconfig.json` (root) gains the new package reference.
- `src/index.ts`:
  - `OpenRankRow` / `OpenRankResponse` / `OpenRankFetcher` /
    `OpenRankFetchRequest` / `OpenRankAdapterOptions` type
    surface.
  - `createOpenRankAdapter(options) → OpenRankAdapter` factory.
    Validates `labelerId` non-empty + `fetcher` is a function;
    returns a frozen handle.
  - `fetchAggregatorEvents` method:
    - calls the caller-supplied `fetcher` (the adapter NEVER
      touches the network itself — auth and network are the
      caller's surface);
    - validates the response shape (non-object / missing rows →
      throw);
    - per-row hardening: clamps `score` / `confidence` to `[0, 1]`,
      truncates `observationCount` to a safe non-negative integer,
      drops malformed rows silently rather than throwing;
    - normalises numeric Farcaster `fid` to a documented
      `actor:fid:<n>` string form;
    - sorts subjects by ascending actor id (replay-deterministic);
    - splits over-cap batches into multiple `AggregatorEventWithSource`
      records, mirroring the Phase 1.8.1
      `REPUTATION_LIMITS.maxSubjectsPerAggregatorBatch`;
    - returns frozen output.
- 12 new tests including: constructor validation, happy-path
  mapping, numeric fid normalisation, deep-frozen output, sort
  determinism, score/confidence/observationCount clamping (NaN /
  Infinity / negative / out-of-range), individual-row drops for
  malformed entries, over-cap batch splitting, fail-closed on
  structural issues (non-object / missing rows), end-to-end with
  the Phase 1.8.4 `computeAggregatedReputation` runtime.

### Phase 1.8.12 — Sync-client inbound reputation ingestion (`packages/sync-client/src/inbound-reputation.ts`)

Adds a NEW inbound pipeline parallel to the existing
`processInboundSyncBatch` — but for reputation events (their own
event family separate from the protocol-layer `EventKind` union).

- `InboundReputationRecord = { publisherLabelerId, event, receivedAt? }`.
- `ProcessInboundReputationInput = { store, records, subscribedLabelers (Set), now? }`.
- `ProcessInboundReputationResult = { received, applied, dropped, rejected, errors }`.
- `REPUTATION_DROP_REASONS` frozen tuple: `'not-subscribed'`,
  `'policy-not-subscribable'`.
- **Opt-in discipline preserved**: aggregator events from labelers
  NOT in `subscribedLabelers` are silently dropped (counted in
  `dropped`).
- **Conservative scope**: observation / attestation / revocation
  events are dropped with `policy-not-subscribable` — those kinds
  are user-emitted-locally today, and cross-device sharing is
  governed by the Phase 1.8.13 policy + the future Phase 5.0
  envelope wrapping.
- **Validator backstop**: every record is re-validated via
  `validateReputationEvent` before persistence. The store layer
  also re-validates as defense-in-depth.
- **Idempotent persistence**: duplicate inbound events become
  silent no-ops at the store layer (primary-keyed on `eventId`).
- Public-surface re-exports through `packages/sync-client/src/index.ts`.
- 13 new tests covering: input validation; aggregator publish flow;
  subscription discipline (subscribed / non-subscribed / empty
  publisher); idempotent eventId; score.removed flow;
  observation / attestation / revocation all dropped; invalid
  event content rejected; frozen REPUTATION_DROP_REASONS.

### Phase 1.8.13 — Cross-device sync opt-in policy (`apps/pwa/src/pwa-reputation-sync-policy.ts`)

User-facing PREFERENCE that prepares the doctrine-mandated default
("device-local") for a future opt-in elevation to `account-local`.
The actual envelope wrapping that consumes this preference ships
with Phase 5.0; this slice ships the user's intent layer
explicitly.

- `REPUTATION_SYNC_POLICY_VERSION = 'lfp2p.reputation-sync-policy.v1'`.
- `REPUTATION_SYNC_SCOPES` frozen tuple: `'device-local'`,
  `'account-local'`. **`public` is deliberately NOT a valid
  per-user choice** — broadcast publication is a separate flow
  reserved for aggregator labelers.
- `REPUTATION_USER_EMIT_KINDS` frozen tuple: `'observation'`,
  `'attestation'`, `'revocation'` (aggregator events originate at
  the aggregator, not the user).
- `DEFAULT_REPUTATION_SYNC_POLICY` — all three kinds default to
  `device-local` (doctrine non-negotiable #2).
- `resolveReputationPrivacy(policy, kind, override?)` — pure
  resolver. Caller override > stored policy > doctrine default.
  Unknown overrides fall through to policy (defense-in-depth).
- `normaliseReputationSyncPolicy(input)` — fail-closed normaliser
  that returns a frozen, doctrine-shape record. Throws ONLY on
  non-object input; missing / corrupt fields fall back to default.
- `loadReputationSyncPolicy(storage?)` / `saveReputationSyncPolicy(next, storage?)` /
  `resetReputationSyncPolicy(storage?)` — localStorage-backed
  persistence. Optional `storage` injection for test
  determinism. Absent storage (SSR / Node) silently returns
  default. Corrupt JSON at rest → default (fail closed on read).
  Save normalises before writing — a corrupt blob CANNOT be
  persisted.
- **UI integration**: `PwaReputationSettings` gains a new
  "Cross-device sync policy" section with per-kind scope
  selectors. The section surfaces the doctrine default + an
  explicit notice that the `account-local` flow itself ships with
  Phase 5.0 — until then every kind is treated as `device-local`
  regardless of the choice.
- 19 new tests covering: doctrine defaults frozen; enum + emit-kind
  tuples frozen + `public` excluded; resolver precedence; unknown
  override fail-through; normaliser shape recovery; load/save
  round-trip; corrupt-blob → default on read; save normalises
  before writing; reset clears stored preference; absent storage
  graceful path; save rejects non-object inputs.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1561 passing (1517 → 1561, +44)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                                                      | Status | Evidence                                                   |
| ---------------------------------------------------------------------------------------------- | :----: | ---------------------------------------------------------- |
| OpenRank adapter is a SEPARATE workspace package, not in protocol core                         |   ✓    | new `packages/openrank-adapter` package                    |
| Adapter never touches the network itself (caller-supplied fetcher)                             |   ✓    | `OpenRankFetcher` interface; tests use deterministic mocks |
| Adapter clamps score / confidence / observationCount and drops malformed rows                  |   ✓    | dedicated tests                                            |
| Adapter splits over-cap batches deterministically                                              |   ✓    | dedicated test at cap+5 boundary                           |
| Sync-client inbound: opt-in discipline preserved (subscribed-labelers only)                    |   ✓    | 4 dedicated tests                                          |
| Sync-client inbound: observation/attestation/revocation dropped (deferred to 1.8.13 elevation) |   ✓    | 3 dedicated tests                                          |
| Sync-client inbound: idempotent on eventId                                                     |   ✓    | dedicated test                                             |
| Cross-device sync policy: default = device-local (doctrine non-negotiable #2)                  |   ✓    | dedicated test                                             |
| `public` is not a valid per-user scope choice                                                  |   ✓    | dedicated test + structural enum exclusion                 |
| localStorage persistence with corrupt-blob fail-closed-on-read                                 |   ✓    | dedicated test                                             |
| Save normalises before writing — corrupt blob cannot land on disk                              |   ✓    | dedicated test                                             |
| UI surfaces the doctrine default + the "account-local pending Phase 5.0" notice                |   ✓    | new section in `PwaReputationSettings`                     |

## What remains conditionally deferred

These items are no longer "deferred Phase 1.8 follow-ups" — they
depend on slices outside the 1.8 track:

- **Actual envelope wrapping of reputation events for
  `account-local` sync.** Depends on Phase 5.0 (ADR-002 private
  payload envelope) shipping first. The user's stated preference
  (Phase 1.8.13 policy) is the contract this future code consumes.
- **Sync-client outbox wiring for reputation events.** Once
  envelopes wrap, the existing outbox machinery routes them to
  the bridge. No new sync-client code is expected — the existing
  surface handles it.
- **Inbound consumption of observation / attestation /
  revocation events from the user's OTHER devices** (own-account
  cross-device replication). Today these are dropped by Phase
  1.8.12 as `policy-not-subscribable`; once Phase 5.0 lands and
  signatures + envelope authors are available, the inbound
  pipeline can admit events whose signing identity matches the
  user's own controller.

## Decision

- [x] accepted as complete

Reason: every deferred item from the Phase 1.8.10 exit report is
now shipped to the extent it can be without depending on the
out-of-track Phase 5.0 envelope work. The OpenRank adapter package
proves the doctrine boundary (external, opt-in, runs HTTP-to-event
mapping outside the protocol core). The sync-client inbound
pipeline closes the bridge-to-store loop for aggregator events with
strict opt-in discipline. The cross-device sync policy + UI ships
the user's intent layer so it's ready to consume when the
envelope-wrapping work lands. Phase 1.8 is now complete.
