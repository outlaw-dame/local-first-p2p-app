import type { Severity } from '../actions.js';
import type { SafetyAnnotation } from '../annotations.js';
import { tsError } from '../errors.js';
import type {
  LabelerKind,
  SafetyLabelActionOverride,
  SafetyLabelerProfile,
  SafetyLabelerSubscription
} from '../labelers.js';
import type { SafetyLabel, SafetyLabelDefinition } from '../labels.js';
import { subjectKey } from '../curation-runtime/projection.js';
import {
  withFrozenAppliedEventId as withAppliedEventId,
  withFrozenBucketAppend,
  withFrozenRecordSet as withRecordSet
} from '../projection-helpers.js';
import type { LabelerEvent } from './events.js';
import { validateLabelerEvent } from './events.js';

// --- Record shapes -------------------------------------------------------

export type LabelStatus = 'active' | 'revoked';

export type LabelRecord = Readonly<{
  label: SafetyLabel;
  status: LabelStatus;
  revokedAt?: string;
  revokedReasonCode?: string;
}>;

export type SubscriptionStatus = 'active' | 'unsubscribed';

export type SubscriptionRecord = Readonly<{
  subscription: SafetyLabelerSubscription;
  status: SubscriptionStatus;
  unsubscribedAt?: string;
}>;

// --- State ---------------------------------------------------------------

/**
 * Frozen labeler-runtime projection. Stores:
 *
 *  - `labelerProfilesById`: the latest profile for each labelerId.
 *    Re-publish supersedes; the older profile is gone.
 *  - `labelDefinitionsByKey`: keyed by `${namespace}::${labelKey}` so
 *    the same labelKey may be defined in multiple namespaces without
 *    collision.
 *  - `subscriptionsById`: subscriber-side subscription records. A
 *    subscriber's identity is implicit in the consumer (each consumer
 *    has its own projection of *their* subscriptions).
 *  - `labelsByLabelId`: all labels (active or revoked). The record
 *    carries status so revocation is auditable.
 *  - `labelsBySubjectKey`: bucket index of labelIds per subject, used
 *    by `effectiveLabelsForSubject`.
 *  - `annotationsById`: append-only annotation log.
 *  - `appliedEventIds`: replay idempotency.
 */
export type LabelersState = Readonly<{
  labelerProfilesById: Readonly<Record<string, SafetyLabelerProfile>>;
  labelDefinitionsByKey: Readonly<Record<string, SafetyLabelDefinition>>;
  subscriptionsById: Readonly<Record<string, SubscriptionRecord>>;
  labelsByLabelId: Readonly<Record<string, LabelRecord>>;
  labelsBySubjectKey: Readonly<Record<string, ReadonlyArray<string>>>;
  annotationsById: Readonly<Record<string, SafetyAnnotation>>;
  appliedEventIds: ReadonlySet<string>;
}>;

export function createEmptyLabelersState(): LabelersState {
  return Object.freeze({
    labelerProfilesById: Object.freeze({}),
    labelDefinitionsByKey: Object.freeze({}),
    subscriptionsById: Object.freeze({}),
    labelsByLabelId: Object.freeze({}),
    labelsBySubjectKey: Object.freeze({}),
    annotationsById: Object.freeze({}),
    appliedEventIds: Object.freeze(new Set<string>())
  });
}

function definitionKey(namespace: string, labelKey: string): string {
  return `${namespace}::${labelKey}`;
}

// --- Apply ---------------------------------------------------------------

/**
 * Apply a single labeler-runtime event to the projection.
 *
 * Determinism rules:
 *  - Applying the same event twice (matching `eventId`) is a no-op.
 *  - Validation runs before any state mutation.
 *  - Labels can only be revoked by their own issuing labeler — a
 *    `safety.label.revoked` event whose `revokedBy.actorId` is not the
 *    original label's `issuer.actorId` throws `TS_INVALID_LABEL`.
 *    This is the structural enforcement of "labelers can only revoke
 *    their own labels; cross-labeler disagreement uses opposing labels,
 *    not revocation."
 *  - Unsubscribing an unknown or already-unsubscribed subscription
 *    throws `TS_LIFECYCLE_TRANSITION`.
 *  - Profile re-publish under the same `labelerId` supersedes; this is
 *    intentional, not a state-machine violation.
 *  - Label-definition re-publish under the same `(namespace, labelKey)`
 *    pair is rejected — definitions are append-only because they're
 *    referenced from labels by key. A new definition requires a new
 *    `labelKey` or `namespace`.
 *  - Annotations are append-only by `annotationId`; duplicate id is a
 *    silent no-op.
 */
export function applyLabelerEvent(
  state: LabelersState,
  event: LabelerEvent | unknown,
  label = 'applyLabelerEvent'
): LabelersState {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw tsError('TS_INVALID_INPUT', `${label}: event must be a plain object`);
  }
  const e = validateLabelerEvent(event, label);
  if (state.appliedEventIds.has(e.eventId)) return state;
  const appliedEventIds = withAppliedEventId(state.appliedEventIds, e.eventId);

  switch (e.kind) {
    case 'safety.labeler.profile.published': {
      return Object.freeze({
        ...state,
        labelerProfilesById: withRecordSet(
          state.labelerProfilesById,
          e.profile.labelerId,
          e.profile
        ),
        appliedEventIds
      });
    }
    case 'safety.label-definition.published': {
      const k = definitionKey(e.definition.namespace, e.definition.labelKey);
      if (state.labelDefinitionsByKey[k] !== undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: label definition "${k}" already exists (definitions are append-only)`
        );
      }
      return Object.freeze({
        ...state,
        labelDefinitionsByKey: withRecordSet(state.labelDefinitionsByKey, k, e.definition),
        appliedEventIds
      });
    }
    case 'safety.labeler.subscribed': {
      const id = e.subscription.subscriptionId;
      if (state.subscriptionsById[id] !== undefined) {
        // Re-subscribing an existing id is rejected — the subscriber
        // should issue an unsubscribe first or use a new id. This
        // keeps the audit chain unambiguous.
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: subscription "${id}" already exists`
        );
      }
      const record: SubscriptionRecord = Object.freeze({
        subscription: e.subscription,
        status: 'active'
      });
      return Object.freeze({
        ...state,
        subscriptionsById: withRecordSet(state.subscriptionsById, id, record),
        appliedEventIds
      });
    }
    case 'safety.labeler.unsubscribed': {
      const existing = state.subscriptionsById[e.subscriptionId];
      if (existing === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot unsubscribe unknown subscription "${e.subscriptionId}"`
        );
      }
      if (existing.status === 'unsubscribed') {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: subscription "${e.subscriptionId}" is already unsubscribed`
        );
      }
      const next: SubscriptionRecord = Object.freeze({
        subscription: existing.subscription,
        status: 'unsubscribed',
        unsubscribedAt: e.unsubscribedAt
      });
      return Object.freeze({
        ...state,
        subscriptionsById: withRecordSet(state.subscriptionsById, e.subscriptionId, next),
        appliedEventIds
      });
    }
    case 'safety.label.applied': {
      const id = e.label.labelId;
      if (state.labelsByLabelId[id] !== undefined) {
        // Re-applying a label under the same labelId is rejected —
        // a labeler that wants to "refresh" a label must revoke and
        // issue a new labelId. Keeps audit history unambiguous.
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: label "${id}" already applied`
        );
      }
      const sKey = subjectKey(e.label.subject);
      const record: LabelRecord = Object.freeze({
        label: e.label,
        status: 'active'
      });
      return Object.freeze({
        ...state,
        labelsByLabelId: withRecordSet(state.labelsByLabelId, id, record),
        labelsBySubjectKey: withFrozenBucketAppend(state.labelsBySubjectKey, sKey, id),
        appliedEventIds
      });
    }
    case 'safety.label.revoked': {
      const existing = state.labelsByLabelId[e.labelId];
      if (existing === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot revoke unknown labelId "${e.labelId}"`
        );
      }
      if (existing.status === 'revoked') {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: label "${e.labelId}" already revoked`
        );
      }
      // **Cross-labeler revoke guard**: a label may only be revoked
      // by an authority whose actor matches the original label's
      // issuer actor. Cross-labeler revocation attempts are rejected.
      const originalIssuerActorId = existing.label.issuer.actorId;
      if (e.revokedBy.actorId !== originalIssuerActorId) {
        throw tsError(
          'TS_INVALID_LABEL',
          `${label}: revoker actorId "${e.revokedBy.actorId}" does not match the label's original issuer actorId "${originalIssuerActorId}" — labelers can only revoke their own labels; cross-labeler disagreement is expressed by issuing an opposing label, not by revocation`
        );
      }
      const next: LabelRecord = Object.freeze({
        label: existing.label,
        status: 'revoked',
        revokedAt: e.revokedAt,
        revokedReasonCode: e.reasonCode
      });
      return Object.freeze({
        ...state,
        labelsByLabelId: withRecordSet(state.labelsByLabelId, e.labelId, next),
        appliedEventIds
      });
    }
    case 'safety.annotation.created': {
      const id = e.annotation.annotationId;
      if (state.annotationsById[id] !== undefined) {
        // Annotations are idempotent on annotationId; duplicate is a
        // silent no-op so replay does not loop.
        return Object.freeze({ ...state, appliedEventIds });
      }
      return Object.freeze({
        ...state,
        annotationsById: withRecordSet(state.annotationsById, id, e.annotation),
        appliedEventIds
      });
    }
  }
}

export function seedLabelersState(
  events: Iterable<LabelerEvent | unknown>,
  label = 'seedLabelersState'
): LabelersState {
  let state = createEmptyLabelersState();
  let i = 0;
  for (const event of events) {
    state = applyLabelerEvent(state, event, `${label}[${i}]`);
    i += 1;
  }
  return state;
}

// --- Composable / stackable label resolution ----------------------------

/** The action a subscriber will see after stacking. */
export const STACKED_ACTIONS = [
  'allow',
  'warn',
  'collapse',
  'blur-media',
  'downrank',
  'hide',
  'quarantine'
] as const;
export type StackedAction = (typeof STACKED_ACTIONS)[number];

const STACKED_ACTION_RANK: Readonly<Record<StackedAction, number>> = {
  allow: 0,
  downrank: 1,
  warn: 2,
  'blur-media': 3,
  collapse: 4,
  hide: 5,
  quarantine: 6
};

export type ResolvedLabel = Readonly<{
  labelId: string;
  labelKey: string;
  namespace: string;
  /** The actorId of the labeler that issued this label. */
  issuerActorId: string;
  /** The labelerId of the issuing labeler's profile, if known. */
  issuerLabelerId?: string;
  /** Self-declared kind of the issuing labeler, if known. Advisory. */
  labelerKind?: LabelerKind;
  severity?: Severity;
  confidence?: number;
  /**
   * The effective action this label produces for the subscriber, after
   * applying any matching `actionOverrides` on the subscriber's
   * `SafetyLabelerSubscription` record. When no override matches, this
   * is the label's `severity`-derived action or the definition's
   * `defaultAction` if a definition is present and recognized; absent
   * both, defaults to `warn` (conservative).
   */
  effectiveAction: StackedAction;
  appliedAt: string;
}>;

function applyActionOverride(
  overrides: ReadonlyArray<SafetyLabelActionOverride> | undefined,
  labelKey: string,
  namespace: string
): StackedAction | undefined {
  if (overrides === undefined) return undefined;
  for (const o of overrides) {
    if (o.labelKey === labelKey && o.namespace === namespace) {
      // The override action is from a subset of SafetyAction; restrict
      // to the stacked-action set.
      if ((STACKED_ACTIONS as readonly string[]).includes(o.action)) {
        return o.action as StackedAction;
      }
      return 'warn';
    }
  }
  return undefined;
}

function defaultActionForLabel(
  state: LabelersState,
  label: SafetyLabel
): StackedAction {
  const def = state.labelDefinitionsByKey[
    `${label.namespace}::${label.labelKey}`
  ];
  if (def !== undefined) {
    // SafetyLabelDefinition.defaultAction is from the full SafetyAction
    // enum; narrow to the stacked-action set.
    if ((STACKED_ACTIONS as readonly string[]).includes(def.defaultAction)) {
      return def.defaultAction as StackedAction;
    }
  }
  // No definition and no override — conservative default by severity.
  if (label.severity === 'critical' || label.severity === 'high') return 'collapse';
  if (label.severity === 'medium') return 'warn';
  return 'allow';
}

/**
 * Resolve the effective labels for `subjectKey` from `subscriberId`'s
 * point of view. Returns one `ResolvedLabel` per (labelKey × issuing
 * labeler) pair so the caller can see the full composable stack.
 *
 * Filtering rules (per the doctrine):
 *  - Revoked labels are excluded.
 *  - Labels not matching any of the subscriber's active subscriptions
 *    are excluded.
 *  - For each candidate label, the matching subscription is the one
 *    whose `labelerId` matches the label's `issuer.authorityId`
 *    (the labelerId-as-authority convention) AND whose
 *    `trustedNamespaces` includes the label's namespace AND, if
 *    `trustedLabels` is set, includes the label's labelKey.
 *  - The subscriber's `actionOverrides` are applied to derive the
 *    `effectiveAction`. With no override, the definition's
 *    `defaultAction` is used; without a definition, severity-derived
 *    defaults apply.
 *
 * The function returns a stable order: by `appliedAt` ascending so the
 * earliest-applied label appears first in the stack. Callers that want
 * a single combined decision can pass the result to
 * `mostRestrictiveAction`.
 */
export function effectiveLabelsForSubject(
  state: LabelersState,
  subjectKeyValue: string,
  subscriberActorId: string,
  options?: Readonly<{
    /** Restrict to labels in these namespaces. Default: all subscribed namespaces. */
    namespaces?: ReadonlyArray<string>;
  }>
): ReadonlyArray<ResolvedLabel> {
  const labelIds = state.labelsBySubjectKey[subjectKeyValue] ?? [];
  if (labelIds.length === 0) return Object.freeze([]);

  // Index the subscriber's active subscriptions by labelerId for O(1)
  // lookup. Subscriptions reference labelers by their `labelerId`; the
  // stored label's issuer is a SafetyAuthority whose authorityId we
  // treat as the labelerId per the policy doc convention.
  const subscribedLabelerIds = new Map<string, SafetyLabelerSubscription>();
  for (const sub of Object.values(state.subscriptionsById)) {
    if (sub.status !== 'active') continue;
    if (sub.subscription.subscriberActorId !== subscriberActorId) continue;
    subscribedLabelerIds.set(sub.subscription.labelerId, sub.subscription);
  }

  const namespaceFilter = options?.namespaces;

  const resolved: ResolvedLabel[] = [];
  for (const labelId of labelIds) {
    const record = state.labelsByLabelId[labelId];
    if (record === undefined || record.status !== 'active') continue;
    const labelObj = record.label;
    if (
      namespaceFilter !== undefined &&
      !namespaceFilter.includes(labelObj.namespace)
    ) {
      continue;
    }
    const issuerLabelerId = labelObj.issuer.authorityId;
    const subscription = subscribedLabelerIds.get(issuerLabelerId);
    if (subscription === undefined) continue;
    if (!subscription.trustedNamespaces.includes(labelObj.namespace)) continue;
    if (
      subscription.trustedLabels !== undefined &&
      !subscription.trustedLabels.includes(labelObj.labelKey)
    ) {
      continue;
    }
    const override = applyActionOverride(
      subscription.actionOverrides,
      labelObj.labelKey,
      labelObj.namespace
    );
    const effectiveAction: StackedAction =
      override ?? defaultActionForLabel(state, labelObj);
    const profile = state.labelerProfilesById[issuerLabelerId];
    const out: { -readonly [K in keyof ResolvedLabel]: ResolvedLabel[K] } = {
      labelId: labelObj.labelId,
      labelKey: labelObj.labelKey,
      namespace: labelObj.namespace,
      issuerActorId: labelObj.issuer.actorId,
      issuerLabelerId,
      effectiveAction,
      appliedAt: labelObj.createdAt
    };
    if (labelObj.severity !== undefined) out.severity = labelObj.severity;
    if (labelObj.confidence !== undefined) out.confidence = labelObj.confidence;
    if (profile?.kind !== undefined) out.labelerKind = profile.kind;
    resolved.push(Object.freeze(out));
  }
  // Stable sort by `appliedAt` ascending. Equal timestamps preserve
  // bucket insertion order via the prior loop.
  resolved.sort((a, b) => (a.appliedAt < b.appliedAt ? -1 : a.appliedAt > b.appliedAt ? 1 : 0));
  return Object.freeze(resolved);
}

/**
 * Combine a stack of resolved labels into a single most-restrictive
 * action. Returns `'allow'` if the stack is empty.
 */
export function mostRestrictiveAction(stack: ReadonlyArray<ResolvedLabel>): StackedAction {
  let winner: StackedAction = 'allow';
  for (const r of stack) {
    if (STACKED_ACTION_RANK[r.effectiveAction] > STACKED_ACTION_RANK[winner]) {
      winner = r.effectiveAction;
    }
  }
  return winner;
}
