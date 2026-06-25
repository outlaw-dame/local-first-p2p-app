import * as Caps from '@lfp2p/capabilities';
import type { CredentialRef } from './refs.js';

/**
 * Re-export of `@lfp2p/capabilities`'s strict-scheme proof ref shape.
 *
 * NOTE — there are two `CapabilityProofRef` types in this codebase:
 *
 *   - trust-safety's own (`./refs.ts`) — `scheme: string` (loose),
 *     used in storage / event payloads where a forwarded ref might
 *     mention a scheme the local node has not yet upgraded to
 *     recognize. Forward-compatible by design.
 *   - capabilities' (`@lfp2p/capabilities`) — `scheme:
 *     CapabilityProofScheme` (strict enum). The reliance gate and
 *     `summarizeProofStates` enforce this at the call boundary.
 *
 * This adapter takes the STRICT shape because that is what the
 * reliance gate consumes. Callers holding a loose ref must validate
 * it through `Caps.CAPABILITY_PROOF_SCHEMES` before passing it in.
 */
type StrictCapabilityProofRef = Caps.CapabilityProofRef;

/**
 * Trust-safety adapter input.
 *
 * Two new optional pathways carry capability-proof state into the
 * underlying `evaluateCapabilityReliance` gate:
 *
 *   - `proofsState` — a pre-computed aggregate verdict. Pass this
 *     when you have already folded the registry (e.g., the caller
 *     ran `summarizeProofStates` and cached the result).
 *   - `proofRegistry` + `capabilityProofs` — the adapter folds
 *     them via `Caps.summarizeProofStates(...)` and forwards the
 *     result. Use this when the relying call site has both pieces
 *     handy and wants the adapter to do the fold.
 *
 * If neither pathway is supplied, the adapter omits `proofsState`
 * entirely and the reliance gate preserves its pre-registry
 * behaviour exactly — the proof-provenance gate stays opt-in.
 *
 * If BOTH `proofsState` and (`proofRegistry`, `capabilityProofs`)
 * are supplied, the pre-computed `proofsState` wins. A caller who
 * has already done the fold elsewhere (and may have stored the
 * verdict in an audit row) gets to assert the verdict explicitly.
 */
export type TrustSafetyCapInput = Readonly<{
  capabilityDecision?: Caps.CapabilityDecision;
  credentialEvidence?: readonly CredentialRef[];
  capabilityAction: Caps.CapabilityAction;
  now: string;
  /**
   * Capability-proof refs attached to the decision. Used in
   * combination with `proofRegistry` so the adapter can fold them
   * into an aggregate verdict via
   * `Caps.summarizeProofStates(...)`.
   *
   * If both `proofRegistry` and `capabilityProofs` are present,
   * the adapter forwards the fold result as `proofsState`. Either
   * alone is ignored (no proofsState computed).
   */
  capabilityProofs?: readonly StrictCapabilityProofRef[];
  /**
   * Pure data structure produced by
   * `Caps.createProofRegistry()` / `Caps.registerProof()` /
   * `Caps.verifyProof()`. The adapter does not mutate it.
   */
  proofRegistry?: Caps.ProofRegistry;
  /**
   * Pre-computed aggregate verdict. When present, takes
   * precedence over `(proofRegistry, capabilityProofs)`.
   */
  proofsState?: Caps.CapabilityProofVerificationState;
}>;

export function evaluateTrustSafetyCap(input: TrustSafetyCapInput): Caps.CapabilityDecision {
  return Caps.evaluateCapabilityReliance({
    action: input.capabilityAction,
    now: input.now,
    capabilityDecision: input.capabilityDecision,
    credentialEvidence: input.credentialEvidence,
    capabilityProofs: input.capabilityProofs,
    proofsState: resolveProofsState(input)
  });
}

function resolveProofsState(
  input: TrustSafetyCapInput
): Caps.CapabilityProofVerificationState | undefined {
  if (input.proofsState !== undefined) return input.proofsState;
  if (input.proofRegistry !== undefined && input.capabilityProofs !== undefined) {
    return Caps.summarizeProofStates(input.proofRegistry, input.capabilityProofs);
  }
  return undefined;
}
