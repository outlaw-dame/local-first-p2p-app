# Phase 5.11 — Spaces and Channels Schema Plan

- Status: Draft
- Date: 2026-06-30
- Spec: `docs/specification/06-social/spaces.md`, `docs/specification/06-social/channels.md`, `docs/specification/06-social/roles.md`
- ADR: ADR-007 (capability authority model — space roles build on capabilities), ADR-014 (FROST — space governance threshold)
- Depends on: Phase 5.11 UDR plan (space join/leave lands in UDR), Phase 5.11 feed plan (ChannelFeedRef), Phase 5.0 (Class D events)

## Scope

Define Space and Channel protocol event kinds, `SpacePolicy`, role/membership schemas, and `@lfp2p/spaces-projection` package. Wire into `@lfp2p/local-store`. Voice/video rooms, real-time presence within channels, and live federation with external relay infrastructure are out of scope.

## Step 1 — `space.*` and `channel.*` event kinds in `packages/protocol`

Space event kinds:

| Kind | Privacy | Consistency class |
|---|---|---|
| `space.created` | `group` | B |
| `space.policy.updated` | `group` | B |
| `space.member.invited` | `group` | D |
| `space.member.joined` | `group` | D |
| `space.member.role-changed` | `group` | B |
| `space.member.removed` | `group` | B |
| `space.dissolved` | `group` | B |

Channel event kinds:

| Kind | Privacy | Consistency class |
|---|---|---|
| `channel.created` | `group` | B |
| `channel.policy.updated` | `group` | B |
| `channel.archived` | `group` | B |

All `group`-scoped: carry `PrivatePayloadEnvelopeV1`. Bridge MUST NOT decrypt.

One PR. Kinds + privacy rules.

## Step 2 — Space and channel payload schemas + fixtures

Core schemas:

```ts
// space.created payload (inside encrypted envelope)
{
  spaceId: string;
  name: string;
  description?: string;
  policy: SpacePolicy;
  createdAt: string;
}

// SpacePolicy shape
{
  inviteOnly: boolean;
  governanceThreshold?: { t: number; n: number };
  defaultMemberRole: 'member' | 'moderator';
  channelCreation: 'admin-only' | 'any-member';
}

// space.policy.updated payload
{ spaceId: string; policyPatch: Partial<SpacePolicy>; updatedAt: string }

// space.member.invited payload
{ spaceId: string; inviteeIdentityId: string; role: SpaceRole; invitedAt: string }

// space.member.joined payload
{ spaceId: string; memberIdentityId: string; role: SpaceRole; joinedAt: string; inviteId?: string }

// space.member.role-changed payload
{ spaceId: string; memberIdentityId: string; previousRole: SpaceRole; nextRole: SpaceRole; changedAt: string }

// space.member.removed payload
{ spaceId: string; memberIdentityId: string; removedAt: string; reason?: 'voluntary' | 'moderation' | 'policy' }

// space.dissolved payload
{ spaceId: string; dissolvedAt: string; reason?: string }

// channel.created payload
{ channelId: string; spaceId: string; name: string; kind: 'text' | 'feed' | 'voice'; createdAt: string }

// channel.policy.updated payload
{ channelId: string; spaceId: string; policyPatch: JsonObject; updatedAt: string }

// channel.archived payload
{ channelId: string; spaceId: string; archivedAt: string; reason?: string }
```

`SpaceRole` enum: `'owner' | 'admin' | 'moderator' | 'member' | 'observer'`.

One PR. 14 valid + 10 invalid fixtures.

## Step 3 — `@lfp2p/spaces-projection` package

New package `packages/spaces-projection/`:

- `SpaceState` type: spaceId, name, policy, members map (identityId → role + joinedAt), channels map (channelId → ChannelState), appliedEventIds.
- `applySpaceEvent(state, payload, meta) → SpaceState` pure state machine.
  - `space.dissolved` is terminal: subsequent events on that spaceId are no-ops.
  - `space.member.removed` on non-member is idempotent no-op.
- `ChannelState` type: channelId, name, kind, archived flag.
- `SPACES_ERROR_CODES`: `SPACES_INVALID_PAYLOAD`, `SPACES_ILLEGAL_TRANSITION`, `SPACES_MEMBER_NOT_FOUND`, `SPACES_CHANNEL_NOT_FOUND`.
- Deep-frozen; replay equivalence; fixture round-trip.

One PR. Pure package.

## Step 4 — Spaces tables in `@lfp2p/local-store`

Dexie schema v14/v15:

- `spaceProjections` table (PK: `spaceId`, index: `updatedAt`).
  Projection stored encrypted (same pattern as chat: `encryptedState: EncryptedKeyMaterial`).
- `spaceEventLog` table (PK: `eventId`, index: `kind, spaceId, createdAt`).
- `appendSpaceEvent(event)` — idempotent, validates, decrypts, updates projection.
- `loadSpaceState(spaceId) → SpaceState`.
- Route `space.*` / `channel.*` in `processInboundSyncBatch`.

One PR.

## Step 5 — Role enforcement guard

`assertSpaceRoleAuthorized(state, actorIdentityId, requiredRole)`:

- Throws `SPACES_UNAUTHORIZED` if actor's current role is below `requiredRole`.
- Role ordering: `owner > admin > moderator > member > observer`.
- Called by local write paths before emitting `space.member.role-changed`, `space.member.removed`, `space.dissolved`, `channel.*`.
- Does NOT validate FROST governance threshold (ADR-014 follow-up).

One PR.

## Step 6 — PWA spaces view

`apps/pwa/src/pwa-spaces-state.ts`:

- `buildSpacesListViewModel(store) → SpaceListItem[]`.
- `emitSpaceCreated(store, payload)`, `emitSpaceMemberInvited(store, payload)`.
- `emitChannelCreated(store, payload)`.

One PR.

## Package boundary rules

- `@lfp2p/spaces-projection` MUST NOT import local-store, sync-client, bridge, or app packages.
- MLS group keying for space encryption uses the ADR-012 MLS provider boundary — spaces-projection does not import an MLS library directly.
- FROST governance threshold enforcement (when `policy.governanceThreshold` is set) is a Phase 5.10 follow-up, not implemented in this plan.

## Constraints

- All `group`-scoped space/channel events carry encrypted payloads.
- Space authority is subordinate to controller identity: a revoked device loses space write authority through normal identity-control log enforcement.
- Phase 1.64 bridge admission continues to gate `group`-scoped events by scope allowlist regardless of space membership; membership is an application-layer concern, not a bridge-admission concern.
