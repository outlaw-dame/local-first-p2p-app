# Known Deviations From Original Planning

This file tracks places where the implementation order or shape differs from the original planning documents. A deviation is not automatically a problem. It becomes a problem only if it is hidden, creates duplicate concepts, weakens the doctrine, or blocks future full-peer compatibility.

## Deviation status legend

- **Accepted**: reasonable implementation order or naming difference; no immediate ADR required.
- **Temporary**: acceptable for now, but must be revisited before a related phase advances.
- **Needs ADR**: further implementation should pause until a decision record exists.
- **Risk**: acceptable only with explicit tests/threat model.

## Current deviations

### D1 - Repo started with PWA/local-store/outbox/bridge before Corestore/Hypercore/Autobase chat

Status: **Accepted with guardrails**

Original planning emphasized proving encrypted DM/group chat and identity control early with Corestore, Hypercore, Autobase, and seed peers.

Actual implementation started with:

- PWA shell,
- signed event envelope,
- WebCrypto signing,
- Dexie local store,
- mutation outbox,
- bridge transport,
- bridge service/store hardening.

Why acceptable:

- The first user-facing product is explicitly PWA-first.
- Browser clients were always expected to be light peers, not full native P2P peers.
- Establishing local-first write and bridge safety first is useful.

Guardrails:

- Do not let browser adapters become the canonical protocol.
- Keep protocol objects runtime-neutral.
- Add fixture/conformance discipline before expanding the protocol surface.
- Preserve the full-peer adapter path.

### D2 - Identity implementation started as local device bootstrap, now partially implements identity-control log enforcement

Status: **Temporary / ADR recorded, partially implemented**

The planning docs define a root/controller identity that delegates scoped authority to device keys through an identity control log. The current code now includes identity-control event schemas, projection fixtures, and inbound projection enforcement, while still relying on local device bootstrap for account lifecycle entry.

Why acceptable:

- It enables the PWA local-first vertical slice.
- It exercises local key generation, encryption, persistence, and restore behavior.

Risk:

- Future code may still confuse local device identity bootstrap with full account identity lifecycle.

Required before expansion:

- ADR for root/controller identity model (completed in ADR-001).
- Identity control log protocol objects and fixtures (initial set implemented; broadening and interop coverage still incomplete).
- Inbound sync now enforces and persists identity control projection state atomically with event/checkpoint writes.
- Device add/revoke/rotate semantics across full account workflows and migration paths.
- Capability grant/revoke model for broader runtime authorization decisions (initial enforcement helpers now exist, but end-to-end issuance and UX remain incomplete).
- Epoch/checkpoint verification rules (projection seed monotonic epoch checks implemented; broader migration/interop rules still incomplete).

### D3 - `mutationOutbox` exists before planned public social outbox

Status: **Accepted naming guardrail**

The planning docs discuss a personal public social outbox log. The repo currently has `mutationOutbox`, which is a local retry/delivery queue.

Why acceptable:

- A mutation delivery queue is required for local-first PWA behavior.
- It supports idempotency, retries, stale-claim recovery, and confirmation state.

Guardrail:

- Do not treat `mutationOutbox` as the public social outbox protocol.
- Use explicit naming for future social outbox concepts.

### D4 - Bridge stores exist before encrypted mailbox / Durable Streams bridge

Status: **Accepted / partial Phase 4**

The bridge service currently implements acceptance, idempotency, sequence allocation, TTL/capacity stores, and HTTP response hardening. It does not yet implement encrypted mailbox actors or Durable Streams/WebSocket delivery.

Why acceptable:

- Idempotency and response parsing are foundational bridge safety pieces.
- It keeps bridge state non-authoritative.

Required before production bridge work:

- Bridge compromise threat model.
- Authentication/rate-limit policy.
- Offset/cursor persistence design.
- Encrypted mailbox/resumable stream design.
- Log privacy/observability policy.

### D5 - PGlite search exists before SearchObject and hybrid search protocol

Status: **Temporary**

The planning docs define permission-aware hybrid search, source provenance, named vectors, and embedding lifecycle states. The repo currently has a small PGlite projection with escaped `LIKE` search.

Why acceptable:

- It validates PGlite package wiring and local projection boundaries.
- It does not claim authority over protocol state.

Required before expanding search:

- `SearchObject` design.
- Source provenance rules.
- Permission partition strategy.
- Deletion/revocation lifecycle.
- Worker/index rebuild plan.

### D6 - Private payload encryption is a doctrine rule but not yet a user-facing feature

Status: **Risk / ADR recorded, implementation pending**

The doctrine requires private payloads to be encrypted before untrusted storage. Current code encrypts local private key material, but it does not yet implement general private event payload encryption.

Why acceptable now:

- The current PWA demo event uses `device-local` scope.
- The bridge accepts only `dm`, `group`, and `public`, and rejects `device-local` / `self` by policy.

Required before user-facing private sync:

- Payload encryption ADR (completed in ADR-002).
- Encryption envelope object and fixtures.
- Metadata-leak note.
- Tests proving bridge/seed peers see only ciphertext for private payloads.

### D7 - Architecture PDFs are not committed as Markdown source yet

Status: **Temporary**

The planning PDFs exist as external/source artifacts from the conversation, but the repo currently gets an index and implementation alignment docs rather than full Markdown conversion of each PDF.

Why acceptable:

- This cleanup focuses on development path and drift prevention first.
- The docs index preserves the role and order of the planning set.

Possible future work:

- Convert the seven PDFs into canonical Markdown files under `docs/architecture/original-planning/`.
- Preserve source references and mark them as planning docs, not implementation truth.

## ADR triggers

Add an ADR before implementing any of the following:

- root/controller identity,
- identity control log,
- capability delegation,
- private payload encryption,
- MLS virtual Delivery Service,
- Durable Streams/WebSocket bridge protocol,
- media manifest format,
- naming/namespace proof model,
- SearchObject and hybrid search lifecycle,
- compression/chunking/dedupe descriptors,
- full-peer adapter interfaces.

## Deviation review rule

Every new PR that changes protocol, identity, bridge, media, search, naming, MLS, compression, or storage versioning should update this file or explicitly state that it introduces no new deviation.
