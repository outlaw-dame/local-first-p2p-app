/**
 * Subscription overlap detection.
 *
 * Goal: warn a user before they subscribe to two labelers that
 * functionally do the same job (e.g. two `classify.spam` labelers, or
 * two community-aggregators that re-publish from the same source set).
 *
 * Overlap is computed across two dimensions:
 *  - **capabilities**: structured `LabelerCapability.capabilityId`
 *    declarations from the labeler profile (Phase 1.69).
 *  - **supportedLabels**: the labeler's declared `labelKey`s.
 *
 * Capability overlap is the stronger signal (semantic). Label-key
 * overlap is the fallback signal (name-only). The UI surfaces both,
 * with capability overlap weighted higher.
 */

import type { LabelersState } from './projection.js';

export type OverlapLevel = 'full' | 'partial' | 'capability-only' | 'label-only';

export type OverlappingPair = Readonly<{
  labelerIdA: string;
  labelerIdB: string;
  overlappingCapabilityIds: ReadonlyArray<string>;
  overlappingLabelKeys: ReadonlyArray<string>;
  /**
   * - `full`: every declared capability of A is also declared by B
   *   (or vice versa). Strong duplicate signal.
   * - `capability-only`: at least one shared capability but neither
   *   side is a strict subset.
   * - `label-only`: no shared capabilities but at least one shared
   *   `labelKey` (the fallback signal).
   * - `partial`: shared capabilities AND shared label keys but neither
   *   side is a subset (the common case).
   */
  level: OverlapLevel;
}>;

function intersection<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): T[] {
  const bSet = new Set(b);
  const out: T[] = [];
  for (const v of a) {
    if (bSet.has(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

function isSubsetOrEqual<T>(small: ReadonlyArray<T>, big: ReadonlyArray<T>): boolean {
  if (small.length === 0) return false;
  const bigSet = new Set(big);
  for (const v of small) {
    if (!bigSet.has(v)) return false;
  }
  return true;
}

/**
 * Return every pair of *active* subscribed labelers (for the given
 * subscriber) whose declared capabilities or supportedLabels overlap.
 *
 * Pure function. Returns pairs in a stable order (labelerIdA <
 * labelerIdB lexicographically) so the output is deterministic.
 */
export function findOverlappingSubscriptions(
  state: LabelersState,
  subscriberActorId: string
): ReadonlyArray<OverlappingPair> {
  // Build the list of active subscribed labelerIds for this subscriber.
  const subscribedLabelerIds: string[] = [];
  for (const sub of Object.values(state.subscriptionsById)) {
    if (sub.status !== 'active') continue;
    if (sub.subscription.subscriberActorId !== subscriberActorId) continue;
    if (!subscribedLabelerIds.includes(sub.subscription.labelerId)) {
      subscribedLabelerIds.push(sub.subscription.labelerId);
    }
  }
  subscribedLabelerIds.sort();

  const out: OverlappingPair[] = [];
  for (let i = 0; i < subscribedLabelerIds.length; i += 1) {
    for (let j = i + 1; j < subscribedLabelerIds.length; j += 1) {
      const idA = subscribedLabelerIds[i]!;
      const idB = subscribedLabelerIds[j]!;
      const profA = state.labelerProfilesById[idA];
      const profB = state.labelerProfilesById[idB];
      if (profA === undefined || profB === undefined) continue;

      const capsA = (profA.capabilities ?? []).map((c) => c.capabilityId);
      const capsB = (profB.capabilities ?? []).map((c) => c.capabilityId);
      const overlapCaps = intersection(capsA, capsB);
      const overlapLabels = intersection(profA.supportedLabels, profB.supportedLabels);
      if (overlapCaps.length === 0 && overlapLabels.length === 0) continue;

      let level: OverlapLevel;
      if (
        capsA.length > 0 &&
        capsB.length > 0 &&
        (isSubsetOrEqual(capsA, capsB) || isSubsetOrEqual(capsB, capsA))
      ) {
        level = 'full';
      } else if (overlapCaps.length > 0 && overlapLabels.length === 0) {
        level = 'capability-only';
      } else if (overlapCaps.length === 0 && overlapLabels.length > 0) {
        level = 'label-only';
      } else {
        level = 'partial';
      }

      out.push(
        Object.freeze({
          labelerIdA: idA,
          labelerIdB: idB,
          overlappingCapabilityIds: Object.freeze(overlapCaps),
          overlappingLabelKeys: Object.freeze(overlapLabels),
          level
        })
      );
    }
  }
  return Object.freeze(out);
}

export type RedundancyAssessment = Readonly<{
  isRedundant: boolean;
  overlappingWithLabelerId?: string;
  overlappingCapabilityIds: ReadonlyArray<string>;
  overlappingLabelKeys: ReadonlyArray<string>;
}>;

/**
 * "Should I subscribe to `candidateLabelerId`?" check. Given the
 * subscriber's current subscriptions, return whether the candidate
 * meaningfully overlaps any active subscription. The strongest match
 * (any subscription whose capabilities are a subset of or equal to the
 * candidate's, or vice versa) is reported.
 *
 * Intended for a UI's "you already subscribe to a similar labeler"
 * warning before completing a new subscription.
 */
export function detectRedundantSubscription(
  state: LabelersState,
  subscriberActorId: string,
  candidateLabelerId: string
): RedundancyAssessment {
  const candidate = state.labelerProfilesById[candidateLabelerId];
  if (candidate === undefined) {
    return Object.freeze({
      isRedundant: false,
      overlappingCapabilityIds: Object.freeze([]),
      overlappingLabelKeys: Object.freeze([])
    });
  }
  const candidateCaps = (candidate.capabilities ?? []).map((c) => c.capabilityId);

  let bestMatch: RedundancyAssessment = Object.freeze({
    isRedundant: false,
    overlappingCapabilityIds: Object.freeze([]),
    overlappingLabelKeys: Object.freeze([])
  });

  for (const sub of Object.values(state.subscriptionsById)) {
    if (sub.status !== 'active') continue;
    if (sub.subscription.subscriberActorId !== subscriberActorId) continue;
    if (sub.subscription.labelerId === candidateLabelerId) continue;
    const existing = state.labelerProfilesById[sub.subscription.labelerId];
    if (existing === undefined) continue;
    const existingCaps = (existing.capabilities ?? []).map((c) => c.capabilityId);
    const capOverlap = intersection(candidateCaps, existingCaps);
    const labelOverlap = intersection(candidate.supportedLabels, existing.supportedLabels);
    if (capOverlap.length === 0 && labelOverlap.length === 0) continue;
    const isRedundant =
      capOverlap.length > 0 &&
      (isSubsetOrEqual(candidateCaps, existingCaps) ||
        isSubsetOrEqual(existingCaps, candidateCaps));
    if (
      isRedundant ||
      capOverlap.length + labelOverlap.length >
        bestMatch.overlappingCapabilityIds.length + bestMatch.overlappingLabelKeys.length
    ) {
      const out: { -readonly [K in keyof RedundancyAssessment]: RedundancyAssessment[K] } = {
        isRedundant,
        overlappingCapabilityIds: Object.freeze(capOverlap),
        overlappingLabelKeys: Object.freeze(labelOverlap)
      };
      out.overlappingWithLabelerId = sub.subscription.labelerId;
      bestMatch = Object.freeze(out);
      if (isRedundant) break;
    }
  }
  return bestMatch;
}
