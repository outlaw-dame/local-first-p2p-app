# Portable Sync Drops

- Status: Draft
- Specification series: 4
- Specification version: 0.x
- Scope: bounded encrypted sync bundles for offline and improvised transfer
- Profiles: Offline, Core, Messaging, Social
- Related:
  - `docs/specification/04-sync/low-bandwidth-profile.md`
  - `docs/specification/04-sync/selective-replica-sync.md`
  - `docs/specification/03-data/merkle-checkpoints.md`
  - `docs/specification/03-data/object-references.md`

## Purpose

This document defines Portable Sync Drops as bounded, verifiable, encrypted sync bundles that can be moved over any available medium.

Portable Sync Drops are inspired by the same survivability need as Willow Drop Format: users should be able to exchange useful protocol state even when ordinary network infrastructure is unavailable.

## Requirements

- A Portable Sync Drop MUST NOT bypass authority validation.
- A Portable Sync Drop MUST be importable idempotently where practical.
- A Portable Sync Drop SHOULD be bounded by partition, time range, object scope, size, or recipient set.
- Private records and payloads in a Portable Sync Drop MUST remain encrypted.
- A Portable Sync Drop SHOULD include enough manifest/checkpoint information to validate completeness and integrity for its declared scope.
- Importing a Portable Sync Drop MUST NOT imply user consent to display, forward, or trust all contained records.

## Transfer media

A Portable Sync Drop may move over:

- file export/import;
- USB or local file copy;
- local Wi-Fi or hotspot transfer;
- Bluetooth or nearby transfer;
- QR batches for tiny payloads;
- email or messaging attachment;
- peer-assisted file transfer;
- content bundle exchange;
- provider upload/download;
- removable media.

The transfer medium does not define protocol authority.

## Drop contents

A Portable Sync Drop may contain:

- manifest;
- scope declaration;
- partition descriptors;
- signed records;
- mailbox records;
- feed records;
- Space/Channel records;
- Object References;
- encrypted payloads;
- Content Bundles;
- Checkpoints;
- integrity roots;
- tombstones or deletion markers where applicable;
- import policy hints.

## Manifest

A future stable drop manifest SHOULD define:

- drop identifier;
- creator or exporter reference;
- intended recipient or audience, if any;
- included scopes;
- included partitions;
- record count;
- byte size;
- created time or sequence marker;
- expiration, if any;
- content digest or root;
- encryption envelope reference;
- required capabilities;
- format version.

## Import behavior

Importers SHOULD:

1. verify the drop manifest;
2. verify integrity roots/checkpoints;
3. inspect declared scopes;
4. validate signatures and capabilities for contained records;
5. enforce privacy and local policy;
6. deduplicate already-seen records;
7. apply records according to consistency class;
8. defer unavailable or oversized payloads;
9. record import diagnostics where safe.

## Export behavior

Exporters SHOULD support bounded export by:

- Identity Root;
- Device;
- User Data Root partition;
- Space;
- Channel;
- Feed Collection;
- mailbox scope;
- time range;
- payload size;
- privacy scope;
- recipient set;
- headers-only mode.

## Privacy

Portable Sync Drops can leak metadata by their existence, filename, size, manifest, partition names, object identifiers, or transfer context.

Implementations SHOULD minimize exposed metadata and encrypt private manifests where appropriate.

## Low-bandwidth behavior

Portable Sync Drops SHOULD support compact drops that contain only authority/control records, headers, references, and checkpoints.

Large payloads MAY be omitted and fetched later by Object Reference.

## Security considerations

Implementations MUST guard against:

- malicious drop manifests;
- poisoned records;
- replayed stale authority state;
- oversized drops;
- decompression or parser abuse;
- private metadata leakage;
- partial payload substitution;
- treating drop import as consent;
- treating drop integrity as authorization.

## Open questions

- Canonical Portable Sync Drop encoding.
- Whether manifests are signed events, content bundles, or both.
- Required encryption envelope model.
- Maximum recommended drop sizes by profile.
- Whether Offline Profile requires QR/batch support or only file import/export.
