# Specification Changelog

- Status: Draft
- Specification series: 0
- Scope: changelog for specification evolution

## Unreleased

### Added

- Created the `docs/specification/` tree as the implementation-independent protocol specification home.
- Added specification framework documents:
  - `README.md`
  - `DESIGN_GOALS.md`
  - `VERSIONING.md`
  - `CONFORMANCE.md`
  - `GLOSSARY.md`
  - `RFC2119.md`
  - `PROFILES.md`
  - `REGISTRIES.md`
  - `SECURITY_MODEL.md`
  - `SPEC_STATUS.md`
  - `TEMPLATE.md`
- Added specification series 8 (security) initial documents (Phase 6 doctrine gate):
  - `08-security/mls-group-keying.md`
  - `08-security/mls-virtual-delivery-service.md`
  - `08-security/mls-fork-detection-and-recovery.md`
  - `08-security/encrypted-evidence.md`
- Added glossary terms: Encrypted Evidence, Epoch, Fork, Group-Control Record, KeyPackage, MLS Group, Virtual Delivery Service, Welcome.
- Registered (Draft) in the registry framework: the eleven `mls.*` Group-Control Record event kinds; capabilities `availability.mls-key-package-store`, `availability.mls-welcome-delivery`, `availability.mls-message-fanout`; error codes `key-package-exhausted`, `key-package-expired`, `fork-unresolved`, `recovery-unauthorized`, `evidence-undecryptable`, `evidence-digest-mismatch`.
- Established the no-undocumented-primitive rule.
- Established initial conformance profile taxonomy.
- Established initial registry framework.
- Established initial specification status model.

### Changed

- None.

### Deprecated

- None.

### Removed

- None.

## Changelog policy

Every normative specification change SHOULD update this changelog.

Breaking changes MUST update this changelog and SHOULD include migration guidance.

Framework-only changes MAY be grouped under the current unreleased section until the first explicit specification version is tagged.
