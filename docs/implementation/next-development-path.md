# Next Development Path

This is the recommended path to resume development cleanly from the current codebase.

The immediate goal is not to add user-facing breadth. The immediate goal is to lock down the protocol, identity, bridge, and storage guardrails so later chat/media/search work does not create drift.

## Current working phase

**Phase 1.5 / 3.5 - Doctrine alignment and protocol hardening before feature expansion**

Why this phase exists:

- The PWA local-first foundation exists.
- The bridge/outbox foundation exists.
- Some protocol primitives exist.
- The doctrine requires fixtures, ADRs, threat models, and phase gates before larger feature surfaces.

## Completed by this documentation cleanup

This PR adds the initial process scaffolding that was previously listed as Step 1:

- `docs/adr/000-template.md`
- `docs/threat-model/template.md`
- `docs/implementation/exit-report-template.md`
- `docs/protocol/fixture-policy.md`

Future work should use these templates rather than re-adding them.

## Non-goals for the next cycle

Do not start these yet:

- production private chat,
- MLS implementation,
- media manifests,
- public social outbox,
- semantic/vector search,
- full native/Bare peer,
- naming/namespace UX,
- compression/chunking/dedupe,
- production bridge deployment.

These are valid target features, but building them before the guardrails below risks duplicate protocols and weak security boundaries.

## Ordered next steps

### Step 1 - Record ADR-000 for runtime/product decision

Deliverable:

- `docs/adr/000-runtime-and-product-surface.md`

Decision to capture:

- PWA-first light peer is the first product.
- The architecture remains hybrid-ready.
- Browser adapters are implementation adapters, not protocol authority.
- Future full-peer adapters must be able to implement the same protocol objects.

Exit criteria:

- No future PR needs to relitigate PWA-first versus native-first for the current phase.

### Step 2 - Add explicit schema/storage versioning policy

Deliverable:

- `docs/implementation/schema-and-storage-versioning.md` or an ADR if the policy affects durable protocol semantics.

Must cover:

- protocol major/minor version rules,
- unknown-version behavior,
- local-store/Dexie migration expectations,
- PGlite schema migration expectations,
- fixture requirements for old/new object shapes,
- compatibility expectations for future full-peer adapters.

Exit criteria:

- Future storage and protocol changes have a written versioning rule.

### Step 3 - Create initial protocol fixture pack

Deliverables:

- `packages/protocol/fixtures/valid/`
- `packages/protocol/fixtures/invalid/`
- tests that load and validate fixtures.

Initial fixture coverage:

- valid signed event envelope,
- invalid event version,
- invalid event kind,
- invalid privacy scope,
- malformed source ref,
- non-canonical/non-finite JSON value rejection,
- signature verification fixture if feasible with current crypto package.

Exit criteria:

- Protocol changes must update fixtures.
- Unknown major versions and malformed inputs are rejected predictably.

### Step 4 - Write bridge compromise threat-model note

Deliverable:

- `docs/threat-model/bridge-compromise.md`

Must cover:

- forged bridge confirmations,
- malformed bridge responses,
- stale confirmations,
- duplicate delivery,
- reordered delivery,
- bridge data loss,
- bridge replay,
- bridge returning events it did not receive,
- metadata exposure,
- current mitigations and missing mitigations.

Exit criteria:

- Existing bridge hardening has a documented threat model.
- Missing bridge controls are explicit before production runtime work.

### Step 5 - Design sync offsets/checkpoints before more transport work

Deliverables:

- ADR or design note for sync offsets/cursors.
- local-store schema proposal.
- sync-client contract for offset persistence.

Why now:

- Durable Streams/WebSocket bridge readers require durable offsets.
- Reconnect/resume correctness cannot be added safely without a storage contract.

Exit criteria:

- A future PR can implement offsets without guessing schema or semantics.

### Step 6 - Decide identity-control model before identity expansion

Deliverable:

- ADR for root/controller identity and identity control log v1.

Must decide:

- root/controller key representation,
- device key representation,
- identity event kinds,
- epoch/checkpoint semantics,
- revocation behavior,
- local device bootstrap migration path,
- capability object shape,
- recovery/supersession placeholder.

Exit criteria:

- Future identity code extends the doctrine model instead of hardening the current local device bootstrap into the wrong abstraction.

### Step 7 - Payload encryption design before private chat

Deliverable:

- ADR for private payload encryption envelope.

Must decide:

- what is encrypted,
- what metadata remains visible,
- scope-specific handling for `self`, `dm`, `group`, and future room scopes,
- key wrapping approach before MLS,
- how payload encryption later composes with MLS,
- test fixtures and failure modes.

Exit criteria:

- No private user-facing chat/social payload leaves the device without an explicit encryption contract.

## First implementation slice after guardrails

After steps 1-4, the safest implementation slice is:

> **Sync offsets/checkpoints in `local-store` + sync-client offset contract tests**

Why this slice:

- It continues current bridge/outbox work.
- It is required for Durable Streams/WebSocket readers.
- It does not force premature identity, chat, MLS, or media decisions.
- It improves correctness for reconnect/resume without expanding user-facing scope.

Suggested files:

- `packages/local-store/src/index.ts`
- `packages/local-store/src/index.test.ts`
- `packages/sync-client/src/index.ts`
- `packages/sync-client/src/index.test.ts`
- possibly `docs/adr/001-sync-offsets-and-checkpoints.md`

Expected tests:

- create/update sync checkpoint,
- reject invalid source/cursor values,
- idempotently advance offset,
- do not rewind offset unless explicit policy allows,
- persist across store reopen,
- isolate offsets by source/stream/scope.

## Quality bar for next code PR

Every next implementation PR should include:

- relevant docs update,
- tests for happy path and malicious/invalid input,
- no duplicate protocol concepts,
- no unversioned durable object shape,
- no private plaintext leakage in logs,
- no bridge/server authority over private canonical state,
- clear statement of whether it changes the phase map or known deviations.
