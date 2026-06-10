import * as Caps from '@lfp2p/capabilities';
import type { CredentialRef } from './refs.js';

export type TrustSafetyCapInput = Readonly<{
  capabilityDecision?: Caps.CapabilityDecision;
  credentialEvidence?: readonly CredentialRef[];
  capabilityAction: Caps.CapabilityAction;
  now: string;
}>;

export function evaluateTrustSafetyCap(input: TrustSafetyCapInput): Caps.CapabilityDecision {
  return Caps.evaluateCapabilityReliance({
    capabilityDecision: input.capabilityDecision,
    credentialEvidence: input.credentialEvidence,
    action: input.capabilityAction,
    now: input.now
  });
}
