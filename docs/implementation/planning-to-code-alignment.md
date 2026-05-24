# Planning-to-Code Alignment

This document compares the original planning documents with the current implementation. The planning docs are not wrong because they describe future architecture. This matrix exists to show where code already follows the plan, where it implements a first slice, and where work is intentionally deferred.

## Alignment summary

| Planned area | Current implementation state | Alignment | Notes |
|---|---:|---:|---|
| PWA-first light peer | Implemented foundation | Strong | The PWA writes signed events locally, stores local summaries, and queues outbox entries before network confirmation. |
| Framework7 React + Vite | Implemented foundation | Strong | Current app shell matches frontend plan. |
| Dexie operational local store | Implemented foundation | Strong/partial | Signed events, outbox, event summaries, device identities, local protection keys exist. Contacts, media, sync offsets do not yet. |
| PGlite local query/search | Implemented early slice | Partial | Current search is basic escaped `LIKE`; richer FTS/hybrid/vector plan is not implemented. |
| TanStack Query boundary | Implemented initial boundary | Strong | Present as provider; not used as local-first source of truth. |
| Signed durable events | Implemented foundation | Strong/partial | Event envelopes are signed. Protocol fixture discipline is still missing. |
| Source references | Implemented basic type | Partial | `SourceRef` exists, but broader source provenance model is not yet integrated through search/media/bridge. |
| Local device identity | Implemented early slice | Partial | Device bootstrap and encrypted local private-key material exist. Root/controller identity and identity-control log do not. |
| Identity control log | Not started | Deferred | Needs ADR and protocol fixtures before code. |
| Capability delegation | Not started | Deferred | Needs identity-control model first. |
| Revocation epochs/checkpoints | Not started | Deferred | Must not be approximated by wall-clock-only logic. |
| Bridge as non-authoritative infrastructure | Implemented foundation | Strong | Bridge verifies signatures, handles idempotency, and does not define private source-of-truth state. |
| Bridge response as untrusted input | Implemented and hardened | Strong | PR #19 hardened malformed/invalid response handling and avoided duplicate parser logic. |
| Durable Streams/WebSocket bridge | Not started | Deferred | Needs sync offsets/cursors and threat model first. |
| Persistent full/super peer | Not started | Deferred | Future native/Bare/Holepunch-compatible path. |
| Corestore/Hypercore/Autobase target | Not implemented in repo | Deferred | Planning target remains intact; current PWA uses browser adapters first. |
| Chat/room model | Not started | Deferred | Needs room event protocol, deterministic apply pipeline, and payload encryption policy. |
| MLS private-group encryption | Not started | Deferred/needs ADR | Must not be improvised; requires virtual Delivery Service decision and library evaluation. |
| Media manifests | Not started | Deferred | Needs media manifest protocol and hash/encryption/variant policy. |
| Presence plane | Not started | Deferred | Must remain ephemeral and outside durable logs. |
| Social outbox model | Not started | Deferred | Current outbox is mutation delivery infrastructure, not social outbox semantics. |
| Naming/petnames/contact cards | Not started | Deferred | Protocol has placeholder petname event kind only. No storage/UI/name proof model. |
| Local intelligence/hybrid search | Implemented early search seed | Partial | PGlite package is a seed; no permission-aware SearchObject, vectors, or fusion yet. |
| Compression/chunking/dedupe | Not started | Deferred | Needs CompressionDescriptor and safety policy. |
| Service worker/offline shell | Not started | Deferred | PWA is local-first at app-store level, but offline shell caching policy is not implemented. |
| ADR/threat-model discipline | Not started | Gap | Templates added in this docs cleanup; actual ADR-000 and threat models still need to be written. |

## Important distinctions

### Mutation outbox vs social outbox

The current `mutationOutbox` is an operational delivery queue for local writes. It is not the full planned personal public social outbox log.

Do not reuse the term `outbox` ambiguously in future docs or code. When needed, use explicit names:

- `mutationOutbox` for local retry/delivery queue.
- `publicSocialOutbox` or protocol-specific equivalent for authored public social events.

### Local device identity vs account identity

The current identity implementation is a local device session bootstrap. It should not be treated as the final account identity model.

Planned account identity still requires:

- root/controller identity,
- identity control log,
- device authorization and revocation,
- capability delegation,
- recovery and supersession,
- epochs/checkpoints.

### Search projection vs intelligence layer

The current search package is a small local projection. It is useful foundation work, but it is not the planned permission-aware hybrid intelligence layer.

Before search grows, define:

- `SearchObject`,
- source provenance rules,
- permission partitions,
- deletion/revocation behavior,
- model-versioning for future embeddings.

### Bridge primitives vs production infrastructure

The bridge service has meaningful code now, but it is not yet a production bridge runtime. It lacks auth, rate limits, deployment config, observability, sync offsets, and encrypted mailbox/resumable stream behavior.

## What should not change

The planning docs intentionally keep the full architecture target visible. Do not delete or flatten the future full-peer, media, naming, MLS, or local intelligence architecture just because the current code is earlier.

Instead, keep current-state docs accurate and use ADRs when implementation chooses a different path.
