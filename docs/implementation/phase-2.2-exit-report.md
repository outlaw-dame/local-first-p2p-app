# Phase Exit Report: Phase 2.2 — Identity-event persistence + PWA emit wiring

- Status: Accepted as complete
- Date: 2026-06-03

## Phase scope

Phase 2.2 lifts the Phase 2.1 protocol-core work into the persistence
and PWA layers, mirroring how Phase 1.70.B lifted Phase 1.66/1.69
into Dexie + the PWA. Concretely:

1. Fix a Phase 2.1 follow-on regression: the inbound sync dispatch
   was silently dropping the two new identity event kinds
   (`identity.device.rotated`, `identity.contact-card.published`).
   The events were stored as signed events but did not update the
   projection.
2. Extend `StoredIdentityControlProjection` with
   `contactCardPublication` and propagate it through the inbound
   apply path.
3. Add `appendLocalIdentityEvent` and `listLocalIdentityEvents` to
   `DexieLocalFirstStore` so locally-emitted identity events go
   through a single atomic, idempotent, validator-pinned entry point.
4. Add PWA emit helpers (`apps/pwa/src/pwa-identity-emit.ts`):
   `emitContactCardPublishedEvent` (wired into the existing
   contact-card export flow) and `emitDeviceRotatedEvent`
   (helper for the future rotation UI).
5. Ship `docs/protocol/revocation-realism.md` doctrine pinning what
   revocation does and does not guarantee. This was an
   external-architecture-review item scheduled for Phase 2.2.

## Completed work

### Regression fix — sync-client identity dispatch

`@lfp2p/sync-client/isIdentityControlEvent` was authored before
Phase 2.1 added `identity.device.rotated` and
`identity.contact-card.published`. The dispatch returned `false` for
both kinds, so `processInboundSyncBatch` would persist the signed
event but skip the projection-update callback. Phase 2.2 adds the
two kinds to the switch:

```ts
case 'identity.device.rotated':
case 'identity.contact-card.published':
  return true;
```

Pinned by `packages/sync-client/src/phase-2.2.test.ts` (the
"inbound dispatch regression" describe block).

### `@lfp2p/local-store` extensions

- New shape: `StoredIdentityContactCardPublication`
  (`{ contactCardDigest, capturedAt, publishedAt }`).
- `StoredIdentityControlProjection` now carries optional
  `contactCardPublication`.
- New method `appendLocalIdentityEvent(event, projectionUpdate, options)`:
  - validates the signed envelope,
  - transactionally writes `signedEvents` + `identityControlProjections`,
  - idempotent on `eventId` (a re-append returns the persisted
    projection without re-applying — re-applying a Class B/C event
    a second time would otherwise either no-op or throw),
  - rejects a projection-update result whose `identityId` does not
    match `event.author`.
- New method `listLocalIdentityEvents(identityId)`: returns every
  locally-stored identity event for the author, sorted by
  `createdAt`. Intended for caller-side reseed via
  `seedIdentityControlProjection`. Deliberately does not import
  from `@lfp2p/identity` (would create a circular dep);
  identity-package consumers do the seed at the call site.

### `@lfp2p/sync-client` follow-through

- `applyIdentityControlProjectionUpdate` now forwards
  `contactCardPublication` onto the persisted snapshot.
- `toIdentityControlState` (the inverse mapping used to seed the
  apply call from the persisted snapshot) also carries the field.

### PWA emit helpers

`apps/pwa/src/pwa-identity-emit.ts` (new):

- `identityProjectionUpdate`: the canonical bridge from
  `@lfp2p/identity`'s frozen `IdentityControlState` to the
  persistence-layer snapshot. Identical in semantics to the
  sync-client inbound-path callback.
- `contactCardDigestRef(serialized)`: returns
  `sha-256:<base64url>` matching `validateIdentityEvent`'s
  `DIGEST_REF_PATTERN`.
- `emitContactCardPublishedEvent(input)`: build + sign + append.
  Idempotent on `eventId`. Wired into the existing
  `exportContactCard` flow in `root-app.tsx` — exporting a contact
  card now records a publication-audit event with the digest. UX
  status reports the failure but does not block the export itself.
- `emitDeviceRotatedEvent(input)`: build + sign + append a rotation
  event with the `previousPublicKey` cross-check enforced by Phase
  2.1's projection. Convenience for the future rotation UI.

### Doctrine

`docs/protocol/revocation-realism.md` (new):

- Pins what revocation _does_ and _does not_ guarantee
  (per-primitive table covering device.revoked, capability.revoked,
  device.rotated, key-epoch rotation, local block/mute/hide,
  label.revoked).
- UI language guide: explicit avoid/use-instead mapping so the PWA
  never overpromises retroactive deletion or remote enforcement.
- Cross-references the threat models and the Phase 2.1
  device.rotated discipline (`previousPublicKey` stops a stale
  rotation from rolling the key back).

### Tests

- `packages/sync-client/src/phase-2.2.test.ts` — 7 new tests across
  the store-level append path, replay path,
  `contactCardPublication` propagation, and the inbound dispatch
  regression fix for both new kinds.
- `apps/pwa/src/pwa-identity-emit.test.ts` — 8 new tests for the
  digest helper, `emitContactCardPublishedEvent` round-trip,
  empty-input rejection, idempotency, `emitDeviceRotatedEvent`
  happy path, and stale-epoch rejection via the projection
  lifecycle check.

### Verification

```bash
pnpm lint        # clean
pnpm typecheck   # clean
pnpm test        # 1034 passing (1019 → 1034, +15)
pnpm build       # clean
```

## Acceptance criteria

| Criterion                                                                          | Status | Evidence                                                           |
| ---------------------------------------------------------------------------------- | :----: | ------------------------------------------------------------------ |
| Inbound dispatch updates the projection for `device.rotated`                       |   ✓    | `phase-2.2.test.ts`                                                |
| Inbound dispatch updates the projection for `contact-card.published`               |   ✓    | `phase-2.2.test.ts`                                                |
| `contactCardPublication` propagates onto the stored snapshot                       |   ✓    | `phase-2.2.test.ts`                                                |
| Locally-emitted identity events go through a single atomic, idempotent entry point |   ✓    | `appendLocalIdentityEvent` + tests                                 |
| `listLocalIdentityEvents` is a viable replay-from-log path                         |   ✓    | test asserts replayed projection equals stored snapshot            |
| PWA contact-card export emits the publication audit event                          |   ✓    | `root-app.tsx` `exportContactCard` + `pwa-identity-emit.test.ts`   |
| Rotation emit helper exists and is testable                                        |   ✓    | `emitDeviceRotatedEvent` + 2 tests including stale-epoch rejection |
| Revocation realism doctrine pinned                                                 |   ✓    | `docs/protocol/revocation-realism.md`                              |
| No regressions: every prior test still passes                                      |   ✓    | 1034 total                                                         |

## Deferred work

- **Phase 2.3 — controller key recovery / supersession.** A
  controller key replacement flow (new ADR required). Today the
  controller key is single-controller; a stolen controller key has
  no recovery path beyond bootstrapping a new identity.
- **Capability delegation chains** (delegate-of-delegate). v1
  capabilities are direct from the controller.
- **Multi-controller accounts.** v1 is single-controller.
- **Identity-specific threat-model document.** Will cover
  stale-rotation-rollback, device-resurrection, post-revocation
  recovery, and bridge-withholding-revocation scenarios.
- **PWA rotation UI.** `emitDeviceRotatedEvent` is ready; a
  user-facing UI is a separate slice.
- **Cross-app sync of identity events.** The account-local sync
  envelope (ADR-002 territory) is required before identity events
  flow to the user's other apps.

## Decision

This phase is:

- [x] accepted as complete,
- [ ] accepted as foundation-only / partial,
- [ ] blocked,
- [ ] superseded by another phase.

Reason: Phase 2.1's protocol-core work now lands cleanly on every
inbound and locally-emitted path; the dispatch regression that
would have silently dropped two of the seven event kinds is fixed
and pinned by a test; the PWA's existing contact-card export now
records a publication-audit event with an auditable digest; and
the revocation-realism doctrine prevents future UI / docs / API
language from overpromising what the protocol can deliver.
