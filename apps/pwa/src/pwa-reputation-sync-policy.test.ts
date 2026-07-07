/**
 * Phase 1.8.13 — adversarial tests for the cross-device sync policy.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPUTATION_SYNC_POLICY,
  REPUTATION_SYNC_POLICY_VERSION,
  REPUTATION_SYNC_SCOPES,
  REPUTATION_USER_EMIT_KINDS,
  loadReputationSyncPolicy,
  normaliseReputationSyncPolicy,
  resetReputationSyncPolicy,
  resolveReputationPrivacy,
  saveReputationSyncPolicy
} from './pwa-reputation-sync-policy.js';

// Minimal in-memory storage that satisfies the StorageLike interface.
function makeFakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    // Test-only inspection.
    _raw: () => map
  };
}

/* -------------------------------------------------------------------------- */

describe('DEFAULT_REPUTATION_SYNC_POLICY — doctrine non-negotiable #2', () => {
  it('all kinds default to device-local', () => {
    expect(DEFAULT_REPUTATION_SYNC_POLICY.observation).toBe('device-local');
    expect(DEFAULT_REPUTATION_SYNC_POLICY.attestation).toBe('device-local');
    expect(DEFAULT_REPUTATION_SYNC_POLICY.revocation).toBe('device-local');
  });

  it('is frozen at module load', () => {
    expect(Object.isFrozen(DEFAULT_REPUTATION_SYNC_POLICY)).toBe(true);
  });

  it('carries the documented version sentinel', () => {
    expect(DEFAULT_REPUTATION_SYNC_POLICY.version).toBe(REPUTATION_SYNC_POLICY_VERSION);
    expect(DEFAULT_REPUTATION_SYNC_POLICY.version).toBe('lfp2p.reputation-sync-policy.v1');
  });
});

describe('REPUTATION_SYNC_SCOPES / REPUTATION_USER_EMIT_KINDS — frozen enums', () => {
  it('both tuples are frozen at module load', () => {
    expect(Object.isFrozen(REPUTATION_SYNC_SCOPES)).toBe(true);
    expect(Object.isFrozen(REPUTATION_USER_EMIT_KINDS)).toBe(true);
  });

  it('scopes include device-local + account-local ONLY (no public)', () => {
    expect(REPUTATION_SYNC_SCOPES).toContain('device-local');
    expect(REPUTATION_SYNC_SCOPES).toContain('account-local');
    expect(REPUTATION_SYNC_SCOPES).not.toContain('public');
  });

  it('user-emit kinds include observation/attestation/revocation (NOT aggregator)', () => {
    expect(REPUTATION_USER_EMIT_KINDS).toEqual(['observation', 'attestation', 'revocation']);
  });
});

describe('resolveReputationPrivacy', () => {
  it('override > policy > default', () => {
    const policy = { ...DEFAULT_REPUTATION_SYNC_POLICY, observation: 'account-local' as const };
    expect(resolveReputationPrivacy(policy, 'observation')).toBe('account-local');
    expect(resolveReputationPrivacy(policy, 'observation', 'device-local')).toBe('device-local');
  });

  it('unknown override falls through to policy (does NOT crash)', () => {
    const policy = { ...DEFAULT_REPUTATION_SYNC_POLICY, observation: 'account-local' as const };
    // @ts-expect-error: testing runtime guard
    expect(resolveReputationPrivacy(policy, 'observation', 'public')).toBe('account-local');
  });
});

describe('normaliseReputationSyncPolicy', () => {
  it('throws on non-object input', () => {
    expect(() => normaliseReputationSyncPolicy(null)).toThrow();
    expect(() => normaliseReputationSyncPolicy('hello')).toThrow();
  });

  it('missing fields fall back to default', () => {
    const out = normaliseReputationSyncPolicy({ observation: 'account-local' });
    expect(out.observation).toBe('account-local');
    expect(out.attestation).toBe('device-local');
    expect(out.revocation).toBe('device-local');
  });

  it('unknown scope values fall back to default', () => {
    const out = normaliseReputationSyncPolicy({
      observation: 'broadcast-everywhere',
      attestation: 'account-local',
      revocation: 'device-local'
    });
    expect(out.observation).toBe('device-local');
    expect(out.attestation).toBe('account-local');
  });

  it('output is frozen and carries the version sentinel', () => {
    const out = normaliseReputationSyncPolicy({});
    expect(Object.isFrozen(out)).toBe(true);
    expect(out.version).toBe(REPUTATION_SYNC_POLICY_VERSION);
  });
});

describe('localStorage persistence', () => {
  it('loadReputationSyncPolicy returns the doctrine default when no preference is stored', () => {
    const fake = makeFakeStorage();
    expect(loadReputationSyncPolicy(fake)).toEqual(DEFAULT_REPUTATION_SYNC_POLICY);
  });

  it('save then load round-trips', () => {
    const fake = makeFakeStorage();
    saveReputationSyncPolicy(
      {
        observation: 'account-local',
        attestation: 'account-local',
        revocation: 'device-local'
      },
      fake
    );
    const loaded = loadReputationSyncPolicy(fake);
    expect(loaded.observation).toBe('account-local');
    expect(loaded.attestation).toBe('account-local');
    expect(loaded.revocation).toBe('device-local');
  });

  it('corrupt JSON in storage falls back to default (fail closed on read)', () => {
    const fake = makeFakeStorage();
    fake.setItem('lfp2p.pwa.reputation-sync-policy.v1', 'not-json{');
    expect(loadReputationSyncPolicy(fake)).toEqual(DEFAULT_REPUTATION_SYNC_POLICY);
  });

  it('save normalises before writing (cannot persist corrupt blob)', () => {
    const fake = makeFakeStorage();
    saveReputationSyncPolicy({ observation: 'made-up-scope' }, fake);
    const loaded = loadReputationSyncPolicy(fake);
    expect(loaded.observation).toBe('device-local'); // doctrine default
  });

  it('reset clears the stored preference back to default', () => {
    const fake = makeFakeStorage();
    saveReputationSyncPolicy({ observation: 'account-local' }, fake);
    const out = resetReputationSyncPolicy(fake);
    expect(out).toEqual(DEFAULT_REPUTATION_SYNC_POLICY);
    expect(loadReputationSyncPolicy(fake)).toEqual(DEFAULT_REPUTATION_SYNC_POLICY);
  });

  it('save throws on non-object input (caller bug)', () => {
    const fake = makeFakeStorage();
    expect(() => saveReputationSyncPolicy(null, fake)).toThrow();
    expect(() => saveReputationSyncPolicy('hello', fake)).toThrow();
  });

  it('absent storage (SSR / Node) returns default silently from load', () => {
    expect(loadReputationSyncPolicy(undefined)).toEqual(DEFAULT_REPUTATION_SYNC_POLICY);
  });
});
