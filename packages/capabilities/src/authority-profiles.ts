import { capabilityError } from './errors.js';
import type { CapabilityAction, CapabilityPartyKind } from './types.js';
import { CAPABILITY_ACTIONS } from './types.js';

export const AUTHORITY_PROFILE_IDS = [
  'relay',
  'bridge',
  'super-peer',
  'community-moderator'
] as const;

export type AuthorityProfileId = (typeof AUTHORITY_PROFILE_IDS)[number];

export type AuthorityDelegationProfile = Readonly<{
  profileId: AuthorityProfileId;
  authorityKind: CapabilityPartyKind;
  allowedActions: readonly CapabilityAction[];
  maxDelegationDepth: number;
  mayDelegateTo: readonly CapabilityPartyKind[];
}>;

export const AUTHORITY_DELEGATION_PROFILES: readonly AuthorityDelegationProfile[] = Object.freeze([
  Object.freeze({
    profileId: 'relay',
    authorityKind: 'relay',
    allowedActions: Object.freeze<readonly CapabilityAction[]>([
      'relay.forward-envelope',
      'relay.cache-object'
    ]),
    maxDelegationDepth: 0,
    mayDelegateTo: Object.freeze<readonly CapabilityPartyKind[]>([])
  }),
  Object.freeze({
    profileId: 'bridge',
    authorityKind: 'bridge',
    allowedActions: Object.freeze<readonly CapabilityAction[]>([
      'bridge.store-bundle',
      'bridge.forward-envelope',
      'bridge.publish-admission-decision'
    ]),
    maxDelegationDepth: 0,
    mayDelegateTo: Object.freeze<readonly CapabilityPartyKind[]>(['relay'])
  }),
  Object.freeze({
    profileId: 'super-peer',
    authorityKind: 'super-peer',
    allowedActions: Object.freeze<readonly CapabilityAction[]>([
      'super-peer.store-bundle',
      'relay.forward-envelope',
      'relay.cache-object'
    ]),
    maxDelegationDepth: 1,
    mayDelegateTo: Object.freeze<readonly CapabilityPartyKind[]>(['relay'])
  }),
  Object.freeze({
    profileId: 'community-moderator',
    authorityKind: 'actor',
    allowedActions: Object.freeze<readonly CapabilityAction[]>([
      'community.member.approve',
      'community.member.remove',
      'label.issue',
      'label.revoke',
      'report.resolve',
      'appeal.resolve',
      'room.moderate'
    ]),
    maxDelegationDepth: 0,
    mayDelegateTo: Object.freeze<readonly CapabilityPartyKind[]>([])
  })
]);

export function getAuthorityProfile(profileId: AuthorityProfileId): AuthorityDelegationProfile {
  const profile = AUTHORITY_DELEGATION_PROFILES.find((item) => item.profileId === profileId);
  if (profile === undefined)
    throw capabilityError('CAP_INVALID_ENUM', 'authority profile is not supported');
  return profile;
}

export function validateAuthorityProfile(value: unknown): AuthorityDelegationProfile {
  const record = assertPlainObject(value, 'AuthorityDelegationProfile');
  const profileId = assertProfileId(record.profileId);
  const authorityKind = assertPartyKind(record.authorityKind);
  const allowedActions = assertActions(record.allowedActions);
  const maxDelegationDepth = assertNonNegativeInteger(
    record.maxDelegationDepth,
    'AuthorityDelegationProfile.maxDelegationDepth'
  );
  const mayDelegateTo = assertPartyKinds(record.mayDelegateTo);
  return Object.freeze({
    profileId,
    authorityKind,
    allowedActions,
    maxDelegationDepth,
    mayDelegateTo
  });
}

export function canProfilePerformAction(
  profileId: AuthorityProfileId,
  action: CapabilityAction
): boolean {
  return getAuthorityProfile(profileId).allowedActions.includes(action);
}

export function canProfileDelegateTo(
  profileId: AuthorityProfileId,
  targetKind: CapabilityPartyKind
): boolean {
  return getAuthorityProfile(profileId).mayDelegateTo.includes(targetKind);
}

export function assertProfileAllowsAction(
  profileId: AuthorityProfileId,
  action: CapabilityAction
): void {
  if (!canProfilePerformAction(profileId, action)) {
    throw capabilityError('CAP_INVALID_ACTION', 'authority profile does not allow this action');
  }
}

/**
 * Specification of a delegated child grant for chain-validation.
 * Captures the three properties a delegation must respect:
 *
 *   - `childKind`: the party kind receiving the delegation
 *   - `actions`: the actions the child claims
 *   - `depth`: the child grant's own `delegationDepth`
 *
 * `validateDelegationChain(parent, child)` (below) asserts the
 * delegation does not escalate privilege, drop attenuation, or
 * exceed the parent's permitted depth.
 */
export type DelegationChildSpec = Readonly<{
  childKind: CapabilityPartyKind;
  actions: readonly CapabilityAction[];
  depth: number;
}>;

/**
 * Pin the three structural rules of a single delegation step:
 *
 *   1. **No privilege escalation.** The child's party kind must be
 *      one of `parent.mayDelegateTo`. Throws `CAP_INVALID_PARTY`
 *      otherwise. This is the rule that makes `relay → super-peer`
 *      structurally impossible regardless of what a malformed grant
 *      claims.
 *
 *   2. **Action attenuation.** Every action in the child grant
 *      must appear in `parent.allowedActions`. A child cannot
 *      acquire actions its delegator does not itself hold. Throws
 *      `CAP_INVALID_ACTION` on the first violation.
 *
 *   3. **Depth monotonic.** The child's `depth` must be strictly
 *      less than `parent.maxDelegationDepth`. A profile with
 *      `maxDelegationDepth === 0` therefore CANNOT re-delegate to
 *      anyone, regardless of `mayDelegateTo`. Throws
 *      `CAP_INVALID_NUMBER`.
 *
 * Pure on its inputs; no side effects. Caller is expected to have
 * already validated the actions list through their normal grant
 * validation; `validateDelegationChain` only enforces the
 * relationship between two grants.
 */
export function validateDelegationChain(
  parent: AuthorityDelegationProfile,
  child: DelegationChildSpec
): void {
  const parentProfile = validateAuthorityProfile(parent);
  // Use the file's assertPlainObject helper — it also guards against
  // arrays and non-Object prototypes, and is the consistent pattern
  // across this package's other validators. Addresses the gemini
  // review on PR #82.
  const spec = assertPlainObject(child, 'DelegationChildSpec');
  const childKind = assertPartyKind(spec.childKind);
  if (!parentProfile.mayDelegateTo.includes(childKind)) {
    throw capabilityError(
      'CAP_INVALID_PARTY',
      `${parentProfile.profileId} may not delegate to ${childKind} (privilege escalation)`
    );
  }
  const actions = assertActions(spec.actions);
  for (const action of actions) {
    if (!parentProfile.allowedActions.includes(action)) {
      throw capabilityError(
        'CAP_INVALID_ACTION',
        `child action ${action} is not in parent's allowedActions (attenuation violated)`
      );
    }
  }
  const depth = assertNonNegativeInteger(spec.depth, 'DelegationChildSpec.depth');
  if (depth >= parentProfile.maxDelegationDepth) {
    throw capabilityError(
      'CAP_INVALID_NUMBER',
      `child depth ${depth} must be < parent maxDelegationDepth ${parentProfile.maxDelegationDepth}`
    );
  }
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a plain object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertProfileId(value: unknown): AuthorityProfileId {
  if (typeof value !== 'string' || !(AUTHORITY_PROFILE_IDS as readonly string[]).includes(value)) {
    throw capabilityError('CAP_INVALID_ENUM', 'profileId is not supported');
  }
  return value as AuthorityProfileId;
}

function assertPartyKind(value: unknown): CapabilityPartyKind {
  const allowed: readonly CapabilityPartyKind[] = [
    'actor',
    'device',
    'controller',
    'service',
    'bridge',
    'relay',
    'super-peer',
    'labeler',
    'bot',
    'pseudonym'
  ];
  if (typeof value !== 'string' || !allowed.includes(value as CapabilityPartyKind)) {
    throw capabilityError('CAP_INVALID_ENUM', 'authorityKind is not supported');
  }
  return value as CapabilityPartyKind;
}

function assertPartyKinds(value: unknown): readonly CapabilityPartyKind[] {
  if (!Array.isArray(value))
    throw capabilityError('CAP_INVALID_INPUT', 'mayDelegateTo must be an array');
  return Object.freeze(value.map(assertPartyKind));
}

function assertActions(value: unknown): readonly CapabilityAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw capabilityError('CAP_INVALID_ACTION', 'allowedActions must be a non-empty array');
  }
  const seen = new Set<string>();
  return Object.freeze(
    value.map((item) => {
      if (typeof item !== 'string' || !(CAPABILITY_ACTIONS as readonly string[]).includes(item)) {
        throw capabilityError('CAP_INVALID_ACTION', 'allowed action is not supported');
      }
      if (seen.has(item))
        throw capabilityError('CAP_DUPLICATE_VALUE', 'allowedActions contains duplicate action');
      seen.add(item);
      return item as CapabilityAction;
    })
  );
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw capabilityError('CAP_INVALID_NUMBER', `${label} must be a safe non-negative integer`);
  }
  return value as number;
}
