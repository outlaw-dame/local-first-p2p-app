# Protocol Fixtures

These fixtures define protocol envelope shape expectations for `lfp2p.event.v1`.

The valid signed event fixture is a structural validation fixture. Its signature fields are non-empty placeholders because `@lfp2p/protocol` validates envelope shape, not cryptographic authenticity.

Cryptographic verification fixtures should live with the crypto package or a future cross-package conformance suite so the protocol package does not depend on crypto adapters.

Current fixture coverage:

- valid signed event envelope shape,
- valid identity controller created envelope shape,
- unsupported event major version,
- unsupported event kind,
- unsupported privacy scope,
- malformed source reference,
- identity controller event with invalid privacy scope,
- identity controller event with missing controller public key.

Cryptographic signature verification fixtures are package-local to `@lfp2p/crypto`.
