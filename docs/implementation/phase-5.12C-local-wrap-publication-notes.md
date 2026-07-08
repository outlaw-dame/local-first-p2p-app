# Phase 5.12C local wrap publication notes

This branch adds the idempotent helper that ensures the current local device session's public
wrap metadata is present in the identity-control projection.

It is deliberately a staging slice. The next work should wire app/bootstrap foreground paths to
call this helper, then move to Phase 5.12E sender envelope construction.

Do not enable mailbox routing or foreground mailbox sweeps until the sender path creates real
recipient-wrapped encrypted envelope events.
