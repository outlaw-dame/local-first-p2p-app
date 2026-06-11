import { describe, expect, it } from 'vitest';
import {
  assertProfileAllowsAction,
  canProfileDelegateTo,
  canProfilePerformAction,
  getAuthorityProfile,
  validateAuthorityProfile
} from '../authority-profiles.js';

describe('authority profiles', () => {
  it('defines relay and bridge action boundaries', () => {
    expect(canProfilePerformAction('relay', 'relay.forward-envelope')).toBe(true);
    expect(canProfilePerformAction('relay', 'super-peer.store-bundle')).toBe(false);
    expect(canProfilePerformAction('bridge', 'bridge.store-bundle')).toBe(true);
  });

  it('allows super-peers to delegate only to relays', () => {
    expect(canProfileDelegateTo('super-peer', 'relay')).toBe(true);
    expect(canProfileDelegateTo('relay', 'super-peer')).toBe(false);
  });

  it('validates custom profile records', () => {
    const profile = validateAuthorityProfile({
      profileId: 'community-moderator',
      authorityKind: 'actor',
      allowedActions: ['community.member.remove'],
      maxDelegationDepth: 0,
      mayDelegateTo: []
    });
    expect(profile.profileId).toBe('community-moderator');
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it('throws when a profile does not allow an action', () => {
    expect(() => assertProfileAllowsAction('relay', 'community.role.assign')).toThrow('CAP_INVALID_ACTION');
  });

  it('returns built-in profiles', () => {
    expect(getAuthorityProfile('community-moderator').allowedActions).toContain('room.moderate');
  });
});
