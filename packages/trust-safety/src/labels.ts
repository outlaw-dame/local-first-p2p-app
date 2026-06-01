import type { ObjectRef } from '@lfp2p/content-addressing';
import { validateObjectRef } from '@lfp2p/content-addressing';
import type { LabelCategory, SafetyAction, Severity } from './actions.js';
import { LABEL_CATEGORIES, MODERATION_ACTIONS, SAFETY_ACTIONS, SEVERITIES } from './actions.js';
import type { SafetyAuthority, EnforcementScope } from './authorities.js';
import { ENFORCEMENT_SCOPES, validateSafetyAuthority } from './authorities.js';
import { tsError } from './errors.js';
import type { SafetySubjectRef } from './subjects.js';
import { PRIVATE_BY_NATURE_SUBJECTS, validateSafetySubjectRef } from './subjects.js';
import {
  assertExactVersion,
  assertFiniteNumberInRange,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray,
  assertText
} from './validation.js';

export const SAFETY_LABEL_DEFINITION_VERSION = 'lfp2p.safety-label-definition.v1' as const;
export const SAFETY_LABEL_VERSION = 'lfp2p.safety-label.v1' as const;

const MAX_NAMESPACE_LENGTH = 256;
const MAX_LABEL_KEY_LENGTH = 128;
const MAX_EVIDENCE_REFS = 32;

const NAMESPACE_PATTERN = /^[a-z][a-z0-9._-]{0,254}$/;
const LABEL_KEY_PATTERN = /^[a-z][a-z0-9._-]{0,126}$/;

function assertNamespace(value: unknown, label: string): string {
  const raw = assertId(value, label, MAX_NAMESPACE_LENGTH);
  if (!NAMESPACE_PATTERN.test(raw)) {
    throw tsError(
      'TS_INVALID_LABEL',
      `${label} must match /^[a-z][a-z0-9._-]{0,254}$/`
    );
  }
  return raw;
}

function assertLabelKey(value: unknown, label: string): string {
  const raw = assertId(value, label, MAX_LABEL_KEY_LENGTH);
  if (!LABEL_KEY_PATTERN.test(raw)) {
    throw tsError(
      'TS_INVALID_LABEL',
      `${label} must match /^[a-z][a-z0-9._-]{0,126}$/`
    );
  }
  return raw;
}

export type SafetyLabelDefinition = Readonly<{
  version: typeof SAFETY_LABEL_DEFINITION_VERSION;
  labelKey: string;
  namespace: string;
  displayName: string;
  description: string;
  category: LabelCategory;
  defaultSeverity: Severity;
  defaultAction: SafetyAction;
  userConfigurable: boolean;
  hardSafety?: boolean;
  adultOnly?: boolean;
  createdBy: SafetyAuthority;
  createdAt: string;
}>;

export function validateSafetyLabelDefinition(
  value: unknown,
  label = 'SafetyLabelDefinition'
): SafetyLabelDefinition {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_LABEL_DEFINITION_VERSION, `${label}.version`);
  const labelKey = assertLabelKey(record.labelKey, `${label}.labelKey`);
  const namespace = assertNamespace(record.namespace, `${label}.namespace`);
  const displayName = assertText(record.displayName, `${label}.displayName`);
  const description = assertText(record.description, `${label}.description`);
  const category = assertOneOf(record.category, LABEL_CATEGORIES, `${label}.category`);
  const defaultSeverity = assertOneOf(
    record.defaultSeverity,
    SEVERITIES,
    `${label}.defaultSeverity`
  );
  const defaultAction = assertOneOf(record.defaultAction, SAFETY_ACTIONS, `${label}.defaultAction`);
  if (typeof record.userConfigurable !== 'boolean') {
    throw tsError('TS_INVALID_LABEL', `${label}.userConfigurable must be a boolean`);
  }
  const userConfigurable = record.userConfigurable;
  const createdBy = validateSafetyAuthority(record.createdBy, `${label}.createdBy`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  let hardSafety: boolean | undefined;
  if (record.hardSafety !== undefined) {
    if (typeof record.hardSafety !== 'boolean') {
      throw tsError('TS_INVALID_LABEL', `${label}.hardSafety must be a boolean`);
    }
    hardSafety = record.hardSafety;
  }

  let adultOnly: boolean | undefined;
  if (record.adultOnly !== undefined) {
    if (typeof record.adultOnly !== 'boolean') {
      throw tsError('TS_INVALID_LABEL', `${label}.adultOnly must be a boolean`);
    }
    adultOnly = record.adultOnly;
  }

  // Hard-safety labels cannot have a permissive default — that would be
  // a silent downgrade of safety-critical defaults.
  if (hardSafety === true && (defaultAction === 'allow' || defaultAction === 'downrank')) {
    throw tsError(
      'TS_HARD_SAFETY_DOWNGRADE',
      `${label}: hardSafety=true must not use a permissive defaultAction (got "${defaultAction}")`
    );
  }

  // Hard-safety labels must NOT be userConfigurable — otherwise a user
  // could silently disable a critical safety default.
  if (hardSafety === true && userConfigurable) {
    throw tsError(
      'TS_HARD_SAFETY_DOWNGRADE',
      `${label}: hardSafety=true must not be userConfigurable`
    );
  }

  const out: { -readonly [K in keyof SafetyLabelDefinition]: SafetyLabelDefinition[K] } = {
    version: SAFETY_LABEL_DEFINITION_VERSION,
    labelKey,
    namespace,
    displayName,
    description,
    category,
    defaultSeverity,
    defaultAction,
    userConfigurable,
    createdBy,
    createdAt
  };
  if (hardSafety !== undefined) out.hardSafety = hardSafety;
  if (adultOnly !== undefined) out.adultOnly = adultOnly;
  return Object.freeze(out);
}

export type SafetyLabel = Readonly<{
  version: typeof SAFETY_LABEL_VERSION;
  labelId: string;
  issuer: SafetyAuthority;
  subject: SafetySubjectRef;
  labelKey: string;
  namespace: string;
  severity?: Severity;
  confidence?: number;
  evidenceRefs?: ReadonlyArray<ObjectRef>;
  negatesLabelId?: string;
  scope: EnforcementScope;
  createdAt: string;
  expiresAt?: string;
}>;

export function validateSafetyLabel(value: unknown, label = 'SafetyLabel'): SafetyLabel {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_LABEL_VERSION, `${label}.version`);
  const labelId = assertId(record.labelId, `${label}.labelId`);
  const issuer = validateSafetyAuthority(record.issuer, `${label}.issuer`);
  const subject = validateSafetySubjectRef(record.subject, `${label}.subject`);
  const labelKey = assertLabelKey(record.labelKey, `${label}.labelKey`);
  const namespace = assertNamespace(record.namespace, `${label}.namespace`);
  const scope = assertOneOf(record.scope, ENFORCEMENT_SCOPES, `${label}.scope`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  let severity: Severity | undefined;
  if (record.severity !== undefined) {
    severity = assertOneOf(record.severity, SEVERITIES, `${label}.severity`);
  }

  let confidence: number | undefined;
  if (record.confidence !== undefined) {
    confidence = assertFiniteNumberInRange(record.confidence, `${label}.confidence`, 0, 1);
  }

  let evidenceRefs: ReadonlyArray<ObjectRef> | undefined;
  if (record.evidenceRefs !== undefined) {
    evidenceRefs = assertReadonlyArray(
      record.evidenceRefs,
      `${label}.evidenceRefs`,
      MAX_EVIDENCE_REFS,
      (item) => validateObjectRef(item)
    );
  }

  let negatesLabelId: string | undefined;
  if (record.negatesLabelId !== undefined) {
    negatesLabelId = assertId(record.negatesLabelId, `${label}.negatesLabelId`);
  }

  let expiresAt: string | undefined;
  if (record.expiresAt !== undefined) {
    expiresAt = assertIso8601(record.expiresAt, `${label}.expiresAt`);
    assertNotBefore(createdAt, expiresAt, `${label}.createdAt`, `${label}.expiresAt`);
  }

  // Private-subject + public-scope cross-check. A label about a private
  // blob/media/thread must not be issued at index-local or
  // network-advisory scope, because that would leak the existence of
  // the private object into public flows.
  if (
    PRIVATE_BY_NATURE_SUBJECTS.has(subject.type) &&
    (scope === 'index-local' || scope === 'network-advisory')
  ) {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: subject type "${subject.type}" is private by nature; scope "${scope}" would leak it into public flows`
    );
  }

  // Moderation-action defaults on labels are advisory; labels themselves
  // do not enforce. We do not cross-validate action here because labels
  // do not carry an action — only label *definitions* do.

  const out: { -readonly [K in keyof SafetyLabel]: SafetyLabel[K] } = {
    version: SAFETY_LABEL_VERSION,
    labelId,
    issuer,
    subject,
    labelKey,
    namespace,
    scope,
    createdAt
  };
  if (severity !== undefined) out.severity = severity;
  if (confidence !== undefined) out.confidence = confidence;
  if (evidenceRefs !== undefined) out.evidenceRefs = evidenceRefs;
  if (negatesLabelId !== undefined) out.negatesLabelId = negatesLabelId;
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  return Object.freeze(out);
}

// `MODERATION_ACTIONS` is re-exported from actions for downstream callers.
export { MODERATION_ACTIONS };
