# ADR-015: MLS Library Selection v1

- Status: Proposed
- Date: 2026-07-01
- Roadmap phase: Phase 6 — MLS private group encryption v1
- Related docs:
  - `docs/adr/012-mls-dependency-and-group-keying-v1.md`
  - `docs/specification/08-security/mls-group-keying.md`
  - `docs/specification/08-security/mls-virtual-delivery-service.md`
  - `docs/implementation/mls-group-control-spec-promotion.md`
- Depends on:
  - ADR-012 MLS dependency decision (adapter boundary, no in-house MLS stack)
  - `packages/mls-group-projection` (Phase 4 group-control records)
- Updates: ADR-012 (completes the dependency evaluation ADR-012 deferred)

## Context

ADR-012 committed the protocol to MLS (RFC 9420) behind an `MlsProvider` adapter boundary and deferred the concrete library choice. It directed evaluation of `mls-ts` (Matrix) for the browser and OpenMLS / `mls-rs` via WASM for native runtimes.

Phase 6 needs a concrete v1 provider. The primary runtime is the PWA: a browser environment where bundle size, cold-start latency, storage integration (Dexie/IndexedDB), and toolchain simplicity dominate. The evaluation criteria, in priority order:

1. RFC 9420 conformance, verified against the official interop test vectors.
2. Browser viability: bundle size, no native toolchain requirement, IndexedDB-compatible state storage.
3. Ciphersuite support including `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (Ed25519 credentials align with the protocol identity model).
4. Pluggable storage and crypto providers (the protocol owns persistence and key custody).
5. Maintenance reality and license compatibility.
6. A credible path for the future native/full-peer runtime (Phase 20) without changing protocol objects.

### Candidates evaluated

| Candidate | Language | Browser path | Assessment |
|---|---|---|---|
| `ts-mls` | TypeScript | native (no WASM) | RFC 9420 implementation in pure TypeScript, validated against the official MLS test vectors; supports the required ciphersuite; small dependency surface (audited noble-style primitives); integrates directly with TypeScript fixtures and Dexie persistence. Young project with a small maintainer base. |
| OpenMLS | Rust | wasm32 + bindings | Mature, actively maintained, externally reviewed. WASM bundle is large for a PWA budget; state/storage traits cross the JS↔WASM boundary awkwardly (custom storage provider glue, serialization churn); adds a Rust toolchain to CI for a docs-and-TypeScript monorepo. |
| `mls-rs` | Rust | wasm32 (supported) | Production-grade (AWS), FIPS-capable, actively maintained. Same WASM boundary and toolchain costs as OpenMLS; API is oriented to Rust/FFI consumers. Strongest candidate for the future native/full-peer runtime. |
| `mlspp` | C++ | Emscripten/WASM | Proven in large deployments (Cisco; basis of Discord's DAVE). C++/Emscripten toolchain burden is the highest of the set; browser embedding exists but is bespoke per consumer. |
| `mls-ts` (Matrix) | TypeScript | native | Incomplete and effectively inactive. Eliminated; this supersedes ADR-012's direction to evaluate it first. |

## Decision

Adopt **`ts-mls` as the v1 MLS provider** behind the `MlsProvider` boundary for the browser/PWA runtime and TypeScript test fixtures.

Record **`mls-rs` (WASM/native) as the designated second provider** for the native/full-peer runtime (Phase 20). The adapter boundary, golden fixtures, and RFC 9420 wire formats are the compatibility contract between the two; no protocol object may depend on either library's internals.

Do not implement an in-house MLS stack (unchanged from ADR-012).

## Constraints recorded with this decision

- **Ciphersuite pin**: v1 uses `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` only. Additional suites require a spec update and capability negotiation; silent downgrade is prohibited.
- **Bundle budget**: the MLS provider (library + glue) must stay within a 250 KB minified+gzip budget in the PWA. This is the measurable reason a pure-TS provider beats a WASM provider today; if the budget is ever broken, the WASM alternative is re-evaluated on equal footing.
- **Key custody**: private key material is stored by the protocol's local-store (encrypted at rest under `localProtectionKeys`), not by library-internal storage. The provider must accept injected storage.
- **KeyPackage rotation**: Devices maintain a bounded pool of consume-once KeyPackages plus one last-resort KeyPackage; rotation before expiry and replenishment on connectivity are provider-adapter responsibilities (see `mls-virtual-delivery-service.md`).
- **Conformance harness**: the official RFC 9420 interop test vectors are committed as golden fixtures and run in CI against the provider. Any future provider (mls-rs or other) must pass the identical suite plus the repository's group-control fixture suite before substitution.
- **Wire-format discipline**: only RFC 9420 wire objects (KeyPackage, Welcome, PublicMessage/PrivateMessage, GroupInfo) and the signed group-control records cross the provider boundary. Library-specific serialization never persists or replicates.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `ts-mls` is young; maintainer base is small | Adapter boundary + committed conformance vectors make substitution cheap; mls-rs is the named fallback; pin exact versions and review diffs on upgrade |
| Pure-TS crypto performance on large groups | Acceptable for v1 group sizes (chat-scale); benchmark fixture added; WASM provider path exists if tree operations become a bottleneck |
| Library bug produces invalid wire output | Conformance vectors in CI; cross-validation test against a second implementation planned when the mls-rs provider lands |
| Supply-chain compromise of the dependency | Version pinning, lockfile discipline, minimal transitive dependency surface, and the existing repo review rules for dependency bumps |

## Non-goals

- This ADR does not implement the provider, the KeyPackage store, or group messaging.
- It does not select the native-runtime binding details for mls-rs (deferred to the Phase 20 runtime ADR).
- It does not change any protocol object, event kind, or validation rule.

## Follow-up

- Define the `MlsProvider` TypeScript interface (create/join/propose/commit/welcome/encrypt/decrypt/export-checkpoint/report-diagnostics, per the doctrine list in `docs/protocol/mls-group-keying.md`).
- Add `ts-mls` behind the interface with injected storage and key custody.
- Commit RFC 9420 interop vectors as fixtures; wire into CI.
- Bundle-size check in CI against the 250 KB budget.
- Bridge KeyPackage store per ADR-016.

## References

- RFC 9420: The Messaging Layer Security (MLS) Protocol.
- MLS interop test vectors (mlswg/mls-implementations).
- ADR-012: MLS Dependency and Group Keying v1.
- `ts-mls`, OpenMLS, `mls-rs`, `mlspp` project documentation.
