import {
  validateCapabilityGrant,
  validateCapabilityInvocation,
  validateCapabilityRevocation
} from './validation.js';
import type {
  CapabilityDecision,
  CapabilityGrantV1,
  CapabilityInvocationV1,
  CapabilityReasonCode,
  CapabilityRevocationV1
} from './types.js';

export type CapabilityAuthorityContext =
  | 'mutation'
  | 'display'
  | 'bridge'
  | 'relay'
  | 'search'
  | 'moderation'
  | 'sync';

export type EvaluateCapabilityInvocationInput = Readonly<{
  grant: CapabilityGrantV1 | unknown;
  invocation: CapabilityInvocationV1 | unknown;
  revocations?: readonly (CapabilityRevocationV1 | unknown)[];
  now: string;
  replayedInvocationIds?: ReadonlySet<string>;
  verifiedProofIds?: ReadonlySet<string>;
  trustedIssuerIds?: ReadonlySet<string>;
  authorityContext: CapabilityAuthorityContext;
}>;

export function evaluateCapabilityInvocation(input: EvaluateCapabilityInvocationInput): CapabilityDecision {
  const now = parseDecisionTime(input.now);
  let grant: CapabilityGrantV1;
  let invocation: CapabilityInvocationV1;
  let revocations: readonly CapabilityRevocationV1[];

  try {
    grant = validateCapabilityGrant(input.grant);
    invocation = validateCapabilityInvocation(input.invocation);
    revocations = Object.freeze((input.revocations ?? []).map((revocation) => validateCapabilityRevocation(revocation)));
  } catch {
    return deny('unknown', undefined, ['capability.malformed']);
  }

  const reasons: CapabilityReasonCode[] = [];

  if (grant.capabilityId !== invocation.capabilityId) reasons.push('capability.wrong-resource');
  if (Date.parse(grant.expiresAt) <= now) reasons.push('capability.expired');
  if (grant.notBefore !== undefined && Date.parse(grant.notBefore) > now) reasons.push('capability.not-yet-valid');
  if (invocation.expiresAt !== undefined && Date.parse(invocation.expiresAt) <= now) reasons.push('capability.expired');
  if (revocations.some((revocation) => revocation.capabilityId === grant.capabilityId)) reasons.push('capability.revoked');
  if (!sameParty(grant.audience, invocation.invoker)) reasons.push('capability.wrong-audience');
  if (!sameResource(grant.resource, invocation.resource)) reasons.push('capability.wrong-resource');
  if (!grant.actions.includes(invocation.action)) reasons.push('capability.wrong-action');
  if (!sameScope(grant.scope, invocation.scope)) reasons.push('capability.wrong-scope');
  if (input.replayedInvocationIds?.has(invocation.invocationId) === true) reasons.push('capability.replayed-invocation');
  if (input.trustedIssuerIds !== undefined && !input.trustedIssuerIds.has(grant.issuer.id)) reasons.push('capability.untrusted-issuer');

  if (grant.proofRefs.length > 0 && input.verifiedProofIds !== undefined) {
    for (const proof of grant.proofRefs) {
      if (!input.verifiedProofIds.has(proof.proofId)) {
        reasons.push('capability.unverified-proof');
        break;
      }
    }
  }

  for (const caveat of grant.caveats) {
    if (!evaluateCaveat(caveat, grant, invocation, now, input.authorityContext)) {
      reasons.push('capability.unsatisfied-caveat');
      break;
    }
  }

  if (reasons.length > 0) return deny(grant.capabilityId, invocation.invocationId, dedupeReasons(reasons));

  return Object.freeze({
    status: 'allow' as const,
    reasonCodes: ['capability.valid'] as const,
    capabilityId: grant.capabilityId,
    invocationId: invocation.invocationId,
    createdAt: new Date(now).toISOString(),
    expiresAt: grant.expiresAt
  });
}

function evaluateCaveat(
  caveat: CapabilityGrantV1['caveats'][number],
  grant: CapabilityGrantV1,
  invocation: CapabilityInvocationV1,
  now: number,
  authorityContext: CapabilityAuthorityContext
): boolean {
  switch (caveat.kind) {
    case 'expires-before':
      return typeof caveat.value === 'string' && Number.isFinite(Date.parse(caveat.value)) && now < Date.parse(caveat.value);
    case 'not-before':
      return typeof caveat.value === 'string' && Number.isFinite(Date.parse(caveat.value)) && now >= Date.parse(caveat.value);
    case 'audience-is':
      return typeof caveat.value === 'string' && invocation.invoker.id === caveat.value;
    case 'device-is':
      return typeof caveat.value === 'string' && invocation.device?.id === caveat.value;
    case 'resource-is':
      return typeof caveat.value === 'string' && invocation.resource.id === caveat.value;
    case 'action-is':
      return typeof caveat.value === 'string' && invocation.action === caveat.value;
    case 'scope-is':
      return typeof caveat.value === 'string' && invocation.scope.id === caveat.value;
    case 'issuer-is':
      return typeof caveat.value === 'string' && grant.issuer.id === caveat.value;
    case 'requires-freshness-check':
      return caveat.value === false;
    case 'requires-human-review':
      return authorityContext === 'display';
    case 'requires-private-envelope':
      return invocation.scope.kind === 'private-envelope';
    case 'requires-encrypted-evidence':
      return invocation.argumentsDigest !== undefined;
    case 'max-uses':
      return typeof caveat.value === 'number' && Number.isSafeInteger(caveat.value) && caveat.value > 0;
    case 'max-delegation-depth':
      return typeof caveat.value === 'number' && Number.isSafeInteger(caveat.value) && grant.delegationDepth <= caveat.value;
    case 'network-surface-is':
      return typeof caveat.value === 'string' && authorityContext === caveat.value;
    case 'bridge-is':
      return typeof caveat.value === 'string' && invocation.resource.kind === 'bridge' && invocation.resource.id === caveat.value;
    case 'label-namespace-is':
      return typeof caveat.value === 'string' && invocation.resource.kind === 'label-namespace' && invocation.resource.id === caveat.value;
  }
}

function sameParty(left: CapabilityGrantV1['audience'], right: CapabilityInvocationV1['invoker']): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sameResource(left: CapabilityGrantV1['resource'], right: CapabilityInvocationV1['resource']): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sameScope(left: CapabilityGrantV1['scope'], right: CapabilityInvocationV1['scope']): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function parseDecisionTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function deny(
  capabilityId: string,
  invocationId: string | undefined,
  reasonCodes: readonly CapabilityReasonCode[]
): CapabilityDecision {
  return Object.freeze({
    status: 'deny',
    reasonCodes: Object.freeze([...reasonCodes]),
    capabilityId,
    ...(invocationId === undefined ? {} : { invocationId }),
    createdAt: new Date().toISOString()
  });
}

function dedupeReasons(reasons: readonly CapabilityReasonCode[]): readonly CapabilityReasonCode[] {
  return Object.freeze([...new Set(reasons)]);
}
