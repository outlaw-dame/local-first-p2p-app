# Envelope progress

Implemented branch scaffold and builder package.

Before merge:

- Add the root TypeScript project reference for `packages/envelope`.
- Add tests for recipient resolution, metadata binding, event construction, and signature verification.
- Validate that recipient wrapping keys are dedicated X25519 keys and are not reused signing keys.
- Add a redaction helper for envelope fields before any future logging path consumes these events.
- Run lint, typecheck, tests, and build.
