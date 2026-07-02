import type { SafetyAction } from './actions.js';
import { SAFETY_ACTIONS } from './actions.js';
import type { EnforcementScope, SafetyAuthority } from './authorities.js';
import { ENFORCEMENT_SCOPES, validateSafetyAuthority } from './authorities.js';
import { tsError } from './errors.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertOneOf,
  assertPlainObject,
  assertReadonlyArray,
  assertText
} from './validation.js';

export const SAFETY_POLICY_VERSION = 'lfp2p.safety-policy.v1' as const;

/**
 * `SafetyPolicy` is the durable, human-readable rule book a community
 * (or other authority) commits to before issuing
 * `SafetyPolicyDecision`s. A decision's `policyVersion` field points
 * to a specific version of a `SafetyPolicy` so the audit chain is
 * complete: every decision can be traced back to the exact policy
 * text under which it was made, even after the policy is updated or
 * deprecated.
 *
 * The policy itself never enforces — enforcement happens via
 * `SafetyPolicyDecision` (Phase 1.61) issued by the authority who
 * owns the policy. A deprecated policy does NOT retroactively reverse
 * decisions made under it; this is intentional audit hygiene.
 */
export type SafetyPolicy = Readonly<{
  version: typeof SAFETY_POLICY_VERSION;
  policyId: string;
  /**
   * Monotonically increasing integer per policyId. Created policies
   * start at 1; updates produce 2, 3, ...; deprecation does not bump
   * the version (the policy is simply marked deprecated).
   */
  policyVersionNumber: number;
  title: string;
  body: string;
  scope: EnforcementScope;
  applicableActions: ReadonlyArray<SafetyAction>;
  createdBy: SafetyAuthority;
  createdAt: string;
  supersedesPolicyVersionNumber?: number;
}>;

const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 64 * 1024;
const MAX_APPLICABLE_ACTIONS = SAFETY_ACTIONS.length;

export function validateSafetyPolicy(value: unknown, label = 'SafetyPolicy'): SafetyPolicy {
  const record = assertPlainObject(value, label);
  assertExactVersion(record.version, SAFETY_POLICY_VERSION, `${label}.version`);
  const policyId = assertId(record.policyId, `${label}.policyId`);
  const policyVersionNumber = record.policyVersionNumber;
  if (
    typeof policyVersionNumber !== 'number' ||
    !Number.isSafeInteger(policyVersionNumber) ||
    policyVersionNumber < 1
  ) {
    throw tsError('TS_INVALID_NUMBER', `${label}.policyVersionNumber must be a safe integer >= 1`);
  }
  const title = assertId(record.title, `${label}.title`, MAX_TITLE_LENGTH);
  const body = assertText(record.body, `${label}.body`, MAX_BODY_LENGTH);
  const scope = assertOneOf(record.scope, ENFORCEMENT_SCOPES, `${label}.scope`);
  const applicableActions = assertReadonlyArray(
    record.applicableActions,
    `${label}.applicableActions`,
    MAX_APPLICABLE_ACTIONS,
    (item, i) => assertOneOf(item, SAFETY_ACTIONS, `${label}.applicableActions[${i}]`)
  );
  if (applicableActions.length === 0) {
    throw tsError(
      'TS_INVALID_INPUT',
      `${label}.applicableActions must contain at least one action`
    );
  }
  const createdBy = validateSafetyAuthority(record.createdBy, `${label}.createdBy`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);

  const out: { -readonly [K in keyof SafetyPolicy]: SafetyPolicy[K] } = {
    version: SAFETY_POLICY_VERSION,
    policyId,
    policyVersionNumber,
    title,
    body,
    scope,
    applicableActions,
    createdBy,
    createdAt
  };

  if (record.supersedesPolicyVersionNumber !== undefined) {
    const sup = record.supersedesPolicyVersionNumber;
    if (typeof sup !== 'number' || !Number.isSafeInteger(sup) || sup < 1) {
      throw tsError(
        'TS_INVALID_NUMBER',
        `${label}.supersedesPolicyVersionNumber must be a safe integer >= 1`
      );
    }
    if (sup >= policyVersionNumber) {
      throw tsError(
        'TS_INVALID_INPUT',
        `${label}.supersedesPolicyVersionNumber (${sup}) must be < policyVersionNumber (${policyVersionNumber})`
      );
    }
    out.supersedesPolicyVersionNumber = sup;
  }

  return Object.freeze(out);
}
