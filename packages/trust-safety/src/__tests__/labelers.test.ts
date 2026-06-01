import { describe, expect, it } from 'vitest';
import {
  validateSafetyLabelerProfile,
  validateSafetyLabelerSubscription
} from '../index.js';

const PROFILE_BASE = {
  version: 'lfp2p.safety-labeler-profile.v1' as const,
  labelerId: 'labeler_1',
  actorId: 'actor_labeler',
  displayName: 'Labeler One',
  supportedNamespaces: ['lfp2p.safety'],
  supportedLabels: ['security.spam'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z'
};

describe('validateSafetyLabelerProfile', () => {
  it('accepts a minimal profile', () => {
    expect(() => validateSafetyLabelerProfile(PROFILE_BASE)).not.toThrow();
  });

  it('rejects http serviceEndpoint', () => {
    expect(() =>
      validateSafetyLabelerProfile({
        ...PROFILE_BASE,
        serviceEndpoint: 'http://labeler.example.com/'
      })
    ).toThrow(/TS_INVALID_LABELER/);
  });

  it('rejects serviceEndpoint with userinfo', () => {
    expect(() =>
      validateSafetyLabelerProfile({
        ...PROFILE_BASE,
        serviceEndpoint: 'https://user:pass@labeler.example.com/'
      })
    ).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('rejects updatedAt before createdAt', () => {
    expect(() =>
      validateSafetyLabelerProfile({
        ...PROFILE_BASE,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
      })
    ).toThrow(/TS_INVALID_TIMESTAMP/);
  });
});

const SUBSCRIPTION_BASE = {
  version: 'lfp2p.safety-labeler-subscription.v1' as const,
  subscriptionId: 'sub_1',
  subscriberActorId: 'actor_damon',
  labelerId: 'labeler_1',
  trustedNamespaces: ['lfp2p.safety'],
  scope: 'device-local' as const,
  createdAt: '2026-05-30T00:00:00Z'
};

describe('validateSafetyLabelerSubscription', () => {
  it('accepts a minimal subscription', () => {
    expect(() => validateSafetyLabelerSubscription(SUBSCRIPTION_BASE)).not.toThrow();
  });

  it('rejects network-advisory scope (subscriptions are strictly local)', () => {
    expect(() =>
      validateSafetyLabelerSubscription({ ...SUBSCRIPTION_BASE, scope: 'network-advisory' })
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('rejects oversized actionOverrides', () => {
    const big = new Array(1025).fill({
      labelKey: 'security.spam',
      namespace: 'lfp2p.safety',
      action: 'collapse'
    });
    expect(() =>
      validateSafetyLabelerSubscription({ ...SUBSCRIPTION_BASE, actionOverrides: big })
    ).toThrow();
  });
});
