# Entity / Component / Snapshot Model

- Status: Draft
- Specification series: 3
- Specification version: 0.x
- Scope: portable app-data entity modeling inspired by Leaf
- Profiles: Core, Social, Messaging, Offline
- Related:
  - `docs/specification/03-data/data-partitions.md`
  - `docs/specification/02-identity/user-data-root.md`
  - `docs/specification/01-core/authority-model.md`

## Purpose

This document defines an Entity / Component / Snapshot model for portable app data.

The model is inspired by Leaf's entity-component approach over Willow-style storage, but it is not a wholesale adoption of Leaf or Willow. It is intended to support interoperable social objects while preserving protocol authority boundaries.

## Core concepts

```txt
Entity
  points to one or more Components
  represented by one or more Snapshots
  may be linked by LinkRefs
```

## Requirements

- Entity modeling MUST NOT replace authority-layer validation.
- Components SHOULD be independently referenceable.
- Snapshots SHOULD provide stable references to a specific entity state.
- Links SHOULD be able to reference either a live Entity or a pinned Snapshot.
- Private Components MUST remain encrypted when replicated through providers or untrusted transports.
- Entity schemas SHOULD be explicit enough to avoid incompatible app interpretation.

## Entity

An Entity is a portable app-data object.

Examples:

- profile card;
- post;
- message;
- comment;
- thread;
- feed item;
- bookmark;
- contact card;
- report evidence bundle;
- moderation appeal packet;
- media collection;
- Space metadata object.

Entities are not automatically authority records. If an Entity represents authority-sensitive state, the relevant authority specification MUST define validation and consistency behavior.

## Component

A Component is a data piece attached to an Entity.

Examples:

- text body;
- display name;
- avatar reference;
- attachment list;
- media metadata;
- alt text;
- language tags;
- encrypted private notes;
- moderation evidence;
- embedded object refs;
- feed ranking metadata.

Components MAY be public, private, encrypted, local-only, or selectively replicated.

## Snapshot

A Snapshot is a stable representation of an Entity at a specific state.

A Snapshot SHOULD include or reference the ordered set of Components that define that state.

Snapshot-pinned references are useful for:

- quote posts;
- forwards;
- reports;
- appeals;
- moderation evidence;
- audit logs;
- feed candidate sets;
- export/import bundles.

## LinkRef

A LinkRef references another Entity or Snapshot.

A LinkRef SHOULD declare whether it references:

- the current/live Entity;
- an exact Snapshot;
- a Component;
- an Object Reference;
- an external URI or compatibility reference.

Snapshot-pinned links SHOULD be used where later mutation or deletion would otherwise undermine evidence, quotes, forwards, or auditability.

## Schema and specification separation

A binary encoding alone is not enough for interoperability.

Entity and Component schemas SHOULD define:

- semantic meaning;
- required fields;
- optional fields;
- visibility rules;
- encryption expectations;
- validation rules;
- consistency behavior;
- projection behavior;
- interoperability expectations.

Unspecified schemas SHOULD NOT be treated as interoperable social primitives.

## Safe path rules

If Entities are stored in path-like partitions inspired by Willow/Leaf, implementations MUST avoid path-prefix behavior that can accidentally delete or shadow unrelated entities.

A later data specification SHOULD define safe entity path conventions.

Until then, entity storage paths SHOULD be treated as Draft and implementation-local.

## Per-component encryption

Different Components of the same Entity may have different visibility.

Examples:

- public profile name + encrypted private contact note;
- public post body + private moderation annotation;
- public media reference + private access token;
- visible report metadata + encrypted evidence payload.

Private Components MUST remain encrypted across untrusted providers and transports.

## Consistency behavior

Entity updates MAY be modeled as:

- new Snapshots;
- append-only event records;
- mutable app-data projection;
- authority-controlled state machines;
- local-only mutations.

The allowed model depends on the Entity type.

Authority-sensitive Entities MUST NOT rely on generic LWW or mutable component replacement unless explicitly permitted.

## Validation

Before accepting an Entity Snapshot into durable state, implementations SHOULD validate:

- referenced Components exist or are fetchable when required;
- Component digests match;
- encryption/access policy is satisfied;
- schema is known or safely treated as opaque;
- signer/capability authority is valid where required;
- consistency class is respected.

## Low-bandwidth behavior

Low-bandwidth sync MAY exchange Entity headers, Snapshot references, Component digests, and small text Components before larger payloads.

Large media Components SHOULD be lazy.

Private Components SHOULD only be requested when the receiver can decrypt and is authorized.

## Security considerations

Implementations MUST guard against:

- schema confusion;
- malicious Component substitution;
- Snapshot spoofing;
- unpinned evidence mutation;
- encrypted Component metadata leaks;
- path-prefix deletion or shadowing;
- treating app-data Entities as authority records without validation.

## Open questions

- Canonical EntityRef, ComponentRef, SnapshotRef, and LinkRef encodings.
- Whether Snapshot content uses sorted Component references.
- Whether Components are always content-addressed.
- Initial schema registry.
- Safe path encoding rules.
