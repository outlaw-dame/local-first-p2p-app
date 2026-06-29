# Roles

- Status: Draft
- Specification series: 6
- Specification version: 0.x
- Scope: Space and Channel role/capability model
- Profiles: Social, Messaging, Availability
- Related:
  - `docs/specification/06-social/spaces.md`
  - `docs/specification/06-social/channels.md`
  - `docs/specification/02-identity/capabilities.md`

## Purpose

This document defines Roles as named bundles of permissions, responsibilities, and capabilities in Spaces, Channels, moderation workflows, and provider-assisted social contexts.

Roles are policy structures. Actual authority MUST still be validated through capability, membership, and Space/Channel authority rules.

## Requirements

- Role assignment MUST be authorized by valid Space, Channel, or delegated authority.
- A Role MUST NOT imply unrelated authority outside its declared scope.
- Role permissions SHOULD map to explicit capabilities where authority matters.
- Role revocation MUST be authority-sensitive lifecycle state.
- Providers MUST NOT create Space or Channel protocol authority through provider-local roles alone.

## Example roles

A future registry may define owner, admin, moderator, member, guest, read-only member, bot/service actor, feed operator, mailbox operator, infrastructure operator, and appeal reviewer roles.

These names are Draft until registered.

## Role scopes

Roles may be scoped to an Identity Root, Space, Channel, Thread, Feed Collection, moderation queue, mailbox route, provider capability, time window, or action subset.

## Role permissions

Role permissions may include reading, writing, inviting, Channel administration, policy administration, role administration, moderation actions, report review, appeal review, infrastructure descriptor publication, feed generator administration, and mailbox route administration.

Authority-sensitive permissions SHOULD be represented by explicit capabilities or signed role state.

## Validation

Before accepting a role-dependent action, implementations MUST validate:

- Role assignment authority;
- Role revocation state;
- action permission;
- scope;
- capability grant where required;
- Space/Channel policy;
- consistency class;
- replay/idempotency behavior.

## Low-bandwidth behavior

Low-bandwidth sync SHOULD prioritize role grants, role revocations, and membership checkpoints before ordinary social content when role state affects write or moderation authority.

## Security considerations

Implementations MUST guard against stale Role grants, unauthorized Role escalation, provider-local Roles being treated as protocol authority, cross-Space Role reuse without scope checks, hidden moderator confusion, malicious infrastructure operator Role claims, and Role revocation delays in offline mode.

## Open questions

- Initial Role registry.
- Whether Role permissions are direct fields or capability references.
- Threshold governance for high-risk Role assignments.
- Required moderation Role semantics for Social Profile.
