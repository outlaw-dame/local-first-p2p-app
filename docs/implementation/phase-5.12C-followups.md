# Phase 5.12C follow-ups

This branch publishes public wrap-key metadata through the identity-control device projection.

It does not enable mailbox or chat sending yet. Remaining sender-side work:

1. Include the local device session wrap public key and wrap key ref when emitting or publishing
   the current device authorization/contact-card device row.
2. Use Phase 5.12D recipient resolution to pass active peer devices to the envelope builder.
3. Enable mailbox routing and foreground sweep only after sender and recipient key resolution are
   fully wired.
