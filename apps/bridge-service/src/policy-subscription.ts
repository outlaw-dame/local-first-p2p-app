/**
 * Phase 4.6 — Operator policy subscription runtime.
 *
 * The bridge-operator-level analogue of the PWA user's aggregator
 * subscription list (Phase 1.8.7). The operator subscribes to labelers
 * whose outputs gate transport-level admission. A `hard-safety` label
 * from a listed labeler rejects the envelope with `policy.operator-label`.
 *
 * Design discipline:
 *
 *  - Labeler decisions are ADVISORY until the operator explicitly lists
 *    the labeler in the policy subscription. An unlisted labeler CANNOT
 *    produce a bridge-level rejection.
 *  - Check #8.5 runs AFTER the rate-limit check (#8) and BEFORE the
 *    user-block check (#9). It never triggers a reputation penalty —
 *    the subject may be legitimate on other surfaces.
 *  - The labeler-state snapshot is replaced atomically via
 *    `refreshLabelersState`. The admission gateway holds a reference
 *    that the operator updates without restarting the process.
 *  - This module operates only on the `subjectKey` of the envelope's
 *    `producerActorId` so it never inspects decrypted payload content
 *    (Phase 1.63 non-negotiable).
 */
import {
  createEmptyLabelersState,
  effectiveLabelsForSubject,
  mostRestrictiveAction,
  subjectKey,
  type LabelersState,
  type StackedAction
} from '@lfp2p/trust-safety';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolicySubscriptionEntry = Readonly<{
  labelerId: string;
  priority: number;
  /** Reputation algorithm identifier — reserved for future weighting. */
  algorithm: string;
}>;

export type PolicySubscriptionRuntimeOptions = Readonly<{
  /** The labelers whose outputs are promoted to enforcement. */
  subscriptions: ReadonlyArray<PolicySubscriptionEntry>;
  /**
   * The operator's subscriber actor id — used as the `subscriberActorId`
   * argument to `effectiveLabelsForSubject`. Only labels applied on behalf
   * of subscriptions matching this id are visible.
   */
  subscriberActorId: string;
}>;

// ---------------------------------------------------------------------------
// Runtime class
// ---------------------------------------------------------------------------

export class PolicySubscriptionRuntime {
  readonly #subscriptions: ReadonlyArray<PolicySubscriptionEntry>;
  readonly #subscriberActorId: string;
  #labelersState: LabelersState;

  constructor(options: PolicySubscriptionRuntimeOptions) {
    this.#subscriptions = Object.freeze([...options.subscriptions]);
    this.#subscriberActorId = options.subscriberActorId;
    this.#labelersState = createEmptyLabelersState();
  }

  /**
   * Replace the labeler-state snapshot. The new snapshot is used on
   * the next `checkProducerLabels` call with no process restart.
   */
  refreshLabelersState(newSnapshot: LabelersState): void {
    this.#labelersState = newSnapshot;
  }

  get subscriptions(): ReadonlyArray<PolicySubscriptionEntry> {
    return this.#subscriptions;
  }

  /**
   * Check whether the `producerActorId` carries a `hard-safety` label
   * from any listed labeler in the current `LabelersState` snapshot.
   *
   * Returns `'policy.operator-label'` when a listed labeler has applied
   * a `hard-safety` action to the producer, `undefined` otherwise.
   *
   * The `actor|<actorId>` subject key is the narrow transport-safe
   * projection — this never touches payload content.
   */
  checkProducerLabels(producerActorId: string): 'policy.operator-label' | undefined {
    if (!producerActorId || typeof producerActorId !== 'string') return undefined;
    if (this.#subscriptions.length === 0) return undefined;

    const key = subjectKey({ type: 'actor', actorId: producerActorId });
    const allLabels = effectiveLabelsForSubject(
      this.#labelersState,
      key,
      this.#subscriberActorId
    );

    // Enforce the runtime subscription boundary: only labels from labelers
    // explicitly listed in this runtime's #subscriptions can reject.
    // Without this filter, a labeler subscribed in LabelersState but NOT in
    // the operator's runtime list could still trigger a bridge-level rejection,
    // violating the "unlisted labeler cannot reject" doctrine.
    const subscribedLabelerIds = new Set(this.#subscriptions.map((s) => s.labelerId));
    const enforcedLabels = allLabels.filter((l) => l.issuerLabelerId !== undefined && subscribedLabelerIds.has(l.issuerLabelerId));

    const action: StackedAction = mostRestrictiveAction(enforcedLabels);
    // 'quarantine' is the most restrictive StackedAction and maps to
    // the plan's "hard-safety transport-scope label" concept.
    if (action === 'quarantine') {
      return 'policy.operator-label';
    }
    return undefined;
  }
}
