# Protocol-Native Accessibility and Safety Metadata

- Status: Draft
- Date: 2026-06-27
- Related ADR: `docs/adr/011-protocol-native-accessibility-and-signed-annotations-v1.md`
- Related policy: `docs/protocol/trust-safety-event-policy.md`

## Purpose

Accessibility is a protocol concern, not only a client-rendering concern.

Objects should carry enough structured metadata for clients to render media and text safely, accessibly, and predictably while preserving the original object's integrity.

## Core model

Accessibility metadata can appear in two forms:

1. Embedded in the original signed object.
2. Attached later as a separate signed annotation object.

Embedded metadata is authored by the original object signer. Separate annotations are authored by the annotation signer.

## Accessibility fields

Protocol object families should be able to express:

- `altText` for images and visual media;
- `longDescription` for complex visual media;
- `transcript` for audio/video;
- `captions` for video;
- `audioDescription` for video;
- `language` and localization metadata;
- `contentWarning` for user-authored content warnings;
- `contextWarning` for contextual safety information;
- `spoilerWarning` for plot/event spoilers;
- `sensitiveMedia` for media requiring user-controlled reveal;
- `flashingWarning` for seizure/flash risk;
- `motionWarning` for motion-sensitive content;
- `soundWarning` for sudden/loud audio;
- `blurByDefault` rendering recommendation;
- `verificationState` for accessibility metadata provenance/review state.

## Verification state

Accessibility metadata should use a structured verification/provenance state instead of separate boolean fields.

Initial values:

- `human-authored`;
- `ai-generated`;
- `ai-assisted`;
- `reviewed`;
- `superseded`;
- `disputed`.

The verification state describes the accessibility metadata, not the target object as a whole.

## Required behavior

Clients, bridges, relays, super peers, indexes, and runtime adapters must preserve accessibility and warning metadata when they preserve the target object.

They may downscope, hide, warn, blur, or decline to render according to local policy, but they must not silently strip accessibility metadata from objects they otherwise present as intact.

## Media defaults

Media clients should support safe defaults:

- image/video blur when sensitive, explicit, graphic, flashing, or unknown-safety metadata is present;
- captions on by preference;
- reduced motion alternatives where available;
- transcript fallback for audio/video;
- no autoplay when local policy disables autoplay;
- explicit user reveal for blurred media.

## Missing metadata state

Missing accessibility metadata should be machine-readable.

Examples:

- alt text missing;
- transcript missing;
- captions missing;
- language unknown;
- flashing status unknown;
- sensitive media status unknown.

Missing metadata is not the same as confirmed absence of risk.

## Generated metadata

AI-generated or tool-generated accessibility metadata should be marked with `verificationState: ai-generated` unless a human or authorized process reviews it.

Clients should be able to distinguish human-authored, AI-generated, AI-assisted, reviewed, superseded, and disputed accessibility metadata.

## Privacy

Accessibility metadata can leak private content. Private, account-local, group, and decrypted-derived accessibility metadata must inherit the same or stricter privacy scope as the source object.

Public alt text for a private image is still private data.

## Search and semantic discovery

Search indexes may index accessibility metadata only when the index is authorized for the same scope as the source metadata.

Alt text, captions, transcripts, and warnings must not become public discovery material unless the underlying object and metadata are public or explicitly shared.
