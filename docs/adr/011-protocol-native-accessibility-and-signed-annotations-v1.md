# ADR-011: Protocol-Native Accessibility and Signed Annotations v1

- Status: Proposed
- Date: 2026-06-27
- Related docs:
  - `docs/protocol/trust-safety-event-policy.md`
  - `docs/protocol/protocol-native-accessibility.md`
  - `docs/protocol/signed-annotation-coexistence.md`
  - `docs/implementation/roadmap-ordering.md`

## Context

The protocol already treats durable protocol events as signed local-first objects. The trust and safety policy already defines signed safety annotations, labels, labeler profiles, labeler subscriptions, local/user scopes, and the rule that labels do not enforce themselves.

Accessibility metadata, content warnings, context warnings, media safety hints, and client-side annotations need to fit this model without mutating original objects and without creating a parallel system that conflicts with labelers.

## Decision

Add protocol-native accessibility and signed annotation doctrine before semantic discovery.

Use two roadmap phases:

- Phase 21A — protocol-native accessibility and safety metadata.
- Phase 21B — signed annotation coexistence framework.

## Core rule

Every durable claim about an object should be signed either as part of the original signed object or as a separate signed annotation object.

Embedded accessibility metadata inherits the original object signer. External accessibility metadata, warnings, corrections, labeler outputs, and client annotations are independent signed annotations targeting the original object.

## Original object integrity

Annotations never silently mutate the target object.

They may reference, describe, warn about, supersede another annotation, or affect local rendering policy. They do not change the target object's content hash, signature, or authorship.

## Accessibility metadata

Protocol objects should support structured accessibility and safety metadata such as:

- alt text;
- long description;
- transcript;
- captions;
- audio description;
- content warning;
- context warning;
- spoiler warning;
- sensitive media warning;
- flashing/motion/sound warning;
- blur-by-default recommendation;
- language and localization metadata;
- generated/reviewed state.

## Annotation coexistence

Client-side annotations and labeler annotations coexist by using the same target-reference model but different issuer, scope, namespace, motivation, and authority semantics.

Client-side annotations are local by default. Labeler annotations are advisory by default unless a user's policy, community policy, bridge policy, relay policy, super-peer policy, or index policy chooses to trust them.

Neither system overrides the other globally.

## Non-goals

This ADR does not implement new event kinds, change existing trust-safety validators, replace labelers, require ActivityPub/ATProto, or mandate a UI.
