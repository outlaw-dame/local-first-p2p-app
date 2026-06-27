# Signed Annotation Coexistence

- Status: Draft
- Date: 2026-06-27
- Related ADR: `docs/adr/011-protocol-native-accessibility-and-signed-annotations-v1.md`
- Related policy: `docs/protocol/trust-safety-event-policy.md`

## Purpose

This document defines how client-side annotations, accessibility annotations, labeler outputs, moderation labels, context notes, and future annotation families coexist without mutating original objects or overriding each other globally.

## Core rule

A durable annotation is a signed protocol object targeting another protocol object, actor, device, media item, block, URL, domain, topic, community, bridge, relay, super peer, policy list, or other supported subject.

Annotations never silently mutate their targets.

## Existing foundation

The trust and safety event policy already defines `SafetyAnnotation`, `SafetyLabel`, labeler profiles, subscriptions, scopes, and the rule that labels are advisory until local policy maps them to action.

This document extends that model to accessibility and client-side annotations.

## Annotation classes

Initial annotation classes:

- accessibility annotation;
- warning annotation;
- safety label;
- moderation annotation;
- curation annotation;
- context annotation;
- client-local annotation;
- correction annotation;
- translation/localization annotation.

All annotation classes should share:

- stable annotation id;
- signed issuer/author;
- target subject ref;
- motivation;
- body;
- scope;
- created at;
- optional expiry;
- optional supersedes/negates ref;
- optional capability proofs;
- optional policy ref.

## Client-side annotations

Client-side annotations are local-first and private by default.

Default scope should be `device-local` or `account-local`.

Examples:

- personal note;
- personal content warning;
- personal hide/blur preference;
- personal correction;
- private reading/listening state;
- private accessibility override.

Client-side annotations do not conflict with labeler annotations because they are evaluated in a different scope and authority lane.

## Labeler annotations

Labeler annotations are advisory by default.

A labeler may publish labels, warnings, classifications, context notes, media-safety signals, or accessibility-quality signals. Their output affects rendering only when selected by local policy, user subscription, community policy, infrastructure policy, or index policy.

A labeler is not automatically trusted for private content. Subscription to a labeler is not consent to leak private events to that labeler.

## Coexistence rules

1. Multiple annotations may target the same object.
2. Multiple issuers may publish different claims about the same object.
3. Client-local annotations apply before or alongside user policy but do not rewrite network-visible labels.
4. Labeler annotations remain advisory until trusted by policy.
5. Community or infrastructure policy may map labels to warnings, blur, hide, quarantine, reject, downrank, or exclude-from-search within its own scope.
6. Cross-issuer negation is not allowed unless policy explicitly permits it.
7. Same-issuer supersession is allowed when the newer annotation references the older annotation.
8. Hard-safety warnings must not be silently downgraded by unsafe defaults.
9. Private evidence must stay private and use encrypted payload/content-reference rules.
10. Search/index projections must respect annotation scope.

## Rendering order guidance

A client may combine signals in this order:

1. local user safety/accessibility preferences;
2. device-local/client-local annotations;
3. account-local annotations;
4. original object embedded metadata;
5. trusted accessibility annotations;
6. trusted labeler annotations;
7. community policy;
8. bridge/relay/super-peer/index-local policy;
9. app-surface rendering defaults.

This is guidance, not mandatory global ranking. Local policy remains sovereign.

## Accessibility annotation examples

Useful annotation motivations:

- describing visual media;
- transcribing audio/video;
- captioning video;
- warning about flashing or motion;
- adding context warning;
- correcting inaccurate alt text;
- superseding generated alt text with reviewed text.

## Integrity rule

An annotation's signature proves who authored the annotation. It does not prove the annotation is true, trusted, high quality, or globally authoritative.

Trust comes from local policy, capabilities, reputation, labeler subscription, issuer credentials, and observed behavior.
