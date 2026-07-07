# Phase 5.12D Recipient Resolution Notes

This branch adds a narrow sender-side resolver for local identity projections.

The implementation is intentionally staged because the repository still needs the preceding publication step:

1. Phase 5.12C must publish `wrapPublicKey` and `wrapKeyRef` into synced identity/contact-card data.
2. This resolver can then turn those projections into deterministic envelope recipients.
3. Phase 5.12E-sender can wire mailbox/chat send paths to `createEnvelopeEvent`.

Do not enable app-shell mailbox routing or foreground sweep until the sender path resolves real peer recipient devices from published wrap metadata.
