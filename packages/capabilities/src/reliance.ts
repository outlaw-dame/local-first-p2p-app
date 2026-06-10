import type {
  CapabilityAction,
  CapabilityDecision,
  CapabilityProofRef,
  CapabilityReasonCode
} from './types.js';

export type CredentialEvidenceRef = Readonly<{
  credentialId: string;
  issuerId: string;
  claimType: string;
}>;

export type CapabilityRelianceInput = Readonly<{
  capabilityDecision?: CapabilityDecision | undefined;
  capabilityProofs?: readonly CapabilityProofRef[] | undefined;
  credentialEvidence?: readonly CredentialEvidenceRef[] | undefined;
  action: CapabilityAction;
  now: string;
}>;

const BEARCAP_FORBIDDEN_ACTION_PREFIXES = [
  'identity.',
  'community.role.',
  'label.',
  'relay.',
  'super-peer.'
] as const;

export function evaluateCapabilityReliance(input: CapabilityRelianceInput): CapabilityDecision {
  const createdAt = normalizeDecisionTime(input.now);
  const credentialOnly = input.capabilityDecision === undefined && (input.credentialEvidence?.length ?? 0) > 0;
  if (credentialOnly) {
    return deny('unknown', undefined, ['capability.vc-only-authority-denied'], createdAt);
  }

  if (input.capabilityDecision === undefined) {
    return deny('unknown', undefined, ['capability.unverified-proof'], createdAt);
  }

  if (input.capabilityProofs?.some((proof) => proof.scheme === 'bearcap') === true && isBearcapForbiddenAction(input.action)) {
    return deny(
      input.capabilityDecision.capabilityId,
      input.capabilityDecision.invocationId,
      ['capability.bearcap-forbidden-for-action'],
      createdAt
    );
  }

  return input.capabilityDecision;
}

export function isBearcapForbiddenAction(action: CapabilityAction): boolean {
  return BEARCAP_FORBIDDEN_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));
}

function normalizeDecisionTime(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function deny(
  capabilityId: string,
  invocationId: string | undefined,
  reasonCodes: readonly CapabilityReasonCode[],
  createdAt: string
): CapabilityDecision {
  return Object.freeze({
    status: 'deny' as const,
    reasonCodes: Object.freeze([...reasonCodes]),
    capabilityId,
    ...(invocationId === undefined ? {} : { invocationId }),
    createdAt
  });
}
