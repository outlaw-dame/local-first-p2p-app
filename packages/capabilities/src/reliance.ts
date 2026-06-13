import type {
  CapabilityAction,
  CapabilityDecision,
  CapabilityProofRef,
  CapabilityReasonCode
} from './types.js';
import type { CapabilityProofVerificationState } from './proof-registry.js';

export type CredentialEvidenceRef = Readonly<{
  credentialId: string;
  issuerId: string;
  claimType: string;
}>;

export type CapabilityRelianceInput = Readonly<{
  capabilityDecision?: CapabilityDecision | undefined;
  capabilityProofs?: readonly CapabilityProofRef[] | undefined;
  credentialEvidence?: readonly CredentialEvidenceRef[] | undefined;
  /**
   * Phase: Proof Registry — the registry's aggregate verdict over the
   * capability's `proofRefs` (see `summarizeProofStates`). When
   * supplied and NOT `verified`, it gates the decision: a revoked /
   * expired / unverifiable proof can no longer be relied upon even if
   * the underlying capability decision was `allow`. Omitting this
   * field preserves the pre-registry behaviour exactly — the proof
   * provenance gate is opt-in.
   */
  proofsState?: CapabilityProofVerificationState | undefined;
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

  // Proof-registry gate. A supplied, non-verified aggregate proof
  // state overrides an otherwise-allowing decision — fail closed.
  if (input.proofsState !== undefined && input.proofsState !== 'verified') {
    return deny(
      input.capabilityDecision.capabilityId,
      input.capabilityDecision.invocationId,
      [proofStateReasonCode(input.proofsState)],
      createdAt
    );
  }

  return input.capabilityDecision;
}

/**
 * Map a non-verified aggregate proof state to the stable reliance
 * reason code. `invalid` and `unverified` both surface as
 * `capability.unverified-proof` (the relying party could not
 * establish the proof); revocation and expiry have their own codes.
 */
function proofStateReasonCode(state: CapabilityProofVerificationState): CapabilityReasonCode {
  switch (state) {
    case 'revoked':
      return 'capability.revoked';
    case 'expired':
      return 'capability.expired';
    case 'invalid':
    case 'unverified':
    case 'verified':
      return 'capability.unverified-proof';
    default:
      // Defense-in-depth against runtime type erasure (an untrusted
      // caller could supply a non-enum value cast through `as`). Map
      // anything unexpected to the safest deny code so the reliance
      // gate never returns undefined.
      return 'capability.unverified-proof';
  }
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
