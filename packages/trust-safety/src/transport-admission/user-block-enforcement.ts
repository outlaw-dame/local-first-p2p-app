/**
 * Phase 1.62 deferral: when a bridge forwards an envelope into a user's
 * own account-local sync (multi-device fanout), the bridge MUST refuse
 * to deliver envelopes whose source actor is in that user's
 * `blockedActors` projection.
 *
 * This is a transport-side enforcement of an account-local block — the
 * bridge already cannot read the user's local-control state directly,
 * but a runtime above the bridge that *does* hold that state can call
 * this function before handing the envelope to the bridge.
 *
 * The function is pure, deterministic, and TTL-aware: an expired block
 * does not produce a rejection.
 */

import type { LocalControlState } from '../local-controls/projection.js';
import { isExpired } from '../local-controls/projection.js';

export type EnvelopeProducerContext = Readonly<{
  /** Identifier of the actor who produced the envelope (signed signer). */
  producerActorId: string;
  /** Optional: the recipient user we are forwarding *to*. */
  recipientUserId?: string;
}>;

export type UserBlockTransportDecision = Readonly<{
  shouldReject: boolean;
  /** Human-readable explanation for the audit log. */
  reason: 'producer-blocked' | 'producer-allowed';
  /** When `shouldReject` is true, the time at which the block was recorded. */
  blockedSince?: string;
}>;

/**
 * Decide whether the bridge should refuse to forward an envelope from
 * `producer` into `recipientUser`'s sync stream, given the recipient's
 * local-control state.
 *
 * Returns `{ shouldReject: true, reason: 'producer-blocked' }` only
 * when the producer is in `blockedActors` AND the block is not expired
 * at `now`. Otherwise returns `producer-allowed`.
 */
export function decideUserBlockTransport(
  recipientLocalControlState: LocalControlState,
  context: EnvelopeProducerContext,
  now: number = Date.now()
): UserBlockTransportDecision {
  const entry = recipientLocalControlState.blockedActors[context.producerActorId];
  if (entry === undefined) {
    return Object.freeze({ shouldReject: false, reason: 'producer-allowed' });
  }
  if (isExpired(entry, now)) {
    return Object.freeze({ shouldReject: false, reason: 'producer-allowed' });
  }
  return Object.freeze({
    shouldReject: true,
    reason: 'producer-blocked',
    blockedSince: entry.since
  });
}
