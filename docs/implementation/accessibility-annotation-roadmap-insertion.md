# Accessibility and Signed Annotation Roadmap Insertion

- Status: Draft
- Date: 2026-06-27
- Related ADR: `docs/adr/011-protocol-native-accessibility-and-signed-annotations-v1.md`
- Related protocol docs:
  - `docs/protocol/protocol-native-accessibility.md`
  - `docs/protocol/signed-annotation-coexistence.md`
- Related roadmap: `docs/implementation/roadmap-ordering.md`

## Purpose

This document records the clean roadmap insertion for accessibility and signed annotations without renumbering the already-merged semantic phases.

`docs/implementation/roadmap-ordering.md` already defines Phase 22 through Phase 25 for semantic discovery and reference semantic implementation. Preserve those phase numbers.

## Placement

Add these phases after Phase 21 and before Phase 22:

```txt
Phase 21A — protocol-native accessibility and safety metadata
Phase 21B — signed annotation coexistence framework
```

This keeps:

```txt
Phase 22 — semantic discovery protocol
Phase 23 — semantic runtime evaluation
Phase 24 — semantic runtime adapter interfaces
Phase 25 — reference semantic implementation
```

## Phase 21A — protocol-native accessibility and safety metadata

Define accessibility and warning metadata as first-class protocol concerns before semantic discovery consumes media/text objects.

Required work:

- protocol-native accessibility ADR;
- alt text, long description, transcript, captions, audio description, and language metadata;
- content warning, context warning, spoiler warning, sensitive media, flashing, motion, sound, and blur-by-default metadata;
- missing-accessibility-metadata states;
- generated/AI-assisted/reviewed metadata states;
- privacy rules for accessibility metadata derived from scoped content;
- preservation rules for bridges, relays, super peers, indexes, and runtime adapters;
- search/index rules for accessibility metadata.

## Phase 21B — signed annotation coexistence framework

Define how client-side annotations, accessibility annotations, labelers, moderation labels, context notes, and future annotation families coexist without mutating original objects.

Required work:

- signed annotation coexistence doctrine;
- target subject references for objects, media, actors, devices, URLs, domains, topics, communities, infrastructure, and policy lists;
- annotation class vocabulary;
- issuer, scope, namespace, motivation, body, created-at, expiry, supersession, and negation rules;
- client-side annotation defaults (`device-local` / `account-local`);
- labeler annotation defaults (`network-advisory` unless trusted by policy);
- coexistence rules for client annotations vs labelers;
- cross-issuer negation policy;
- rendering-order guidance;
- privacy rules for private evidence and scoped annotations.

## Coexistence summary

Client-side annotations and labeler annotations should use the same target-reference model but different issuer, scope, namespace, motivation, and authority semantics.

Client-side annotations are local/private by default. Labeler annotations are advisory by default. Neither system globally overrides the other.

## Future roadmap cleanup

A later narrow docs PR may inline these two phases into `docs/implementation/roadmap-ordering.md`. This addendum is intentionally non-destructive so the phase insertion can be reviewed independently.
