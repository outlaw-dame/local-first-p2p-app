import type { SafetyAuthority } from '../authorities.js';
import { validateSafetyAuthority } from '../authorities.js';
import { tsError } from '../errors.js';
import type { SafetyPolicy } from '../policies.js';
import { validateSafetyPolicy } from '../policies.js';
import type { SafetyPolicyDecision } from '../policy-decisions.js';
import { validateSafetyPolicyDecision } from '../policy-decisions.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import { SAFETY_REASON_CODES } from '../reason-codes.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertOneOf,
  assertPlainObject,
  assertText
} from '../validation.js';

export const MODERATION_EVENT_VERSION = 'lfp2p.moderation-event.v1' as const;

/**
 * Seven moderation-runtime lifecycle event kinds, per the
 * `Event family reservations / Policy and moderation decisions`
 * section of `docs/protocol/trust-safety-event-policy.md`. The
 * doctrine:
 *
 *  - **A `SafetyPolicy` is a versioned document.** Updates produce a
 *    new version under the same `policyId`. Deprecation marks the
 *    policy retired but does NOT retroactively reverse decisions made
 *    under it — that would erase audit history.
 *  - **`SafetyPolicyDecision`s reference a specific `policyVersion`.**
 *    Even after the policy is updated or deprecated, the decision's
 *    audit chain points to the exact policy text it was made under.
 *  - **Moderation queue items are operator-scoped.** A community
 *    moderator's queue is not a bridge operator's queue. The queue
 *    projection is per-authority.
 *  - **Queue items can skip the assignment step.** Clear-cut cases
 *    (`duplicate`, `invalid`) may go directly from `open → resolved`.
 *  - **A queue item resolution can cite the decision it produced.**
 *    The `resolutionDecisionId` cross-references back to a
 *    `safety.policy.decision.recorded` event in this same projection.
 */
export const MODERATION_EVENT_KINDS = [
  'safety.policy.created',
  'safety.policy.updated',
  'safety.policy.deprecated',
  'safety.policy.decision.recorded',
  'moderation.queue.item.created',
  'moderation.queue.item.assigned',
  'moderation.queue.item.resolved'
] as const;
export type ModerationEventKind = (typeof MODERATION_EVENT_KINDS)[number];

export const QUEUE_RESOLUTIONS = [
  'acted',
  'dismissed',
  'duplicate',
  'invalid',
  'forwarded'
] as const;
export type QueueResolution = (typeof QUEUE_RESOLUTIONS)[number];

export const QUEUE_SOURCE_KINDS = ['report', 'label', 'annotation', 'manual'] as const;
export type QueueSourceKind = (typeof QUEUE_SOURCE_KINDS)[number];

type CommonFields = Readonly<{
  version: typeof MODERATION_EVENT_VERSION;
  eventId: string;
  createdAt: string;
}>;

export type ModerationEvent =
  | Readonly<CommonFields & {
      kind: 'safety.policy.created';
      policy: SafetyPolicy;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.policy.updated';
      policy: SafetyPolicy;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.policy.deprecated';
      policyId: string;
      deprecatedBy: SafetyAuthority;
      deprecatedAt: string;
      reasonCode: SafetyReasonCode;
      replacementPolicyId?: string;
    }>
  | Readonly<CommonFields & {
      kind: 'safety.policy.decision.recorded';
      decision: SafetyPolicyDecision;
      sourceQueueItemId?: string;
    }>
  | Readonly<CommonFields & {
      kind: 'moderation.queue.item.created';
      queueItemId: string;
      ownerAuthority: SafetyAuthority;
      sourceKind: QueueSourceKind;
      sourceId: string;
      reasonCode: SafetyReasonCode;
      summary?: string;
    }>
  | Readonly<CommonFields & {
      kind: 'moderation.queue.item.assigned';
      queueItemId: string;
      assignedTo: SafetyAuthority;
      assignedAt: string;
    }>
  | Readonly<CommonFields & {
      kind: 'moderation.queue.item.resolved';
      queueItemId: string;
      resolvedBy: SafetyAuthority;
      resolvedAt: string;
      resolution: QueueResolution;
      resolutionReasonCode: SafetyReasonCode;
      resolutionDecisionId?: string;
      resolutionNotes?: string;
    }>;

const MAX_SUMMARY_LENGTH = 2048;
const MAX_RESOLUTION_NOTES_LENGTH = 4096;

function commonFields(record: Record<string, unknown>, label: string): CommonFields {
  assertExactVersion(record.version, MODERATION_EVENT_VERSION, `${label}.version`);
  const eventId = assertId(record.eventId, `${label}.eventId`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  return Object.freeze({ version: MODERATION_EVENT_VERSION, eventId, createdAt });
}

export function validateModerationEvent(
  value: unknown,
  label = 'ModerationEvent'
): ModerationEvent {
  const record = assertPlainObject(value, label);
  const kind = record.kind;
  if (
    typeof kind !== 'string' ||
    !(MODERATION_EVENT_KINDS as readonly string[]).includes(kind)
  ) {
    throw tsError(
      'TS_INVALID_ENUM',
      `${label}.kind must be one of ${MODERATION_EVENT_KINDS.join(', ')} (got: ${String(kind)})`
    );
  }
  const k = kind as ModerationEventKind;
  const common = commonFields(record, label);

  switch (k) {
    case 'safety.policy.created':
    case 'safety.policy.updated': {
      const policy = validateSafetyPolicy(record.policy, `${label}.policy`);
      return Object.freeze({ ...common, kind: k, policy });
    }
    case 'safety.policy.deprecated': {
      const policyId = assertId(record.policyId, `${label}.policyId`);
      const deprecatedBy = validateSafetyAuthority(
        record.deprecatedBy,
        `${label}.deprecatedBy`
      );
      const deprecatedAt = assertIso8601(record.deprecatedAt, `${label}.deprecatedAt`);
      const reasonCode = assertOneOf(
        record.reasonCode,
        SAFETY_REASON_CODES,
        `${label}.reasonCode`
      );
      const out: {
        -readonly [K in keyof Extract<ModerationEvent, { kind: 'safety.policy.deprecated' }>]:
          Extract<ModerationEvent, { kind: 'safety.policy.deprecated' }>[K];
      } = {
        ...common,
        kind: 'safety.policy.deprecated',
        policyId,
        deprecatedBy,
        deprecatedAt,
        reasonCode
      };
      if (record.replacementPolicyId !== undefined) {
        out.replacementPolicyId = assertId(
          record.replacementPolicyId,
          `${label}.replacementPolicyId`
        );
      }
      return Object.freeze(out);
    }
    case 'safety.policy.decision.recorded': {
      const decision = validateSafetyPolicyDecision(record.decision, `${label}.decision`);
      const out: {
        -readonly [K in keyof Extract<ModerationEvent, { kind: 'safety.policy.decision.recorded' }>]:
          Extract<ModerationEvent, { kind: 'safety.policy.decision.recorded' }>[K];
      } = {
        ...common,
        kind: 'safety.policy.decision.recorded',
        decision
      };
      if (record.sourceQueueItemId !== undefined) {
        out.sourceQueueItemId = assertId(
          record.sourceQueueItemId,
          `${label}.sourceQueueItemId`
        );
      }
      return Object.freeze(out);
    }
    case 'moderation.queue.item.created': {
      const queueItemId = assertId(record.queueItemId, `${label}.queueItemId`);
      const ownerAuthority = validateSafetyAuthority(
        record.ownerAuthority,
        `${label}.ownerAuthority`
      );
      const sourceKind = assertOneOf(
        record.sourceKind,
        QUEUE_SOURCE_KINDS,
        `${label}.sourceKind`
      );
      const sourceId = assertId(record.sourceId, `${label}.sourceId`);
      const reasonCode = assertOneOf(
        record.reasonCode,
        SAFETY_REASON_CODES,
        `${label}.reasonCode`
      );
      const out: {
        -readonly [K in keyof Extract<ModerationEvent, { kind: 'moderation.queue.item.created' }>]:
          Extract<ModerationEvent, { kind: 'moderation.queue.item.created' }>[K];
      } = {
        ...common,
        kind: 'moderation.queue.item.created',
        queueItemId,
        ownerAuthority,
        sourceKind,
        sourceId,
        reasonCode
      };
      if (record.summary !== undefined) {
        out.summary = assertText(record.summary, `${label}.summary`, MAX_SUMMARY_LENGTH);
      }
      return Object.freeze(out);
    }
    case 'moderation.queue.item.assigned': {
      const queueItemId = assertId(record.queueItemId, `${label}.queueItemId`);
      const assignedTo = validateSafetyAuthority(record.assignedTo, `${label}.assignedTo`);
      const assignedAt = assertIso8601(record.assignedAt, `${label}.assignedAt`);
      return Object.freeze({
        ...common,
        kind: 'moderation.queue.item.assigned',
        queueItemId,
        assignedTo,
        assignedAt
      });
    }
    case 'moderation.queue.item.resolved': {
      const queueItemId = assertId(record.queueItemId, `${label}.queueItemId`);
      const resolvedBy = validateSafetyAuthority(record.resolvedBy, `${label}.resolvedBy`);
      const resolvedAt = assertIso8601(record.resolvedAt, `${label}.resolvedAt`);
      const resolution = assertOneOf(record.resolution, QUEUE_RESOLUTIONS, `${label}.resolution`);
      const resolutionReasonCode = assertOneOf(
        record.resolutionReasonCode,
        SAFETY_REASON_CODES,
        `${label}.resolutionReasonCode`
      );
      // Cross-check: `acted` resolution SHOULD cite the decision it
      // produced. Not strictly required so an upstream forwarder can
      // record an `acted` queue close referring to a decision made
      // elsewhere; if the field is present, it must be a valid id.
      const out: {
        -readonly [K in keyof Extract<ModerationEvent, { kind: 'moderation.queue.item.resolved' }>]:
          Extract<ModerationEvent, { kind: 'moderation.queue.item.resolved' }>[K];
      } = {
        ...common,
        kind: 'moderation.queue.item.resolved',
        queueItemId,
        resolvedBy,
        resolvedAt,
        resolution,
        resolutionReasonCode
      };
      if (record.resolutionDecisionId !== undefined) {
        out.resolutionDecisionId = assertId(
          record.resolutionDecisionId,
          `${label}.resolutionDecisionId`
        );
      }
      if (record.resolutionNotes !== undefined) {
        out.resolutionNotes = assertText(
          record.resolutionNotes,
          `${label}.resolutionNotes`,
          MAX_RESOLUTION_NOTES_LENGTH
        );
      }
      return Object.freeze(out);
    }
  }
}
