# Phase Exit Report: Phase 4.2 — Bridge admission state persistence

- Status: Accepted as complete
- Date: 2026-06-04

## Phase scope

Phase 4.1 wired the trust-safety transport-admission engine into the
bridge but held its state in process memory only. **A bridge restart
silently reset every rate-limit bucket, peer-reputation score,
replay-cache entry, and quarantine record** — meaning an attacker
could DoS a bridge until it restarts and resume with a fresh budget.
That is a real abuse-resistance gap and the Phase 4.1 exit report
called it out as the natural next slice.

Phase 4.2 closes the gap with a documented `AdmissionStateStore`
interface, two implementations (in-memory + JSON-file), a
fail-closed save discipline, and a cold-load factory that refuses to
start on snapshot corruption.

## Completed work

### `apps/bridge-service/src/admission-state-store.ts` (new)

- `AdmissionStateStore` interface: `load()` returns
  `TransportAdmissionState | undefined` (undefined on cold-start);
  `save(state)` persists atomically; both throw on I/O or
  corruption errors so callers can fail-closed.
- `serializeAdmissionState` / `deserializeAdmissionState` pure
  functions. The only non-JSON-native field
  (`appliedEventIds: ReadonlySet<string>`) is serialized as a
  sorted array and rehydrated as a frozen `Set`. Sorted output
  ensures deterministic on-disk bytes.
- `ADMISSION_STATE_SNAPSHOT_VERSION = 'lfp2p.admission-state-snapshot.v1'`
  pinned. Wrong version → `AdmissionStateCorruptError`.
- `AdmissionStateCorruptError` typed error class for all
  shape-validation failures.
- Deep-freeze on load: rehydrated state passes the Phase 3.2
  integrity-suite invariant (every nested object/array is
  `Object.isFrozen`).
- `InMemoryAdmissionStateStore` for tests + ephemeral
  deployments; round-trips through the same serialize/deserialize
  path as the file store. Exposes a `failNextSaveWith` test hook
  for the fail-closed contract.
- `JsonFileAdmissionStateStore` for production. Writes to a
  sibling temp file (`<filePath>.<pid>.<suffix>.tmp`) then
  `fs.rename`s. POSIX same-filesystem rename atomicity guarantees
  no partial-state on a mid-write crash. Mode `0o600` on the temp
  file so the snapshot isn't world-readable. Cold start (file
  not found, `ENOENT`) returns undefined; any other error
  propagates.

### `BridgeAdmissionGateway` (extended)

- New optional `stateStore` constructor option.
- `static async create(options)` factory: pre-loads any persisted
  state and refuses to start on corruption. A returned gateway is
  ready for immediate admit calls.
- New `admitAndPersist(request, nowMs, context?)` method. Persists
  the new state via `stateStore.save` BEFORE advancing the
  in-memory reference. A save failure throws and the in-memory
  state DOES NOT advance — the fail-closed contract. When no
  store is configured the method's observable behaviour is
  identical to `admit` (no I/O side effect).

### `BridgeService.acceptDelivery` (extended)

- Now calls `this.#admission.admitAndPersist(...)` (Phase 4.1 used
  the synchronous `admit`). The change is internal: the wrapping
  flow stays the same and existing Phase 4.1 tests pass
  unmodified.
- Persistence failures become a rejection with reason
  `admission-persist-failed:<ErrorClassName>` — a stable static
  label, never the underlying IO message. Privacy-safe per
  Phase 3.1.

### `BridgeAdmissionGatewayHandle` (type, extended)

- Added `admitAndPersist` to the handle alongside `admit`. The
  service now requires both forms; the existing `admit` stays
  for callers that want explicit synchronous semantics.

### 21 new adversarial tests in `admission-state-store.test.ts`

- **Serialize/deserialize round-trip (3)**: byte-equivalent shape;
  Set rehydration; every nested node deep-frozen.
- **Corruption rejection (5)**: non-object snapshot, wrong version,
  missing state envelope, missing required field, non-string
  member of `appliedEventIds`.
- **InMemoryAdmissionStateStore (3)**: empty load before save;
  save+load round-trip; `failNextSaveWith` hook fires once and
  resets.
- **JsonFileAdmissionStateStore (5)**: cold-start with missing
  file returns undefined; save+load round-trips across distinct
  store instances; corrupt JSON file throws
  `AdmissionStateCorruptError`; wrong-version snapshot throws;
  temp file is gone after a successful save (atomic rename
  invariant).
- **Cold-load factory (3)**: a fresh process picks up a prior
  process's state; cold start with no state begins empty;
  refusal to start on corruption.
- **Fail-closed save (1)**: a save() throw leaves the in-memory
  state at the previous successful admit (reference equality +
  cross-check on `peerReputation`).
- **BridgeService end-to-end (1)**: a save failure inside admission
  becomes a rejected delivery with the doctrine-compliant stable
  reason format, never echoing the underlying IO error message.

### Doctrine

`docs/protocol/bridge-admission-doctrine.md` — the "State
persistence" subsection (previously a deferral note) was replaced
with a Phase 4.2 specification: snapshot-not-event-log rationale,
fail-closed save discipline, atomic-on-disk discipline,
refuse-on-corruption rationale, Set serialization discipline,
pinned wire version, and concurrency expectations.

### Verification

```bash
pnpm typecheck   # clean
pnpm lint        # clean
pnpm test        # 1170 passing (1149 → 1170, +21)
pnpm build       # clean
```

Every existing Phase 4.1 test continued to pass under the new
async `admitAndPersist` path. Backward compat preserved.

## Acceptance criteria

| Criterion                                                               | Status | Evidence                                      |
| ----------------------------------------------------------------------- | :----: | --------------------------------------------- |
| Snapshot persistence interface (`AdmissionStateStore`) shipped          |   ✓    | `admission-state-store.ts`                    |
| In-memory + JSON-file implementations                                   |   ✓    | both classes                                  |
| Round-trip serialize/deserialize preserves every field                  |   ✓    | 3 round-trip tests                            |
| Rehydrated state passes the Phase 3.2 deep-freeze invariant             |   ✓    | dedicated test                                |
| Corrupted snapshots rejected with typed error, never silently discarded |   ✓    | 5 corruption-rejection tests                  |
| Atomic on-disk writes (temp + rename)                                   |   ✓    | atomic-rename test                            |
| Cold-load factory pre-loads persisted state                             |   ✓    | 3 factory tests                               |
| Fail-closed: a save failure does NOT advance in-memory state            |   ✓    | dedicated test                                |
| BridgeService surfaces persistence failures as privacy-safe rejections  |   ✓    | end-to-end test pins reason format            |
| Doctrine documents the persistence layer                                |   ✓    | new section in `bridge-admission-doctrine.md` |

## Deferred work

- **Periodic compaction / pruning.** The replay-cache and audit-log
  components are already self-bounded (TTL + FIFO eviction inside
  the engine). The persistence layer simply writes the engine's
  current state, so no additional pruning is needed today. If a
  future bridge operates at sustained high throughput, a write-
  coalescing layer (snapshot every N admits rather than every
  admit) becomes a natural follow-up.
- **PGlite/SQL-backed `AdmissionStateStore`.** The JSON-file store
  is sufficient for v1; a future deployment that already runs the
  PGlite delivery store may prefer a SQL-backed admission store
  for transactional consistency with delivery records.
- **Multi-bridge advisory reputation propagation.** Per the
  Phase 1.64 doctrine, an operator may consume advisory reputation
  feeds from other bridges. The persistence layer's snapshot is
  per-bridge; multi-bridge fan-in remains future work.
- **Hot key-rotation of `AdmissionConfig.operatorAuthority`.** The
  authority is supplied at gateway construction. Rotation today
  requires reconstructing the gateway with the new authority.

## Decision

This phase is:

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: The documented Phase 4.1 deferral ("admission state lives
in process memory only") is closed. Persistence is atomic on disk,
fail-closed on save errors, refuses to start on corruption, and is
adversarially tested across 21 cases. The bridge restart no longer
resets the abuse-resistance budget.
