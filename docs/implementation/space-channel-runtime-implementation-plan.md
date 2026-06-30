# Space / Channel Runtime Implementation Plan

- Status: Draft
- Date: 2026-06-30
- Scope: implementation plan for Space and Channel runtime after Series 6 social specs, mailbox runtime planning, feed runtime planning, MLS promotion, availability promotion, and Trust & Safety promotion
- Related specifications:
  - `docs/specification/06-social/spaces.md`
  - `docs/specification/06-social/channels.md`
  - `docs/specification/06-social/threads.md`
  - `docs/specification/06-social/roles.md`
  - `docs/specification/06-social/presence.md`
  - `docs/specification/06-social/feeds.md`
  - `docs/specification/06-social/collections.md`
  - `docs/specification/05-mailbox/mailbox.md`
  - `docs/specification/04-sync/selective-replica-sync.md`
- Related promotion/docs:
  - `docs/implementation/phase-5-chat-spec-promotion.md`
  - `docs/implementation/mailbox-runtime-implementation-plan.md`
  - `docs/implementation/feed-runtime-implementation-plan.md`
  - `docs/implementation/mls-group-control-spec-promotion.md`
  - `docs/implementation/availability-surfaces-spec-promotion.md`
  - `docs/implementation/trust-safety-spec-promotion.md`

## Purpose

Spaces and Channels are social containers, not hosted-server assumptions.

This plan defines the first runtime slice for Spaces, Channels, roles, membership, Channel feed heads, mailbox routes, and private Channel/group privacy boundaries while preserving the local-first and infrastructure-optional doctrine.

## Non-negotiable boundaries

- Users can create Spaces without running dedicated infrastructure.
- Space authority is signed protocol state, not provider-local server state.
- Channel authority derives from Space policy and explicit capabilities.
- Space infrastructure descriptors are optional and capability-bounded.
- Channel delivery uses mailbox-compatible routes, but mailbox delivery is not Channel acceptance.
- Private Spaces/Channels must bind social membership to group privacy/key-epoch state.
- Space/Channel feeds are Feed Collections or feed projections, not provider-only timelines.
- Roles are policy structures; authority still validates through capabilities and Space/Channel rules.

## Runtime primitives

### `SpaceRecord`

Minimum fields:

- `spaceId`;
- `creatorId`;
- `name`;
- `visibility`;
- `createdAt`;
- `policyRef`;
- `roleSetRef`;
- `infrastructureDescriptorRefs`;
- `defaultChannelRefs`;
- `version`.

### `ChannelRecord`

Minimum fields:

- `channelId`;
- `spaceId`;
- `channelType`;
- `name`;
- `visibility`;
- `writePolicyRef`;
- `readPolicyRef`;
- `mailboxRouteRef`;
- `feedCollectionRef`;
- `createdAt`;
- `version`.

### `SpaceMembershipRecord`

Minimum fields:

- `spaceId`;
- `memberId`;
- `roleRefs`;
- `membershipState`;
- `joinedAt`;
- `invitedBy`;
- `capabilityRefs`;
- `privacyGroupRef` where applicable.

### `RoleRecord`

Minimum fields:

- `roleId`;
- `spaceId`;
- `name`;
- `permissionSet`;
- `scope`;
- `createdAt`;
- `version`.

### `SpaceInfrastructureDescriptor`

Optional descriptor for availability support:

- bridge route;
- mailbox route;
- super-peer route;
- search/index provider;
- feed provider;
- media/object provider;
- policy URL or Object Reference;
- supported protocol/specification versions.

## Implementation phases

### Phase SC-1 — Types and validators

Add Space/Channel runtime types and validators:

- Space Record;
- Channel Record;
- Space Membership Record;
- Role Record;
- Space Policy;
- Channel Policy;
- Infrastructure Descriptor.

Tests:

- Channel without Space rejected;
- role outside Space scope rejected;
- infrastructure descriptor cannot grant authority by itself;
- private Channel requires explicit privacy/keying metadata;
- invalid visibility/policy combinations rejected.

### Phase SC-2 — Local projection and store

Implement deterministic local projections:

- Space list;
- Channel list per Space;
- membership state;
- role/permission projection;
- Channel read/write decision projection;
- infrastructure descriptor projection.

Tests:

- replay produces same Space/Channel projection;
- duplicate membership event idempotent;
- removed member loses Channel write projection;
- provider descriptor changes do not mutate Space authority.

### Phase SC-3 — Mailbox route integration

Wire mailbox-compatible routes:

- Space mailbox route reference;
- Channel mailbox route reference;
- DM/group thread route where relevant;
- provider accepted versus recipient applied state;
- route-state UI contract.

Tests:

- Channel message delivery does not imply Channel acceptance;
- provider route failure does not remove Channel membership;
- mailbox route state remains separate from Channel feed state;
- private payload remains opaque to providers.

### Phase SC-4 — Feed and Collection integration

Bind Channels to feed primitives:

- Channel Feed Collection;
- Channel feed head;
- Space feed;
- moderation-review feed where applicable;
- saved/bookmarked Space/Channel collections.

Tests:

- Channel feed remains locally available without provider feed generator;
- provider candidate output is filtered locally;
- private Channel membership does not leak through feed metadata;
- Channel feed uses Object References / Snapshot References where needed.

### Phase SC-5 — MLS/private group integration

Bind private Spaces/Channels to group privacy state:

- privacy group reference;
- key epoch reference;
- membership change requiring epoch transition where applicable;
- invite/accept/reject lifecycle;
- undecryptable placeholder behavior.

Tests:

- stale epoch message rejected or marked undecryptable;
- removed member does not receive new private Channel payloads;
- group delivery success is not group-state acceptance;
- Space/Channel membership and MLS membership cannot silently diverge.

### Phase SC-6 — Trust & Safety integration

Integrate local controls and moderation runtime:

- blocked Space/Channel visibility decision;
- muted Channel projection;
- role-gated moderation queue;
- report/appeal subject references;
- curation/reach filtering.

Tests:

- local controls outrank provider descriptors;
- moderation action does not mutate signed Space authority unless a signed action exists;
- reports use Object References for subject/evidence;
- curation filtering does not delete records.

### Phase SC-7 — Presence integration

Add optional presence for Spaces/Channels:

- opt-in status;
- typing/active indicators;
- voice/video readiness hints;
- rich presence scoping.

Tests:

- presence is optional;
- rich presence default scope is narrow;
- presence expiry is enforced;
- presence does not grant Channel access.

## Exit criteria

Space/Channel runtime is ready for product/UI expansion when:

- Space, Channel, Membership, Role, Policy, and Infrastructure Descriptor types exist;
- deterministic local projections exist;
- mailbox routes are separate from Channel content and Channel feeds;
- Channel feeds work as Feed Collections/projections;
- private Channel membership is tied to group privacy state;
- local controls and moderation hooks apply before display;
- degraded local-first behavior works without Space infrastructure.

## Follow-up work

After this plan lands, the next implementation docs should be:

1. local-store schema plan for mailbox + feeds + Spaces/Channels;
2. PWA UI integration plan for chat, mailbox state, feeds, Spaces, and Channels;
3. Series 7 provider descriptor runtime plan;
4. Series 8 MLS runtime plan.
