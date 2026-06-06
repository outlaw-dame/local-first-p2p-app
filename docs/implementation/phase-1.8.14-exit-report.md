# Phase Exit Report: Phase 1.8.14 — Reputation events as first-class protocol kinds + automatic sync-client dispatch

- Status: Accepted as complete
- Date: 2026-06-06

## Phase scope

Closes the "dispatch gap" the user identified after Phase 1.8.12:
the `processInboundReputationBatch` pipeline existed and was
well-tested, but nothing called it from a real network source
because reputation events were not in the protocol-layer
`EventKind` union. This phase:

1. Promotes the five reputation event kinds to first-class
   `EVENT_KINDS` entries in `@lfp2p/protocol`.
2. Adds privacy + cross-pin enforcement at the protocol boundary so
   an envelope built with the wrong privacy or a payload that drifts
   from the envelope fails BEFORE bridge admission sees it.
3. Wires automatic dispatch in `processInboundSyncBatch` so a
   labeler-signed aggregator envelope arriving over the bridge is
   stored AND projected to the reputation log in a single inbound
   pass, with caller-controlled subscription gating.
4. Upgrades `appendTrustSafetyReputationEvent` to return
   `'stored' | 'skipped'` so idempotent re-deliveries are counted
   honestly instead of as fresh applications.
5. Ships an end-to-end test exercising the full loop:
   labeler outbox → HTTP bridge → bridge admission → inbound HTTP
   pull → `processInboundSyncBatch` → trust-safety reputation log.

After this slice, an aggregator labeler running anywhere can
publish reputation scores to a subscribed user's device with NO
additional plumbing. The "method of dispatch" question is answered
end-to-end.

## Completed work

### Phase 1.8.14.A — Protocol layer: reputation kinds as first-class

`packages/protocol/src/index.ts`:

- `EVENT_KINDS` extended with the five reputation kinds:
  `reputation.observation.recorded`,
  `reputation.attestation.published`,
  `reputation.attestation.revoked`,
  `reputation.aggregator.published`,
  `reputation.aggregator.score.removed`.
- New `REPUTATION_KIND_ALLOWED_PRIVACY` frozen table pins the
  doctrine privacy rules:
  - Aggregator kinds: `public` ONLY (labelers broadcast).
  - Observation / attestation / revocation kinds:
    `device-local` OR `self`. `self` reserved for the Phase 5.0
    envelope-wrapped cross-device flow.
- New `REPUTATION_EVENT_PAYLOAD_VERSION` sentinel exported.
- New `isReputationEventKind(value)` public predicate for downstream
  routers.
- `validatePayloadForKind` extended with five reputation cases:
  structural checks (`version` sentinel match,
  `eventId` / `kind` / `createdAt` non-empty strings, ISO date) +
  privacy enforcement via `requirePrivacyForReputationEvent`.
- New `validateReputationEnvelopeConsistency` runs after the
  switch and cross-pins:
  - `payload.eventId === envelope.eventId`,
  - `payload.kind === envelope.kind`,
  - `payload.createdAt === envelope.createdAt`.
  An envelope whose inner payload drifts from the outer envelope
  fails at the protocol boundary — BEFORE bridge admission, BEFORE
  any persistence layer, BEFORE the semantic
  `@lfp2p/trust-safety::validateReputationEvent`.
- New `requireObjectExactString` helper used by the
  `version` sentinel check.

**11 new protocol-layer tests** in `packages/protocol/src/index.test.ts`:
`isReputationEventKind` narrowing, aggregator + observation
happy-path construction, privacy mismatch rejection for both
families, cross-pin drift rejection for `eventId` / `kind` /
`createdAt`, inner-version sentinel rejection, non-string required
field rejection.

### Phase 1.8.14.B — Sync-client routing: automatic dispatch

`packages/sync-client/src/index.ts`:

- `ProcessInboundSyncInput` extended with TWO optional fields:
  - `subscribedLabelers?: ReadonlySet<string>` — opting in enables
    automatic reputation projection;
  - `labelerIdForAuthor?: (authorId: string) => string | undefined` —
    optional mapper for tenants whose envelope.author isn't the
    labeler id verbatim. Default: identity mapping.
- `ProcessInboundSyncResult` extended with optional `reputation`
  field (`InboundReputationDispatchSummary`):
  `applied / dropped / rejected / errors`. Present ONLY when the
  caller opted in via `subscribedLabelers` — back-compat for every
  existing caller.
- `processInboundSyncBatch` extended with the routing block:
  - After `putSignedEventWithSyncCheckpoint` succeeds **with
    `status === 'stored'`** (idempotency: a duplicate envelope at
    the checkpoint layer is the FIRST line of replay defense),
    dispatch fires for reputation kinds.
  - New private `dispatchInboundReputationEnvelope` enforces:
    - non-aggregator kinds dropped as defense-in-depth (the
      protocol's privacy rule already prevents them from riding
      `public` envelopes, but the dispatch refuses regardless);
    - empty publisher id (after mapping) → drop;
    - publisher NOT in `subscribedLabelers` → drop;
    - semantic validation via `validateReputationEvent` (range
      bounds, subject enums, observation counts) — failure surfaces
      as a privacy-safe error row with no payload bytes;
    - persistence via `appendTrustSafetyReputationEvent` — status
      `'stored'` increments `applied`, `'skipped'` increments
      `dropped` (the SECOND line of replay defense at the reputation
      log itself).
  - Failures NEVER throw from the dispatch — the bridge inbound
    stream MUST keep forward progress on the checkpoint even if a
    single reputation event is hostile.

`packages/local-store/src/index.ts`:

- `appendTrustSafetyReputationEvent` now returns
  `AppendTrustSafetyReputationEventResult = { status: 'stored' | 'skipped' }`.
  Callers that ignore the return value (the PWA emit helpers, the
  trust-safety persistence test) continue to work unchanged. The
  sync-client paths use the return to count honestly.

`packages/sync-client/src/inbound-reputation.ts` (Phase 1.8.12 surface):

- Updated to honor the new return contract: `'stored'` increments
  `applied`, `'skipped'` increments `dropped`. The 1.8.12 idempotency
  test was updated to reflect the new semantics: a duplicate event
  is `dropped: 1` not `applied: 1`.

**11 new sync-client routing tests** in
`packages/sync-client/src/inbound-sync-reputation.test.ts`:

- subscribed labeler → envelope stored AND projected;
- unsubscribed labeler → envelope stored but NOT projected;
- `labelerIdForAuthor` mapper used correctly;
- mapper returning `undefined` → dropped;
- caller omits `subscribedLabelers` → no `reputation` field in
  result (back-compat assertion);
- replay (envelope already in reputation log) →
  `dropped: 1` not `applied: 1`;
- semantic-validator failure → `rejected: 1` + error row, batch
  continues;
- empty-after-mapping author → dropped;
- mixed batch (identity + reputation in same inbound pull) →
  identity unaffected, reputation projected correctly;
- empty `subscribedLabelers` Set → everything dropped;
- multi-envelope projection preserves insertion order.

### Phase 1.8.14.C — End-to-end + ship

**3 new end-to-end tests** in
`packages/sync-client/src/http-bridge-reputation-e2e.test.ts`:

- Labeler signs `reputation.aggregator.published` envelope →
  outbox-processes to in-memory bridge → inbound HTTP pull surfaces
  the record → `processInboundSyncBatch` with subscribed labeler
  set → envelope landed in `signedEvents`, projection landed in
  `trustSafetyReputationEvents`, `loadReputationEvents()` replays
  the event shape-identical to what the labeler signed
  (replay-deterministic boundary preserved).
- Same flow with the user NOT subscribed to the labeler → envelope
  stored, reputation projection rejected (doctrine non-negotiable
  #1 preserved end-to-end).
- Replay test: re-running the SAME inbound records is a no-op at
  the checkpoint layer (skipped at the envelope boundary) AND would
  also be a no-op at the reputation log (defense in depth).

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1586 passing (1561 → 1586, +25)
pnpm build       # clean
```

## Acceptance criteria

| Criterion | Status | Evidence |
|---|:---:|---|
| Five reputation kinds in protocol `EVENT_KINDS` | ✓ | `EVENT_KINDS` tuple + `isReputationEventKind` predicate |
| Aggregator events MUST use `public` privacy | ✓ | dedicated test in `index.test.ts` |
| Observation / attestation / revocation MUST use `device-local` or `self` | ✓ | dedicated tests in `index.test.ts` |
| Cross-pin envelope vs payload identity fields (eventId / kind / createdAt) | ✓ | 3 dedicated drift-rejection tests |
| Inner payload `version` sentinel enforced | ✓ | dedicated test |
| `processInboundSyncBatch` routes aggregator envelopes to reputation log on opt-in | ✓ | E2E test + 11 unit tests |
| Subscription gate prevents unsubscribed-labeler injection | ✓ | E2E test "not-subscribed" |
| `labelerIdForAuthor` mapper composable | ✓ | dedicated test + undefined-fall-through test |
| Idempotency-aware counting (`applied` reflects only NEW state) | ✓ | dedicated replay test |
| Bridge inbound stream continues forward on hostile reputation event | ✓ | dedicated test (batch does NOT abort on semantic failure) |
| `appendTrustSafetyReputationEvent` returns `'stored' / 'skipped'` | ✓ | `AppendTrustSafetyReputationEventResult` exported |
| Backward compat: callers without `subscribedLabelers` see no `reputation` field | ✓ | dedicated test |
| Privacy-safe error messages (no payload bytes in reputation errors) | ✓ | structural review + dispatch implementation pin |

## What remains conditionally deferred

Same as the Phase 1.8.13 exit report — all blocked on Phase 5.0
(ADR-002 private payload envelope):

- Cross-device sync of observation / attestation / revocation
  events for the user's own account. The protocol now PERMITS
  `self` privacy on these kinds, but `self` requires the private
  payload envelope wrapping, which is Phase 5.0 territory.
- Sync-client outbox wiring for reputation events. The new
  protocol-layer kinds make this trivial once the envelope is
  available — `processOutboxBatch` already routes any
  `SignedEventEnvelope`.

Separately, the user asked about **default labeler registries**
(making T&S effective out of the box without making any specific
labeler mandatory). That is a fresh design slice — flagged as
Phase 1.8.15 for explicit user direction. The doctrine boundary
matters: shipping N independent default labelers that the user can
opt out of is consistent with non-negotiable #1; shipping ONE
mandatory labeler is not.

## Decision

- [x] accepted as complete

Reason: the user identified the dispatch gap explicitly ("what is
the method of dispatch?") and asked for the wiring to be completed.
This phase closes the loop end-to-end. The protocol layer now
recognises reputation events as first-class kinds with strict
privacy + cross-pin enforcement; the sync-client routes them
automatically; the local-store idempotency contract is honest about
duplicates; the bridge-to-store-to-projection loop is pinned by an
end-to-end test. The user's underlying T&S concern — that the
reputation surface is structurally peripheral — is addressed:
reputation is now a core protocol event family with the same
admission discipline as identity events, while preserving every
doctrine non-negotiable (per-user, opt-in, local-always-#0).
