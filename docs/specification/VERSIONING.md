# Specification Versioning

- Status: Draft
- Specification series: 0
- Scope: protocol specification versioning and compatibility policy

## Purpose

The protocol specification is versioned independently from the reference implementation.

A code release MAY implement one or more specification versions or profiles. A specification version does not imply a particular package version, application version, or deployment version.

## Version format

Specification versions use semantic versioning:

```txt
MAJOR.MINOR.PATCH
```

Examples:

- `0.1.0` — early draft specification;
- `0.5.0` — experimental multi-document specification;
- `1.0.0` — first stable specification;
- `1.1.0` — backward-compatible feature addition;
- `2.0.0` — breaking change.

## Pre-1.0 behavior

Before `1.0.0`, documents are Draft or Experimental by default unless explicitly marked Candidate or Stable.

Breaking changes MAY occur in `0.x` versions. Pre-1.0 breaking changes SHOULD increment the MINOR version, for example from `0.1.0` to `0.2.0`. Backward-compatible draft clarifications, editorial updates, and non-breaking fixture updates MAY increment the PATCH version.

Breaking changes SHOULD be documented in `CHANGELOG.md`, and migration notes SHOULD be provided when possible.

## Stable versioning

After `1.0.0`:

- PATCH increments are for clarifications, typo fixes, non-normative examples, and compatible editorial changes.
- MINOR increments are for backward-compatible normative additions.
- MAJOR increments are for incompatible normative changes.

## Breaking changes

A breaking change includes:

- changing required validation behavior incompatibly;
- changing object semantics incompatibly;
- changing required fields or field meanings incompatibly;
- removing a required capability from a profile;
- changing cryptographic requirements incompatibly;
- changing identity, capability, mailbox, sync, or authority semantics in a way that valid older implementations cannot safely interoperate.

## Extensions

Extensions MUST be versioned separately from the core specification.

An extension version MUST NOT redefine core semantics. If it needs to modify core behavior, it requires a core specification update or an explicitly negotiated experimental profile.

## Deprecation policy

A feature SHOULD be marked Deprecated before it is removed from a Stable specification.

Deprecation notices SHOULD include:

- reason for deprecation;
- replacement behavior;
- expected removal version, if known;
- interoperability risks;
- migration guidance.

## Compatibility claims

An implementation claiming compatibility SHOULD state:

- specification version;
- supported conformance profiles;
- supported extensions;
- unsupported optional features;
- known deviations;
- experimental feature flags.

Example:

```txt
Spec: 0.3.0
Profiles: core, messaging, offline
Extensions: transport.webrtc, sync.portable-drop
Deviations: none known
Experimental: security.frost-recovery
```

## Changelog requirements

Every normative change SHOULD update `CHANGELOG.md`.

Every breaking change MUST update `CHANGELOG.md` and SHOULD include migration guidance.
