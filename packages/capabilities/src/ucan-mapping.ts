import type {
  CapabilityAction,
  CapabilityCaveat,
  CapabilityGrantV1,
  CapabilityPartyRef,
  CapabilityProofRef,
  CapabilityResourceRef,
  CapabilityScopeRef
} from './types.js';
import { validateCapabilityGrant } from './validation.js';

export type UcanLikeCapability = Readonly<{
  with: string;
  can: CapabilityAction;
  nb?: Record<string, unknown>;
}>;

export type UcanLikeProofRef = Readonly<{
  proofId: string;
}>;

export type UcanLikeGrantInput = Readonly<{
  capabilityId: string;
  issuer: CapabilityPartyRef;
  audience: CapabilityPartyRef;
  resource: CapabilityResourceRef;
  scope: CapabilityScopeRef;
  capability: UcanLikeCapability;
  caveats?: readonly CapabilityCaveat[];
  proofs?: readonly UcanLikeProofRef[];
  notBefore?: string;
  expiresAt: string;
  createdAt: string;
  nonce: string;
  delegationDepth?: number;
}>;

export function mapUcanLikeGrantToCapabilityGrant(input: UcanLikeGrantInput): CapabilityGrantV1 {
  const proofRefs: readonly CapabilityProofRef[] = Object.freeze(
    (input.proofs ?? []).map((proof) =>
      Object.freeze({ proofId: proof.proofId, scheme: 'ucan' as const })
    )
  );

  return validateCapabilityGrant({
    version: 'lfp2p.capability.grant.v1',
    capabilityId: input.capabilityId,
    issuer: input.issuer,
    audience: input.audience,
    resource: input.resource,
    actions: [input.capability.can],
    scope: input.scope,
    caveats: input.caveats ?? [],
    ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
    expiresAt: input.expiresAt,
    delegationDepth: input.delegationDepth ?? 0,
    nonce: input.nonce,
    proofRefs,
    createdAt: input.createdAt
  });
}
