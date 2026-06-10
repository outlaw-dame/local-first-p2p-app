import * as Caps from '@lfp2p/capabilities';
import type { CredentialRef } from './refs.js';

export type TrustSafetyCapInput = Readonly<{
  capabilityDecision?: Caps.CapabilityDecision;
  credentialEvidence?: readonly CredentialRef[];
  capabilityAction: Caps.CapabilityAction;
  now: string;
}>;

export function evaluateTrustSafetyCap(input: TrustSafetyCapInput): Caps.CapabilityDecision {
  const payload: Caps.CapabilityRelianceInput = {
    action: input.capabilityAction,
    now: input.now
  };
  if (input.capabilityDecision !== undefined) {
    return Caps.evaluateCapabilityReliance({
      ...payload,
      capabilityDecision: input.capabilityDecision,
      ...(input.credentialEvidence === undefined ? {} : { credentialEvidence: input.credentialEvidence })
    });
  }
  return Caps.evaluateCapabilityReliance({
    ...payload,
    ...(input.credentialEvidence === undefined ? {} : { credentialEvidence: input.credentialEvidence })
  });
}
