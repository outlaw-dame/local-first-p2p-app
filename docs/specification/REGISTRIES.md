# Protocol Registries

- Status: Draft
- Specification series: 0
- Scope: registry framework for protocol identifiers

## Purpose

Registries prevent protocol identifiers from being scattered across documents and implementations without a canonical definition.

A registry entry defines the name, purpose, stability, profile impact, and extension behavior for a protocol identifier.

## Registry rules

A first-class protocol identifier SHOULD be registered before implementation.

A registry entry SHOULD define:

- identifier;
- display name;
- status;
- owning specification document;
- required profile or extension;
- validation expectations;
- security considerations;
- privacy considerations;
- compatibility notes.

Registry identifiers SHOULD be stable, lowercase, and namespace-friendly.

## Core registries

### Object Type Registry

Examples:

- `identity`
- `device`
- `capability`
- `user-data-root`
- `entity`
- `component`
- `snapshot`
- `object-ref`
- `content-bundle`
- `mailbox-delivery`
- `mailbox-receipt`
- `space`
- `channel`
- `feed-collection`
- `feed-generator`
- `portable-sync-drop`

### Event Type Registry

Event kinds SHOULD map to consistency classes and validation requirements.

Examples:

- identity-control events;
- capability events;
- MLS group-control events;
- mailbox events;
- feed subscription events;
- space/channel events;
- moderation/report/appeal events.

### Capability Registry

Capability identifiers describe optional protocol abilities, provider services, or authority grants.

Examples:

- `core.identity`
- `core.sync`
- `core.mailbox`
- `core.feed`
- `core.space`
- `transport.bluetooth`
- `transport.hyperdht`
- `transport.webrtc`
- `availability.bridge`
- `availability.relay`
- `availability.super-peer`
- `availability.mailbox-host`
- `availability.feed-generator`
- `sync.portable-drop`
- `security.frost`
- `security.mls`
- `social.rich-presence`
- `social.voice`
- `social.video`

### Transport Registry

Transport identifiers describe byte-moving mechanisms.

Examples:

- `transport.http-bridge`
- `transport.webrtc-datachannel`
- `transport.hyperdht`
- `transport.hypercore`
- `transport.bluetooth`
- `transport.local-wifi`
- `transport.file-import-export`
- `transport.qr-batch`
- `transport.tor`
- `transport.i2p`

Transport identifiers MUST NOT imply protocol authority.

### Availability Surface Registry

Examples:

- `bridge`
- `relay`
- `super-peer`
- `mailbox-provider`
- `search-provider`
- `feed-generator-provider`
- `media-cache-provider`
- `storage-provider`

Availability surfaces MUST define whether they can store, relay, index, generate, cache, or admit records.

### Consistency Class Registry

Consistency classes define allowed merge/apply behavior.

Known classes:

- `A` — eventually consistent projection events;
- `B` — append-only lifecycle state machines;
- `C` — monotonic authority / epoch transitions;
- `D` — encrypted payload / key-epoch transitions;
- `E` — infrastructure observations.

### Error Code Registry

Protocol-level errors SHOULD use stable error codes.

Examples:

- `signature-invalid`
- `capability-missing`
- `capability-revoked`
- `consistency-class-violation`
- `replay-detected`
- `stale-epoch`
- `mailbox-expired`
- `recipient-not-authorized`
- `sync-checkpoint-rejected`
- `payload-unavailable`

### Cryptographic Algorithm Registry

Examples:

- signature algorithms;
- hash algorithms;
- content digest algorithms;
- encryption schemes;
- key agreement schemes;
- threshold signature suites.

Cryptographic registry entries MUST include security considerations.

### Media Type Registry

Examples:

- signed event envelope encoding;
- portable sync drop encoding;
- content bundle encoding;
- mailbox envelope encoding;
- entity snapshot encoding.

## Extension identifiers

Extension identifiers SHOULD use one of these namespaces:

- `ext.*` for general extensions;
- `transport.*` for transports;
- `availability.*` for provider capabilities;
- `security.*` for security capabilities;
- `sync.*` for synchronization extensions;
- `social.*` for social primitives;
- `media.*` for media behavior.

Extensions MUST NOT redefine core identifiers.

## Registry lifecycle

Registry entries may be:

- Draft;
- Experimental;
- Candidate;
- Stable;
- Deprecated;
- Reserved.

Reserved identifiers MUST NOT be used without a later specification update.

## Future work

Later specification series should replace the examples in this document with concrete registry tables or machine-readable registry files.
