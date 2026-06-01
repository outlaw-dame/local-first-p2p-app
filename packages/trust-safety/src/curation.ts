import type { SafetyAuthority } from './authorities.js';
import { validateSafetyAuthority } from './authorities.js';
import { tsError } from './errors.js';
import type { SafetySubjectRef } from './subjects.js';
import { validateSafetySubjectRef } from './subjects.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray
} from './validation.js';

export const CURATION_RULE_VERSION = 'lfp2p.curation-rule.v1' as const;
export const CURATION_EXPLANATION_VERSION = 'lfp2p.curation-explanation.v1' as const;

export const CURATION_SURFACES = [
  'local-feed',
  'community-feed',
  'public-feed',
  'search',
  'recommendation',
  'notification'
] as const;
export type CurationSurface = (typeof CURATION_SURFACES)[number];

export const CURATION_ACTION_KINDS = [
  'boost',
  'downrank',
  'exclude',
  'group',
  'annotate',
  'require-warning'
] as const;
export type CurationActionKind = (typeof CURATION_ACTION_KINDS)[number];

/**
 * Curation actions that masquerade as moderation. None of these are
 * permitted on a CurationRule — moderation must go through a
 * `SafetyPolicyDecision`. This guard exists so a curation surface cannot
 * silently hide/remove content under a "curation" label.
 */
const MODERATION_ACTION_NAMES: ReadonlySet<string> = new Set([
  'hide',
  'remove',
  'remove-local',
  'reject-transport',
  'quarantine',
  'warn',
  'blur-media',
  'collapse',
  'rate-limit',
  'escalate-review'
]);

/**
 * Subject matcher for curation rules. Each variant matches a class of
 * subjects without naming them individually.
 */
export type CurationSubjectMatcher =
  | Readonly<{ kind: 'subject'; subject: SafetySubjectRef }>
  | Readonly<{ kind: 'topic'; value: string }>
  | Readonly<{ kind: 'domain'; domain: string }>
  | Readonly<{ kind: 'label'; labelKey: string; namespace: string }>
  | Readonly<{ kind: 'community'; communityId: string }>
  | Readonly<{ kind: 'actor'; actorId: string }>;

const MAX_TOPIC_LENGTH = 256;
const MAX_DOMAIN_LENGTH = 253;

function validateCurationSubjectMatcher(value: unknown, label: string): CurationSubjectMatcher {
  const record = assertPlainObject(value, label);
  const kind = assertOneOf(
    record.kind,
    ['subject', 'topic', 'domain', 'label', 'community', 'actor'] as const,
    `${label}.kind`
  );
  switch (kind) {
    case 'subject':
      return Object.freeze({
        kind: 'subject',
        subject: validateSafetySubjectRef(record.subject, `${label}.subject`)
      });
    case 'topic': {
      const v = assertId(record.value, `${label}.value`, MAX_TOPIC_LENGTH);
      return Object.freeze({ kind: 'topic', value: v });
    }
    case 'domain': {
      const d = assertId(record.domain, `${label}.domain`, MAX_DOMAIN_LENGTH);
      if (d.includes('://') || d.includes('/')) {
        throw tsError('TS_INVALID_CURATION', `${label}.domain must be a bare domain`);
      }
      return Object.freeze({ kind: 'domain', domain: d.toLowerCase() });
    }
    case 'label':
      return Object.freeze({
        kind: 'label',
        labelKey: assertId(record.labelKey, `${label}.labelKey`),
        namespace: assertId(record.namespace, `${label}.namespace`)
      });
    case 'community':
      return Object.freeze({
        kind: 'community',
        communityId: assertId(record.communityId, `${label}.communityId`)
      });
    case 'actor':
      return Object.freeze({
        kind: 'actor',
        actorId: assertId(record.actorId, `${label}.actorId`)
      });
  }
}

export type CurationRule = Readonly<{
  version: typeof CURATION_RULE_VERSION;
  ruleId: string;
  owner: SafetyAuthority;
  surface: CurationSurface;
  subjectMatcher: CurationSubjectMatcher;
  action: CurationActionKind;
  reasonCode: string;
  createdAt: string;
  disabledAt?: string;
}>;

export function validateCurationRule(value: unknown, label = 'CurationRule'): CurationRule {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, CURATION_RULE_VERSION, `${label}.version`);
  const ruleId = assertId(record.ruleId, `${label}.ruleId`);
  const owner = validateSafetyAuthority(record.owner, `${label}.owner`);
  const surface = assertOneOf(record.surface, CURATION_SURFACES, `${label}.surface`);
  const subjectMatcher = validateCurationSubjectMatcher(
    record.subjectMatcher,
    `${label}.subjectMatcher`
  );
  // Cross-check that a caller has not passed a moderation action via the curation
  // path. If the action string lands in MODERATION_ACTION_NAMES, reject —
  // moderation must use SafetyPolicyDecision, not CurationRule.
  const rawAction = record.action;
  if (typeof rawAction === 'string' && MODERATION_ACTION_NAMES.has(rawAction)) {
    throw tsError(
      'TS_CURATION_MASQUERADE',
      `${label}: action "${rawAction}" is a moderation action and cannot be issued on a CurationRule`
    );
  }
  const action = assertOneOf(rawAction, CURATION_ACTION_KINDS, `${label}.action`);
  const reasonCode = assertId(record.reasonCode, `${label}.reasonCode`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  const out: { -readonly [K in keyof CurationRule]: CurationRule[K] } = {
    version: CURATION_RULE_VERSION,
    ruleId,
    owner,
    surface,
    subjectMatcher,
    action,
    reasonCode,
    createdAt
  };
  if (record.disabledAt !== undefined) {
    out.disabledAt = assertIso8601(record.disabledAt, `${label}.disabledAt`);
    assertNotBefore(createdAt, out.disabledAt, `${label}.createdAt`, `${label}.disabledAt`);
  }
  return Object.freeze(out);
}

const MAX_REASON_CODES_PER_EXPLANATION = 32;

export type CurationExplanation = Readonly<{
  version: typeof CURATION_EXPLANATION_VERSION;
  explanationId: string;
  surface: string;
  subject: SafetySubjectRef;
  action: CurationActionKind;
  reasonCodes: ReadonlyArray<string>;
  policyVersion: string;
  createdAt: string;
}>;

export function validateCurationExplanation(
  value: unknown,
  label = 'CurationExplanation'
): CurationExplanation {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, CURATION_EXPLANATION_VERSION, `${label}.version`);
  const explanationId = assertId(record.explanationId, `${label}.explanationId`);
  const surface = assertId(record.surface, `${label}.surface`);
  const subject = validateSafetySubjectRef(record.subject, `${label}.subject`);
  const rawAction = record.action;
  if (typeof rawAction === 'string' && MODERATION_ACTION_NAMES.has(rawAction)) {
    throw tsError(
      'TS_CURATION_MASQUERADE',
      `${label}: action "${rawAction}" is a moderation action and cannot appear in a CurationExplanation`
    );
  }
  const action = assertOneOf(rawAction, CURATION_ACTION_KINDS, `${label}.action`);
  const reasonCodes = assertReadonlyArray(
    record.reasonCodes,
    `${label}.reasonCodes`,
    MAX_REASON_CODES_PER_EXPLANATION,
    (item, i) => assertId(item, `${label}.reasonCodes[${i}]`)
  );
  const policyVersion = assertId(record.policyVersion, `${label}.policyVersion`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  return Object.freeze({
    version: CURATION_EXPLANATION_VERSION,
    explanationId,
    surface,
    subject,
    action,
    reasonCodes,
    policyVersion,
    createdAt
  });
}
