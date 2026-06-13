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
    allowedActions: Object.freeze<readonly CapabilityAction[]>(['relay.forward-envelope', 'relay.cache-object']),
    maxDelegationDepth: 0,
    mayDelegateTo: Object.freeze<readonly CapabilityPartyKind[]>([])
  }),
  Object.freeze({
    profileId: 'bridge',
    authorityKind: 'bridge',
    allowedActions: Object.freeze<readonly CapabilityAction[]>(['bridge.store-bundle', 'bridge.forward-envelope', 'bridge.publish-admission-decision']),
    maxDelegationDepth: 0,
    mayDelegateTo: Object.freeze<readonly CapabilityPartyKind[]>(['relay'])
  }),
  Object.freeze({
    profileId: 'super-peer',
    authorityKind: 'super-peer',
    allowedActions: Object.freeze<readonly CapabilityAction[]>(['super-peer.store-bundle', 'relay.forward-envelope', 'relay.cache-object']),
    maxDelegationDepth: 1,
    mayDelegateTo: Object.freeze<readonly CapabilityPartyKind[]>(['relay'])
  }),
  Object.freeze({
    profileId: 'community-moderator',
    authorityKind: 'actor',
    allowedActions: Object.freeze<readonly CapabilityAction[]>(['community.member.approve', 'community.member.remove', 'label.issue', 'label.revoke', 'report.resolve', 'appeal.resolve', 'room.moderate']),
    maxDelegationDepth: 0,
    mayDelegateTo: Object.freeze<readonly CapabilityPartyKind[]>([])
  })
]);

export function getAuthorityProfile(profileId: AuthorityProfileId): AuthorityDelegationProfile {
  const profile = AUTHORITY_DELEGATION_PROFILES.find((item) => item.profileId === profileId);
  if (profile === undefined) throw capabilityError('CAP_INVALID_ENUM', 'authority profile is not supported');
  return profile;
}

export function validateAuthorityProfile(value: unknown): AuthorityDelegationProfile {
  const record = assertPlainObject(value, 'AuthorityDelegationProfile');
  const profileId = assertProfileId(record.profileId);
  const authorityKind = assertPartyKind(record.authorityKind);
  const allowedActions = assertActions(record.allowedActions);
  const maxDelegationDepth = assertNonNegativeInteger(record.maxDelegationDepth, 'AuthorityDelegationProfile.maxDelegationDepth');
  const mayDelegateTo = assertPartyKinds(record.mayDelegateTo);
  return Object.freeze({ profileId, authorityKind, allowedActions, maxDelegationDepth, mayDelegateTo });
}

export function canProfilePerformAction(profileId: AuthorityProfileId, action: CapabilityAction): boolean {
  return getAuthorityProfile(profileId).allowedActions.includes(action);
}

export function canProfileDelegateTo(profileId: AuthorityProfileId, targetKind: CapabilityPartyKind): boolean {
  return getAuthorityProfile(profileId).mayDelegateTo.includes(targetKind);
}

export function assertProfileAllowsAction(profileId: AuthorityProfileId, action: CapabilityAction): void {
  if (!canProfilePerformAction(profileId, action)) {
    throw capabilityError('CAP_INVALID_ACTION', 'authority profile does not allow this action');
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
  const allowed: readonly CapabilityPartyKind[] = ['actor', 'device', 'controller', 'service', 'bridge', 'relay', 'super-peer', 'labeler', 'bot', 'pseudonym'];
  if (typeof value !== 'string' || !allowed.includes(value as CapabilityPartyKind)) {
    throw capabilityError('CAP_INVALID_ENUM', 'authorityKind is not supported');
  }
  return value as CapabilityPartyKind;
}

function assertPartyKinds(value: unknown): readonly CapabilityPartyKind[] {
  if (!Array.isArray(value)) throw capabilityError('CAP_INVALID_INPUT', 'mayDelegateTo must be an array');
  return Object.freeze(value.map(assertPartyKind));
}

function assertActions(value: unknown): readonly CapabilityAction[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw capabilityError('CAP_INVALID_ACTION', 'allowedActions must be a non-empty array');
  }
  const seen = new Set<string>();
  return Object.freeze(value.map((item) => {
    if (typeof item !== 'string' || !(CAPABILITY_ACTIONS as readonly string[]).includes(item)) {
      throw capabilityError('CAP_INVALID_ACTION', 'allowed action is not supported');
    }
    if (seen.has(item)) throw capabilityError('CAP_DUPLICATE_VALUE', 'allowedActions contains duplicate action');
    seen.add(item);
    return item as CapabilityAction;
  }));
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw capabilityError('CAP_INVALID_NUMBER', `${label} must be a safe non-negative integer`);
  }
  return value as number;
}
