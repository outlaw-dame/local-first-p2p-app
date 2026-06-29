# Presence

- Status: Draft
- Specification series: 6
- Specification version: 0.x
- Scope: presence, rich activity, and availability signaling
- Profiles: Social, Messaging, Availability, Offline
- Related:
  - `docs/specification/06-social/spaces.md`
  - `docs/specification/06-social/channels.md`
  - `docs/specification/02-identity/capabilities.md`

## Purpose

This document defines Presence as optional, privacy-sensitive signaling about availability, activity, attention, or rich activity context.

Presence can support Discord-like active status, rich activity, media/game/coding/podcast activity, typing indicators, online state, voice/video readiness, and local-nearby hints.

## Requirements

- Presence MUST be opt-in where it exposes user activity beyond basic protocol operation.
- Presence MUST NOT be required for identity, messaging, feeds, Spaces, or Channels to function.
- Presence SHOULD be scoped to audience, Space, Channel, relationship, or local-only context.
- Presence providers MUST NOT become identity or activity truth authorities.
- Private Presence data MUST respect user controls and local policy.

## Presence types

A future registry may define:

- online/offline/away;
- active now;
- typing;
- listening;
- watching;
- reading;
- playing;
- coding;
- podcast activity;
- voice/video available;
- local-nearby availability;
- do-not-disturb;
- custom activity.

These names are Draft until registered.

## Audience scope

Presence may be scoped to:

- self only;
- friends/contacts;
- Space members;
- Channel members;
- selected list;
- local-nearby peers;
- public;
- provider-local session;
- application-local projection.

The default for rich activity SHOULD be narrow rather than public.

## Rich activity references

Presence may reference external or app-specific objects such as media, games, development tools, podcasts, streams, or documents.

External references MUST NOT bypass privacy or safety policy.

Presence records SHOULD avoid leaking unnecessary URLs, local file names, private project names, or sensitive media context.

## Expiry

Presence SHOULD be short-lived and expire automatically.

Stale Presence SHOULD NOT be presented as current activity.

## Sync behavior

Presence is usually availability-state, not durable history.

Presence MAY be delivered by direct P2P, mailbox, provider, Space infrastructure, super-peer, or local-nearby route.

Presence MUST remain optional and safely ignorable.

## Low-bandwidth behavior

Low-bandwidth mode MAY omit Presence entirely.

If exchanged, low-bandwidth Presence SHOULD use compact records and short expiry.

## Security considerations

Implementations MUST guard against activity tracking, stalking risk, private membership inference, local-network metadata leakage, forged Presence, stale Presence, provider over-collection, and accidental disclosure through rich activity metadata.

## Open questions

- Initial Presence type registry.
- Default audience scope for rich activity.
- Whether typing indicators are Messaging Profile or Social Profile.
- How long Presence records should remain valid.
