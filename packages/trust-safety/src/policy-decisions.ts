import type { ObjectRef } from '@lfp2p/content-addressing';
import { validateObjectRef } from '@lfp2p/content-addressing';
import type { SafetyAction } from './actions.js';
import { SAFETY_ACTIONS, assertActionScopeCompatible } from './actions.js';
import type { EnforcementScope, SafetyAuthority } from './authorities.js';
import { ENFORCEMENT_SCOPES, validateSafetyAuthority } from './authorities.js';
import { tsError } from './errors.js';
import type { CapabilityProofRef } from './refs.js';
import { validateCapabilityProofRef } from './refs.js';
import type { SafetyReasonCode } from './reason-codes.js';
import { SAFETY_REASON_CODES } from './reason-codes.js';
import type { SafetySubjectRef } from './subjects.js';
import { PRIVATE_BY_NATURE_SUBJECTS, validateSafetySubjectRef } from './subjects.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray
} from './validation.js';

export const SAFETY_POLICY_DECISION_VERSION = 'lfp2p.safety-policy-decision.v1' as const;

const MAX_LABEL_OR_REPORT_REFS = 64;
const MAX_EVIDENCE_REFS = 32;
const MAX_PROOFS = 32;
const MAX_POLICY_VERSION_LENGTH = 128;

export type SafetyPolicyDecision = Readonly<{
  version: typeof SAFETY_POLICY_DECISION_VERSION;
  decisionId: string;
  authority: SafetyAuthority;
  subject: SafetySubjectRef;
  action: SafetyAction;
  scope: EnforcementScope;
  policyVersion: string;
  reasonCode: SafetyReasonCode;
  sourceLabels?: ReadonlyArray<string>;
  sourceReports?: ReadonlyArray<string>;
  capabilityProofs?: ReadonlyArray<CapabilityProofRef>;
  evidenceRefs?: ReadonlyArray<ObjectRef>;
  createdAt: string;
  expiresAt?: string;
  appealable: boolean;
  supersedesDecisionId?: string;
}>;

export function validateSafetyPolicyDecision(
  value: unknown,
  label = 'SafetyPolicyDecision'
): SafetyPolicyDecision {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_POLICY_DECISION_VERSION, `${label}.version`);
  const decisionId = assertId(record.decisionId, `${label}.decisionId`);
  const authority = validateSafetyAuthority(record.authority, `${label}.authority`);
  const subject = validateSafetySubjectRef(record.subject, `${label}.subject`);
  const action = assertOneOf(record.action, SAFETY_ACTIONS, `${label}.action`);
  const scope = assertOneOf(record.scope, ENFORCEMENT_SCOPES, `${label}.scope`);
  const policyVersion = assertId(
    record.policyVersion,
    `${label}.policyVersion`,
    MAX_POLICY_VERSION_LENGTH
  );
  const reasonCode = assertOneOf(record.reasonCode, SAFETY_REASON_CODES, `${label}.reasonCode`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  if (typeof record.appealable !== 'boolean') {
    throw tsError('TS_INVALID_DECISION', `${label}.appealable must be a boolean`);
  }
  const appealable = record.appealable;

  // Cross-validate action against scope:
  // - reject-transport requires a transport scope.
  // - Curation actions cannot be issued at transport or network-advisory scope
  //   (those are handled by curation rules, not policy decisions).
  assertActionScopeCompatible(action, scope, label);

  // Private-subject leakage cross-check: a decision about a private
  // blob/media/thread cannot be issued at index-local or network-advisory
  // scope (that would advertise the private object in public flows).
  if (
    PRIVATE_BY_NATURE_SUBJECTS.has(subject.type) &&
    (scope === 'index-local' || scope === 'network-advisory')
  ) {
    throw tsError(
      'TS_PRIVATE_LEAK',
      `${label}: subject type "${subject.type}" is private; scope "${scope}" would leak it into public flows`
    );
  }

  const out: { -readonly [K in keyof SafetyPolicyDecision]: SafetyPolicyDecision[K] } = {
    version: SAFETY_POLICY_DECISION_VERSION,
    decisionId,
    authority,
    subject,
    action,
    scope,
    policyVersion,
    reasonCode,
    createdAt,
    appealable
  };
  if (record.sourceLabels !== undefined) {
    out.sourceLabels = assertReadonlyArray(
      record.sourceLabels,
      `${label}.sourceLabels`,
      MAX_LABEL_OR_REPORT_REFS,
      (item, i) => assertId(item, `${label}.sourceLabels[${i}]`)
    );
  }
  if (record.sourceReports !== undefined) {
    out.sourceReports = assertReadonlyArray(
      record.sourceReports,
      `${label}.sourceReports`,
      MAX_LABEL_OR_REPORT_REFS,
      (item, i) => assertId(item, `${label}.sourceReports[${i}]`)
    );
  }
  if (record.capabilityProofs !== undefined) {
    out.capabilityProofs = assertReadonlyArray(
      record.capabilityProofs,
      `${label}.capabilityProofs`,
      MAX_PROOFS,
      (item, i) => validateCapabilityProofRef(item, `${label}.capabilityProofs[${i}]`)
    );
  }
  if (record.evidenceRefs !== undefined) {
    out.evidenceRefs = assertReadonlyArray(
      record.evidenceRefs,
      `${label}.evidenceRefs`,
      MAX_EVIDENCE_REFS,
      (item) => validateObjectRef(item)
    );
  }
  if (record.expiresAt !== undefined) {
    out.expiresAt = assertIso8601(record.expiresAt, `${label}.expiresAt`);
    assertNotBefore(createdAt, out.expiresAt, `${label}.createdAt`, `${label}.expiresAt`);
  }
  if (record.supersedesDecisionId !== undefined) {
    out.supersedesDecisionId = assertId(
      record.supersedesDecisionId,
      `${label}.supersedesDecisionId`
    );
  }
  return Object.freeze(out);
}
