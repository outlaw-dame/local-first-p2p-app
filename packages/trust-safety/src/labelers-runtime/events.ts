import type { SafetyAuthority } from '../authorities.js';
import { validateSafetyAuthority } from '../authorities.js';
import { tsError } from '../errors.js';
import type {
  SafetyLabel,
  SafetyLabelDefinition
} from '../labels.js';
import { validateSafetyLabel, validateSafetyLabelDefinition } from '../labels.js';
import type {
  SafetyLabelerProfile,
  SafetyLabelerSubscription
} from '../labelers.js';
import {
  validateSafetyLabelerProfile,
  validateSafetyLabelerSubscription
} from '../labelers.js';
import type { SafetyAnnotation } from '../annotations.js';
import { validateSafetyAnnotation } from '../annotations.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import { SAFETY_REASON_CODES } from '../reason-codes.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertOneOf,
  assertPlainObject
} from '../validation.js';

export const LABELER_EVENT_VERSION = 'lfp2p.labeler-event.v1' as const;

/**
 * Six labeler-runtime lifecycle events. The doctrine:
 *
 *  - **Profile re-publish supersedes prior under same `labelerId`.**
 *    A new `safety.labeler.profile.published` event for an existing
 *    `labelerId` updates the profile (e.g. to add new supported labels
 *    or change the labeler's `kind`). Subscribers see the latest
 *    profile.
 *  - **Subscriptions are subscriber-local.** A `safety.labeler.subscribed`
 *    event records that an account-local subscriber trusts the
 *    labeler at a specific scope. Privacy-by-default (Phase 1.62
 *    rule): subscription events must use `device-local` or
 *    `account-local` envelope scope.
 *  - **Labels can only be revoked by their own issuing labeler.**
 *    Cross-labeler revocation attempts are rejected at validation
 *    time. Labelers may *disagree* by applying their own label of
 *    the opposite stance — that is the composable / stackable
 *    semantic, not a revocation.
 *  - **Annotations are append-only.** No `safety.annotation.revoked`
 *    event by design — an annotation is a signed statement about a
 *    moment in time; superseding is done with a new annotation.
 *  - **Optional label-definition publication** (`safety.label-definition.published`)
 *    is folded in here so a labeler can publish a definition once and
 *    refer to its `labelKey` from many subsequent labels.
 */
export const LABELER_EVENT_KINDS = [
  'safety.labeler.profile.published',
  'safety.label-definition.published',
  'safety.labeler.subscribed',
  'safety.labeler.unsubscribed',
  'safety.label.applied',
  'safety.label.revoked',
  'safety.annotation.created'
] as const;
export type LabelerEventKind = (typeof LABELER_EVENT_KINDS)[number];

type CommonFields = Readonly<{
  version: typeof LABELER_EVENT_VERSION;
  eventId: string;
  createdAt: string;
}>;

export type LabelerEvent =
  | Readonly<CommonFields & {
      kind: 'safety.labeler.profile.published';
      profile: SafetyLabelerProfile;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.label-definition.published';
      definition: SafetyLabelDefinition;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.labeler.subscribed';
      subscription: SafetyLabelerSubscription;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.labeler.unsubscribed';
      subscriptionId: string;
      unsubscribedAt: string;
      reasonCode?: SafetyReasonCode;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.label.applied';
      label: SafetyLabel;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.label.revoked';
      labelId: string;
      revokedBy: SafetyAuthority;
      revokedAt: string;
      reasonCode: SafetyReasonCode;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.annotation.created';
      annotation: SafetyAnnotation;
    }>;

function commonFields(record: Record<string, unknown>, label: string): CommonFields {
  assertExactVersion(record.version, LABELER_EVENT_VERSION, `${label}.version`);
  const eventId = assertId(record.eventId, `${label}.eventId`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  return Object.freeze({ version: LABELER_EVENT_VERSION, eventId, createdAt });
}

export function validateLabelerEvent(value: unknown, label = 'LabelerEvent'): LabelerEvent {
  const record = assertPlainObject(value, label);
  const kind = record.kind;
  if (
    typeof kind !== 'string' ||
    !(LABELER_EVENT_KINDS as readonly string[]).includes(kind)
  ) {
    throw tsError(
      'TS_INVALID_ENUM',
      `${label}.kind must be one of ${LABELER_EVENT_KINDS.join(', ')} (got: ${String(kind)})`
    );
  }
  const k = kind as LabelerEventKind;
  const common = commonFields(record, label);

  switch (k) {
    case 'safety.labeler.profile.published': {
      const profile = validateSafetyLabelerProfile(record.profile, `${label}.profile`);
      return Object.freeze({ ...common, kind: 'safety.labeler.profile.published', profile });
    }
    case 'safety.label-definition.published': {
      const definition = validateSafetyLabelDefinition(
        record.definition,
        `${label}.definition`
      );
      return Object.freeze({
        ...common,
        kind: 'safety.label-definition.published',
        definition
      });
    }
    case 'safety.labeler.subscribed': {
      const subscription = validateSafetyLabelerSubscription(
        record.subscription,
        `${label}.subscription`
      );
      return Object.freeze({ ...common, kind: 'safety.labeler.subscribed', subscription });
    }
    case 'safety.labeler.unsubscribed': {
      const subscriptionId = assertId(record.subscriptionId, `${label}.subscriptionId`);
      const unsubscribedAt = assertIso8601(record.unsubscribedAt, `${label}.unsubscribedAt`);
      const out: {
        -readonly [K in keyof Extract<LabelerEvent, { kind: 'safety.labeler.unsubscribed' }>]:
          Extract<LabelerEvent, { kind: 'safety.labeler.unsubscribed' }>[K];
      } = {
        ...common,
        kind: 'safety.labeler.unsubscribed',
        subscriptionId,
        unsubscribedAt
      };
      if (record.reasonCode !== undefined) {
        out.reasonCode = assertOneOf(
          record.reasonCode,
          SAFETY_REASON_CODES,
          `${label}.reasonCode`
        );
      }
      return Object.freeze(out);
    }
    case 'safety.label.applied': {
      const labelObj = validateSafetyLabel(record.label, `${label}.label`);
      return Object.freeze({ ...common, kind: 'safety.label.applied', label: labelObj });
    }
    case 'safety.label.revoked': {
      const labelId = assertId(record.labelId, `${label}.labelId`);
      const revokedBy = validateSafetyAuthority(record.revokedBy, `${label}.revokedBy`);
      const revokedAt = assertIso8601(record.revokedAt, `${label}.revokedAt`);
      const reasonCode = assertOneOf(record.reasonCode, SAFETY_REASON_CODES, `${label}.reasonCode`);
      return Object.freeze({
        ...common,
        kind: 'safety.label.revoked',
        labelId,
        revokedBy,
        revokedAt,
        reasonCode
      });
    }
    case 'safety.annotation.created': {
      const annotation = validateSafetyAnnotation(record.annotation, `${label}.annotation`);
      return Object.freeze({ ...common, kind: 'safety.annotation.created', annotation });
    }
  }
}
