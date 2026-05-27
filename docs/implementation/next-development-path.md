# Next Development Path

This is the recommended path to resume development cleanly from the current codebase.

The immediate goal is not to add user-facing breadth. The immediate goal is to lock down the protocol, identity, bridge, storage, content-addressing, and trust/safety guardrails so later chat/media/search work does not create drift.

## Current working phase

**Phase 1.5 / 3.5 - Doctrine alignment and protocol hardening before feature expansion**

Why this phase exists:

- The PWA local-first foundation exists.
- The bridge/outbox foundation exists.
- Some protocol primitives exist.
- The doctrine requires fixtures, ADRs, threat models, and phase gates before larger feature surfaces.
- Content-addressing and trust/safety are now explicit gates before media, public search, recommendation, public social outbox, and production bridge deployment.

## Completed by prior documentation cleanup

The repo already has the initial process scaffolding that was previously listed as Step 1:

- `docs/adr/000-template.md`
- `docs/threat-model/template.md`
- `docs/implementation/exit-report-template.md`
- `docs/protocol/fixture-policy.md`

Future work should use these templates rather than re-adding them.

## Newly added planning gates

The following planning docs now define required gates before feature expansion:

- `docs/adr/004-trust-safety-moderation-curation-v1.md`
- `docs/protocol/trust-safety-event-policy.md`
- `docs/threat-model/trust-safety-and-abuse.md`
- `docs/implementation/trust-safety-phase-plan.md`
- `docs/adr/005-content-addressing-and-object-references-v1.md`
- `docs/protocol/content-addressing.md`
- `docs/threat-model/content-addressing-abuse.md`
- `docs/implementation/phase-1.56-content-addressing-plan.md`

These docs do not mean the implementation exists yet. They define the next implementation boundaries.

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
- production bridge deployment,
- networked moderation queues,
- public labeler hosting,
- public recommendation/curation expansion,
- public search indexing.

These are valid target features, but building them before the guardrails below risks duplicate protocols, weak safety boundaries, privacy leakage, and unsafe infrastructure behavior.

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
- compatibility expectations for future full-peer adapters,
- content-addressing object versioning,
- trust/safety object versioning.

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

### Step 4 - Bridge compromise threat model

Deliverable:

- `docs/threat-model/bridge-compromise.md`

Status update (2026-05-27):

- Completed by `docs/threat-model/bridge-compromise.md`.

Still required before production bridge work:

- integrate transport admission policy from `docs/protocol/trust-safety-event-policy.md`,
- add bridge-local quarantine/rate-limit event schemas after T&S protocol core exists,
- ensure bridge refusal cannot be interpreted as global deletion.

### Step 5 - Sync offsets/checkpoints before more transport work

Deliverables:

- ADR or design note for sync offsets/cursors.
- local-store schema proposal.
- sync-client contract for offset persistence.

Status update (2026-05-27):

- Completed by `docs/adr/003-sync-offsets-and-cursors-v1.md`.

Implementation still needs:

- local-store checkpoint tests,
- sync-client offset contract tests,
- stale/replay/rewind behavior wired through implementation.

### Step 6 - Identity-control model before identity expansion

Deliverable:

- ADR for root/controller identity and identity control log v1.

Status update (2026-05-26):

- Completed by `docs/adr/001-identity-control-log-v1.md`.

Implementation still needs:

- root/controller identity events,
- projection logic,
- device add/revoke/rotate,
- capabilities,
- epochs,
- contact card,
- deterministic replay tests.

### Step 7 - Payload encryption design before private chat

Deliverable:

- ADR for private payload encryption envelope.

Status update (2026-05-26):

- Completed by `docs/adr/002-private-payload-encryption-envelope-v1.md`.

Implementation still needs:

- envelope schema,
- fixtures,
- encryption/decryption tests,
- private metadata limits,
- bridge log/privacy enforcement.

### Step 8 - Phase 1.56 content addressing and object references

Deliverables:

- `docs/adr/005-content-addressing-and-object-references-v1.md`
- `docs/protocol/content-addressing.md`
- `docs/threat-model/content-addressing-abuse.md`
- `docs/implementation/phase-1.56-content-addressing-plan.md`
- `packages/content-addressing`

Why now:

- T&S subjects/evidence need exact object references.
- Media manifests need `BlockRef` / `ObjectRef` instead of custom hash/CID fields.
- Bridge/relay/super-peer admission needs exact refs for quarantine/dedupe.
- Search/recommendation provenance needs stable object refs.
- Future full-peer storage must not force IPFS, ATProto, or Hypercore-specific identity into the core protocol.

Exit criteria:

- `DigestRef`, `ContentLink`, `BlockRef`, `ObjectRef`, `BundleRef`, and `StorageLocationHint` validators exist.
- Valid and invalid fixtures exist.
- Validators do not fetch, decode, route, or trust location hints.
- Tests reject malformed digests, unsupported codecs, unsafe byte sizes, unsafe compression, bad location hints, and invalid bundle roots.

### Step 9 - Phase 1.6 trust and safety doctrine/protocol core

Deliverables:

- `docs/adr/004-trust-safety-moderation-curation-v1.md`
- `docs/protocol/trust-safety-event-policy.md`
- `docs/threat-model/trust-safety-and-abuse.md`
- `docs/implementation/trust-safety-phase-plan.md`
- `packages/trust-safety`

Why now:

- Public social, search, media, bridge, and recommendation surfaces create abuse and moderation obligations.
- User-local controls must exist before public reach expands.
- Communities need owner/admin/moderator roles without unbounded protocol authority.
- Bridges/relays/super-peers need self-protection tools.
- Labeler/Tagger-agent outputs must be advisory by default and policy/capability-bound when elevated.

Exit criteria:

- T&S protocol types and validators exist.
- Valid and invalid fixtures exist.
- Local user controls are implemented before networked moderation queues.
- Report/appeal/evidence refs use private payload and content-addressing rules.
- Bridge/relay/super-peer admission decisions are scoped and cannot masquerade as global deletion.
- Curation/reach controls are distinct from moderation enforcement.

## First implementation slice after guardrails

After steps 1-7, the safest implementation slice remains:

> **Sync offsets/checkpoints in `local-store` + sync-client offset contract tests**

After the sync/identity/encryption guardrails are stable enough, the next protocol slices should be:

1. **Phase 1.56 content-addressing package**
   - pure types,
   - validators,
   - fixtures,
   - tests.

2. **Phase 1.61 trust-safety protocol core**
   - pure types,
   - validators,
   - fixtures,
   - tests,
   - no runtime moderation enforcement yet.

3. **Phase 1.62 local user controls**
   - block/mute/hide/label preference projections,
   - private by default.

## Quality bar for next code PR

Every next implementation PR should include:

- relevant docs update,
- tests for happy path and malicious/invalid input,
- no duplicate protocol concepts,
- no unversioned durable object shape,
- no private plaintext leakage in logs,
- no bridge/server authority over private canonical state,
- no IPFS assumptions from CID/content-link usage,
- no global deletion semantics from local bridge/community decisions,
- clear statement of whether it changes the phase map or known deviations.
