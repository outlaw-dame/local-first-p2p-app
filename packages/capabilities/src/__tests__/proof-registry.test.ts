/**
 * Adversarial tests for the capability proof registry.
 *
 * The headline guarantee: the registry NEVER reports `verified`
 * without an injected verifier actually saying so, and deterministic
 * revoked/expired gates always win over cryptography. UCAN/VC proofs
 * stay `unverified` until a dedicated verifier exists — the registry
 * does not pretend to validate a credential format it cannot check.
 */
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_PROOF_REGISTRY_VERSION,
  CAPABILITY_PROOF_VERIFICATION_STATES,
  CapabilityError,
  createProofRegistry,
  evaluateCapabilityReliance,
  getProof,
  registerProof,
  revokeProof,
  summarizeProofStates,
  verifyProof,
  type CapabilityDecision,
  type CapabilityPartyRef,
  type CapabilityProofVerifier,
  type RegisterProofInput
} from '../index.js';

const NOW = '2026-06-08T12:00:00.000Z';
const LATER = '2026-07-01T00:00:00.000Z';
const ISSUER: CapabilityPartyRef = { kind: 'controller', id: 'controller:damon' };
const SUBJECT: CapabilityPartyRef = { kind: 'device', id: 'device:laptop' };
const DIGEST = 'sha-256:abcdef0123456789';

function input(overrides: Partial<RegisterProofInput> = {}): RegisterProofInput {
  return {
    proofId: 'proof:native:1',
    scheme: 'native-signed-event',
    issuer: ISSUER,
    subject: SUBJECT,
    issuedAt: '2026-06-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    digest: DIGEST,
    ...overrides
  };
}

const verifyAll: CapabilityProofVerifier = () => 'verified';
const rejectAll: CapabilityProofVerifier = () => 'invalid';
const abstain: CapabilityProofVerifier = () => undefined;

/* -------------------------------------------------------------------------- */

describe('createProofRegistry + registerProof + getProof', () => {
  it('starts empty with the documented version', () => {
    const reg = createProofRegistry();
    expect(reg.version).toBe(CAPABILITY_PROOF_REGISTRY_VERSION);
    expect(reg.proofs.size).toBe(0);
  });

  it('registers a proof with initial state unverified (registration != verification)', () => {
    const { registry, record } = registerProof(createProofRegistry(), input());
    expect(record.verificationState).toBe('unverified');
    expect(record.proofId).toBe('proof:native:1');
    expect(registry.proofs.size).toBe(1);
    expect(getProof(registry, 'proof:native:1')).toEqual(record);
  });

  it('a proof registered already revoked starts revoked', () => {
    const { record } = registerProof(
      createProofRegistry(),
      input({ revokedAt: '2026-06-05T00:00:00.000Z' })
    );
    expect(record.verificationState).toBe('revoked');
    expect(record.revokedAt).toBe('2026-06-05T00:00:00.000Z');
  });

  it('is immutable: re-registering the same proofId throws', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    expect(() => registerProof(registry, input())).toThrow(CapabilityError);
  });

  it('output records + registry are deep-frozen', () => {
    const { registry, record } = registerProof(createProofRegistry(), input());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.issuer)).toBe(true);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.proofs)).toBe(true);
  });

  it('registering does not mutate the input registry (pure)', () => {
    const base = createProofRegistry();
    registerProof(base, input());
    expect(base.proofs.size).toBe(0);
  });

  it('rejects malformed input: bad digest, bad timestamps, prototype pollution', () => {
    expect(() => registerProof(createProofRegistry(), input({ digest: 'not-a-digest' }))).toThrow(
      CapabilityError
    );
    expect(() =>
      registerProof(createProofRegistry(), input({ issuedAt: '2027-01-01T00:00:00Z', expiresAt: '2026-01-01T00:00:00Z' }))
    ).toThrow(/issuedAt must be before expiresAt/);
    expect(() =>
      // @ts-expect-error: testing prototype-pollution guard
      registerProof(createProofRegistry(), { ...input(), __proto__: { polluted: true } })
    ).toThrow(CapabilityError);
  });

  it('rejects revokedAt that predates issuedAt', () => {
    expect(() =>
      registerProof(createProofRegistry(), input({ revokedAt: '2025-01-01T00:00:00.000Z' }))
    ).toThrow(/revokedAt must not predate issuedAt/);
  });
});

/* -------------------------------------------------------------------------- */

describe('verifyProof — verification state machine', () => {
  it('native proof with a verifying verifier → verified', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    const { record } = verifyProof(registry, 'proof:native:1', { now: NOW, verifier: verifyAll });
    expect(record.verificationState).toBe('verified');
  });

  it('native proof with a rejecting verifier → invalid', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    const { record } = verifyProof(registry, 'proof:native:1', { now: NOW, verifier: rejectAll });
    expect(record.verificationState).toBe('invalid');
  });

  it('NEVER verifies without a verifier — abstaining / absent verifier → unverified', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    expect(verifyProof(registry, 'proof:native:1', { now: NOW }).record.verificationState).toBe(
      'unverified'
    );
    expect(
      verifyProof(registry, 'proof:native:1', { now: NOW, verifier: abstain }).record.verificationState
    ).toBe('unverified');
  });

  it('UCAN / VC proofs stay unverified even with a native-only verifier that abstains', () => {
    let reg = createProofRegistry();
    reg = registerProof(reg, input({ proofId: 'proof:ucan:1', scheme: 'ucan' })).registry;
    reg = registerProof(reg, input({ proofId: 'proof:vc:1', scheme: 'vc' })).registry;
    // A verifier that only knows native-signed-event abstains on others.
    const nativeOnly: CapabilityProofVerifier = (r) =>
      r.scheme === 'native-signed-event' ? 'verified' : undefined;
    expect(verifyProof(reg, 'proof:ucan:1', { now: NOW, verifier: nativeOnly }).record.verificationState).toBe(
      'unverified'
    );
    expect(verifyProof(reg, 'proof:vc:1', { now: NOW, verifier: nativeOnly }).record.verificationState).toBe(
      'unverified'
    );
  });

  it('expired beats cryptography: an expired proof is expired even if the verifier would verify it', () => {
    const { registry } = registerProof(
      createProofRegistry(),
      input({ expiresAt: '2026-06-02T00:00:00.000Z' })
    );
    const { record } = verifyProof(registry, 'proof:native:1', { now: LATER, verifier: verifyAll });
    expect(record.verificationState).toBe('expired');
  });

  it('expiry boundary: now exactly == expiresAt is expired (fail closed)', () => {
    const exp = '2026-06-08T12:00:00.000Z';
    const { registry } = registerProof(createProofRegistry(), input({ expiresAt: exp }));
    const { record } = verifyProof(registry, 'proof:native:1', { now: exp, verifier: verifyAll });
    expect(record.verificationState).toBe('expired');
  });

  it('revoked beats everything: a revoked proof verifies as revoked even with a verifying verifier', () => {
    const { registry } = registerProof(
      createProofRegistry(),
      input({ revokedAt: '2026-06-05T00:00:00.000Z' })
    );
    const { record } = verifyProof(registry, 'proof:native:1', { now: NOW, verifier: verifyAll });
    expect(record.verificationState).toBe('revoked');
  });

  it('is pure + idempotent: verifying twice yields an equal record and does not mutate the prior registry', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    const first = verifyProof(registry, 'proof:native:1', { now: NOW, verifier: verifyAll });
    const second = verifyProof(first.registry, 'proof:native:1', { now: NOW, verifier: verifyAll });
    expect(second.record).toEqual(first.record);
    // original registry's record stays unverified (untouched)
    expect(getProof(registry, 'proof:native:1')?.verificationState).toBe('unverified');
  });

  it('throws on unknown proofId or a non-function verifier', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    expect(() => verifyProof(registry, 'proof:missing', { now: NOW })).toThrow(/unknown proofId/);
    expect(() =>
      // @ts-expect-error: testing runtime guard
      verifyProof(registry, 'proof:native:1', { now: NOW, verifier: 'nope' })
    ).toThrow(CapabilityError);
  });
});

/* -------------------------------------------------------------------------- */

describe('revokeProof', () => {
  it('revokes a proof and sets state revoked + revokedAt', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    const { record } = revokeProof(registry, 'proof:native:1', { revokedAt: NOW });
    expect(record.verificationState).toBe('revoked');
    expect(record.revokedAt).toBe(NOW);
  });

  it('is monotonic: revoking an already-revoked proof keeps the first revokedAt', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    const once = revokeProof(registry, 'proof:native:1', { revokedAt: NOW });
    const twice = revokeProof(once.registry, 'proof:native:1', { revokedAt: LATER });
    expect(twice.record.revokedAt).toBe(NOW); // first revocation wins
  });

  it('a revoked proof can never return to verified', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    const revoked = revokeProof(registry, 'proof:native:1', { revokedAt: NOW });
    const reverified = verifyProof(revoked.registry, 'proof:native:1', { now: NOW, verifier: verifyAll });
    expect(reverified.record.verificationState).toBe('revoked');
  });

  it('throws on unknown proofId', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    expect(() => revokeProof(registry, 'proof:missing', { revokedAt: NOW })).toThrow(/unknown proofId/);
  });
});

/* -------------------------------------------------------------------------- */

describe('summarizeProofStates — worst-case aggregation (fail closed)', () => {
  it('empty ref list → unverified (no proof backs the claim)', () => {
    expect(summarizeProofStates(createProofRegistry(), [])).toBe('unverified');
  });

  it('a ref pointing at an unknown proof → unverified', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    expect(
      summarizeProofStates(registry, [{ proofId: 'proof:ghost', scheme: 'ucan' }])
    ).toBe('unverified');
  });

  it('all verified → verified', () => {
    let reg = createProofRegistry();
    reg = registerProof(reg, input({ proofId: 'p1' })).registry;
    reg = registerProof(reg, input({ proofId: 'p2' })).registry;
    reg = verifyProof(reg, 'p1', { now: NOW, verifier: verifyAll }).registry;
    reg = verifyProof(reg, 'p2', { now: NOW, verifier: verifyAll }).registry;
    expect(
      summarizeProofStates(reg, [
        { proofId: 'p1', scheme: 'native-signed-event' },
        { proofId: 'p2', scheme: 'native-signed-event' }
      ])
    ).toBe('verified');
  });

  it('one revoked proof poisons the set even when others verify', () => {
    let reg = createProofRegistry();
    reg = registerProof(reg, input({ proofId: 'good' })).registry;
    reg = registerProof(reg, input({ proofId: 'bad' })).registry;
    reg = verifyProof(reg, 'good', { now: NOW, verifier: verifyAll }).registry;
    reg = revokeProof(reg, 'bad', { revokedAt: NOW }).registry;
    expect(
      summarizeProofStates(reg, [
        { proofId: 'good', scheme: 'native-signed-event' },
        { proofId: 'bad', scheme: 'native-signed-event' }
      ])
    ).toBe('revoked');
  });

  it('severity order: invalid outranks expired outranks unverified outranks verified', () => {
    let reg = createProofRegistry();
    reg = registerProof(reg, input({ proofId: 'inv' })).registry;
    reg = registerProof(reg, input({ proofId: 'exp', expiresAt: '2026-06-02T00:00:00.000Z' })).registry;
    reg = verifyProof(reg, 'inv', { now: NOW, verifier: rejectAll }).registry; // invalid
    reg = verifyProof(reg, 'exp', { now: LATER, verifier: verifyAll }).registry; // expired
    expect(
      summarizeProofStates(reg, [
        { proofId: 'inv', scheme: 'native-signed-event' },
        { proofId: 'exp', scheme: 'native-signed-event' }
      ])
    ).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */

describe('reliance gate wired to the registry', () => {
  const allowed: CapabilityDecision = {
    status: 'allow',
    reasonCodes: ['capability.valid'],
    capabilityId: 'cap:room:1',
    invocationId: 'invoke:room:1',
    createdAt: NOW
  };

  it('an allowing decision passes through when proofsState is verified', () => {
    const decision = evaluateCapabilityReliance({
      capabilityDecision: allowed,
      proofsState: 'verified',
      action: 'room.moderate',
      now: NOW
    });
    expect(decision.status).toBe('allow');
  });

  it('a revoked proof state turns an allow into deny capability.revoked', () => {
    const decision = evaluateCapabilityReliance({
      capabilityDecision: allowed,
      proofsState: 'revoked',
      action: 'room.moderate',
      now: NOW
    });
    expect(decision.status).toBe('deny');
    expect(decision.reasonCodes).toEqual(['capability.revoked']);
  });

  it('an expired proof state denies with capability.expired', () => {
    const decision = evaluateCapabilityReliance({
      capabilityDecision: allowed,
      proofsState: 'expired',
      action: 'room.moderate',
      now: NOW
    });
    expect(decision.reasonCodes).toEqual(['capability.expired']);
  });

  it('invalid and unverified both deny with capability.unverified-proof', () => {
    for (const state of ['invalid', 'unverified'] as const) {
      const decision = evaluateCapabilityReliance({
        capabilityDecision: allowed,
        proofsState: state,
        action: 'room.moderate',
        now: NOW
      });
      expect(decision.reasonCodes).toEqual(['capability.unverified-proof']);
    }
  });

  it('omitting proofsState preserves the pre-registry behaviour exactly (opt-in gate)', () => {
    const decision = evaluateCapabilityReliance({
      capabilityDecision: allowed,
      action: 'room.moderate',
      now: NOW
    });
    expect(decision).toBe(allowed);
  });
});

/* -------------------------------------------------------------------------- */

describe('verification-state enum integrity', () => {
  it('exposes exactly the five documented states', () => {
    expect([...CAPABILITY_PROOF_VERIFICATION_STATES]).toEqual([
      'unverified',
      'verified',
      'expired',
      'revoked',
      'invalid'
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/*               regression: code review on PR #74 (no-op paths)              */
/* -------------------------------------------------------------------------- */

describe('no-op paths preserve reference equality (cheap "nothing changed" detection)', () => {
  it('verifyProof returns the SAME registry reference when the state does not change', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    // First call: unverified -> unverified (no verifier supplied).
    const first = verifyProof(registry, 'proof:native:1', { now: NOW });
    expect(first.registry).toBe(registry);
    expect(first.record).toBe(getProof(registry, 'proof:native:1'));
  });

  it('verifyProof returns the SAME registry reference on a repeated verified state', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    const once = verifyProof(registry, 'proof:native:1', { now: NOW, verifier: verifyAll });
    expect(once.registry).not.toBe(registry); // state changed: alloc
    const twice = verifyProof(once.registry, 'proof:native:1', { now: NOW, verifier: verifyAll });
    expect(twice.registry).toBe(once.registry); // no change: same ref
    expect(twice.record).toBe(once.record);
  });

  it('revokeProof returns the SAME registry reference when already revoked', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    const once = revokeProof(registry, 'proof:native:1', { revokedAt: NOW });
    const twice = revokeProof(once.registry, 'proof:native:1', { revokedAt: LATER });
    expect(twice.registry).toBe(once.registry);
    expect(twice.record).toBe(once.record); // first revocation wins, same record
  });
});

describe('verifier robustness: a throwing verifier never crashes the registry', () => {
  it('treats a thrown error as invalid (fail closed, more severe than unverified)', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    const throwingVerifier: CapabilityProofVerifier = () => {
      throw new Error('verifier blew up');
    };
    const { record } = verifyProof(registry, 'proof:native:1', {
      now: NOW,
      verifier: throwingVerifier
    });
    expect(record.verificationState).toBe('invalid');
  });

  it('a throwing verifier on one record does NOT poison subsequent calls', () => {
    let reg = createProofRegistry();
    reg = registerProof(reg, input({ proofId: 'p:bad' })).registry;
    reg = registerProof(reg, input({ proofId: 'p:good' })).registry;
    const throwOnBad: CapabilityProofVerifier = (r) => {
      if (r.proofId === 'p:bad') throw new Error('boom');
      return 'verified';
    };
    reg = verifyProof(reg, 'p:bad', { now: NOW, verifier: throwOnBad }).registry;
    reg = verifyProof(reg, 'p:good', { now: NOW, verifier: throwOnBad }).registry;
    expect(getProof(reg, 'p:bad')?.verificationState).toBe('invalid');
    expect(getProof(reg, 'p:good')?.verificationState).toBe('verified');
  });
});

describe('summarizeProofStates — proofId validation via assertId (defense-in-depth)', () => {
  it('rejects a ref whose proofId would violate the assertId guard (forbidden key)', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    expect(() =>
      summarizeProofStates(registry, [
        // @ts-expect-error: testing runtime guard
        { proofId: '__proto__', scheme: 'native-signed-event' }
      ])
    ).toThrow(CapabilityError);
  });

  it('rejects a ref whose proofId is overlong (> 256 chars)', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    expect(() =>
      summarizeProofStates(registry, [
        { proofId: 'x'.repeat(257), scheme: 'native-signed-event' }
      ])
    ).toThrow(CapabilityError);
  });

  it('still rejects a non-object ref with the expected message', () => {
    const { registry } = registerProof(createProofRegistry(), input());
    expect(() =>
      // @ts-expect-error: testing runtime guard
      summarizeProofStates(registry, [null])
    ).toThrow(/each ref must be an object/);
  });
});
