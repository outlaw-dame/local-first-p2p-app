import { describe, expect, it } from 'vitest';
import {
  assertProfileAllowsAction,
  canProfileDelegateTo,
  canProfilePerformAction,
  getAuthorityProfile,
  validateAuthorityProfile,
  validateDelegationChain
} from '../authority-profiles.js';
import { CapabilityError } from '../errors.js';

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

/* -------------------------------------------------------------------------- */
/*   validateDelegationChain — privilege-escalation + attenuation + depth     */
/* -------------------------------------------------------------------------- */

describe('validateDelegationChain — single-step delegation rules', () => {
  it('super-peer → relay with a subset of actions and depth 0 is allowed', () => {
    const parent = getAuthorityProfile('super-peer');
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'relay',
        actions: ['relay.forward-envelope'],
        depth: 0
      })
    ).not.toThrow();
  });

  it('relay → super-peer is REJECTED (no privilege escalation)', () => {
    // The relay profile has mayDelegateTo: [] — it cannot delegate
    // anywhere, and especially cannot promote into a super-peer.
    const parent = getAuthorityProfile('relay');
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'super-peer',
        actions: ['relay.forward-envelope'],
        depth: 0
      })
    ).toThrow(/privilege escalation/);
  });

  it('bridge → super-peer is REJECTED (not in mayDelegateTo)', () => {
    const parent = getAuthorityProfile('bridge');
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'super-peer',
        actions: ['bridge.store-bundle'],
        depth: 0
      })
    ).toThrow(/privilege escalation/);
  });

  it('attenuation: child cannot acquire an action the parent does not hold', () => {
    const parent = getAuthorityProfile('super-peer');
    // super-peer does NOT hold 'identity.device.authorize'
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'relay',
        actions: ['identity.device.authorize'],
        depth: 0
      })
    ).toThrow(/attenuation violated/);
  });

  it('attenuation: passes when child actions are a proper subset', () => {
    const parent = getAuthorityProfile('super-peer');
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'relay',
        actions: ['relay.forward-envelope', 'relay.cache-object'],
        depth: 0
      })
    ).not.toThrow();
  });

  it('depth monotonic: child depth must be strictly less than parent maxDelegationDepth', () => {
    const parent = getAuthorityProfile('super-peer'); // maxDelegationDepth=1
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'relay',
        actions: ['relay.forward-envelope'],
        depth: 1 // not strictly less than 1
      })
    ).toThrow(/must be < parent maxDelegationDepth 1/);
  });

  it('depth-0 profile CANNOT re-delegate to anyone (no further chaining)', () => {
    // bridge has maxDelegationDepth=0 — any positive (or zero) child
    // depth fails because 0 is not strictly less than 0.
    const parent = getAuthorityProfile('bridge');
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'relay',
        actions: ['bridge.forward-envelope'],
        depth: 0
      })
    ).toThrow(/must be < parent maxDelegationDepth 0/);
  });

  it('community-moderator CANNOT delegate (mayDelegateTo: [])', () => {
    const parent = getAuthorityProfile('community-moderator');
    for (const childKind of ['actor', 'device', 'controller', 'relay', 'super-peer', 'bridge'] as const) {
      expect(() =>
        validateDelegationChain(parent, {
          childKind,
          actions: ['room.moderate'],
          depth: 0
        })
      ).toThrow(CapabilityError);
    }
  });

  it('throws on malformed input shape (null spec, wrong types)', () => {
    const parent = getAuthorityProfile('super-peer');
    expect(() =>
      // @ts-expect-error: testing runtime guard
      validateDelegationChain(parent, null)
    ).toThrow(CapabilityError);
    expect(() =>
      validateDelegationChain(parent, {
        // @ts-expect-error: testing unsupported kind
        childKind: 'gremlin',
        actions: ['relay.forward-envelope'],
        depth: 0
      })
    ).toThrow(CapabilityError);
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'relay',
        // @ts-expect-error: testing empty actions
        actions: [],
        depth: 0
      })
    ).toThrow(/allowedActions must be a non-empty array/);
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'relay',
        actions: ['relay.forward-envelope'],
        // @ts-expect-error: testing non-integer depth
        depth: -1
      })
    ).toThrow(CapabilityError);
  });

  it('regression: rejects array-shaped child spec (gemini #82 — assertPlainObject defends against arrays)', () => {
    const parent = getAuthorityProfile('super-peer');
    expect(() =>
      // @ts-expect-error: testing runtime guard
      validateDelegationChain(parent, [{ childKind: 'relay', actions: ['relay.forward-envelope'], depth: 0 }])
    ).toThrow(CapabilityError);
  });

  it('regression: rejects child spec carrying a forbidden prototype-pollution key', () => {
    const parent = getAuthorityProfile('super-peer');
    expect(() =>
      validateDelegationChain(parent, {
        childKind: 'relay',
        actions: ['relay.forward-envelope'],
        depth: 0,
        // @ts-expect-error: testing prototype-pollution guard
        __proto__: { polluted: true }
      })
    ).toThrow(CapabilityError);
  });

  it('does not mutate the parent profile (pure)', () => {
    const parent = getAuthorityProfile('super-peer');
    const before = JSON.stringify(parent);
    try {
      validateDelegationChain(parent, {
        childKind: 'super-peer', // intentionally bad to force a throw
        actions: ['relay.forward-envelope'],
        depth: 0
      });
    } catch {
      // expected
    }
    expect(JSON.stringify(parent)).toBe(before);
  });
});
