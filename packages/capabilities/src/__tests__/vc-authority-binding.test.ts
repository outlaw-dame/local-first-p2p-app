/**
 * Adversarial tests for the VC authority binding registry.
 *
 * Headline structural property: a binding is EVIDENCE, never
 * authority. The existing `capability.vc-only-authority-denied` gate
 * in `reliance.ts` stays unchanged — registering bindings cannot
 * grant or upgrade authority. This file pins that property by
 * showing that:
 *
 *   1. The binding registry never touches the reliance decision path.
 *   2. `resolveVcBindings` joins binding state with the proof
 *      registry's verificationState, surfacing the worst (least
 *      trustworthy) view honestly. A binding that points at a
 *      non-existent or non-VC proof is NEVER reported `verified`.
 */
import { describe, expect, it } from 'vitest';
import {
  CapabilityError,
  createProofRegistry,
  createVcBindingRegistry,
  evaluateCapabilityReliance,
  getBinding,
  getBindingsForCapability,
  getBindingsForVc,
  registerProof,
  registerVcBinding,
  resolveVcBindings,
  revokeProof,
  validateVcAuthorityBinding,
  verifyProof,
  VC_AUTHORITY_BINDING_VERSION,
  type CapabilityDecision,
  type CapabilityPartyRef,
  type CapabilityProofVerifier,
  type RegisterVcBindingInput
} from '../index.js';

const NOW = '2026-06-08T12:00:00.000Z';
const LATER = '2026-07-01T00:00:00.000Z';
const ISSUER: CapabilityPartyRef = { kind: 'service', id: 'vc-issuer:identity-attestation' };
const SUBJECT: CapabilityPartyRef = { kind: 'controller', id: 'controller:damon' };
const DIGEST = 'sha-256:abcdef0123456789';

function bindingInput(overrides: Partial<RegisterVcBindingInput> = {}): RegisterVcBindingInput {
  return {
    bindingId: 'binding:1',
    vcProofId: 'proof:vc:1',
    capabilityId: 'cap:room:1',
    claimSubject: SUBJECT,
    claimType: 'controls-did',
    claimDigest: DIGEST,
    recordedAt: NOW,
    ...overrides
  };
}

function registerVc(
  proofId: string,
  overrides: {
    revokedAt?: string;
    expiresAt?: string;
    subject?: CapabilityPartyRef;
  } = {}
) {
  return registerProof(createProofRegistry(), {
    proofId,
    scheme: 'vc',
    issuer: ISSUER,
    subject: overrides.subject ?? SUBJECT,
    issuedAt: '2026-06-01T00:00:00.000Z',
    expiresAt: overrides.expiresAt ?? '2026-12-31T00:00:00.000Z',
    ...(overrides.revokedAt === undefined ? {} : { revokedAt: overrides.revokedAt }),
    digest: DIGEST
  });
}

const verifyAll: CapabilityProofVerifier = () => 'verified';

/* -------------------------------------------------------------------------- */

describe('createVcBindingRegistry + registerVcBinding + getBinding', () => {
  it('starts empty with the documented version', () => {
    const reg = createVcBindingRegistry();
    expect(reg.version).toBe(VC_AUTHORITY_BINDING_VERSION);
    expect(reg.version).toBe('lfp2p.capability.vc-authority-binding.v1');
    expect(reg.bindings.size).toBe(0);
  });

  it('registers a binding and retrieves it by id', () => {
    const { registry, binding } = registerVcBinding(createVcBindingRegistry(), bindingInput());
    expect(binding.bindingId).toBe('binding:1');
    expect(binding.version).toBe(VC_AUTHORITY_BINDING_VERSION);
    expect(registry.bindings.size).toBe(1);
    expect(getBinding(registry, 'binding:1')).toEqual(binding);
  });

  it('is immutable: re-registering the same bindingId throws', () => {
    const { registry } = registerVcBinding(createVcBindingRegistry(), bindingInput());
    expect(() => registerVcBinding(registry, bindingInput())).toThrow(CapabilityError);
  });

  it('is pure: registering does not mutate the input registry', () => {
    const base = createVcBindingRegistry();
    registerVcBinding(base, bindingInput());
    expect(base.bindings.size).toBe(0);
  });

  it('produces a deep-frozen registry + binding', () => {
    const { registry, binding } = registerVcBinding(createVcBindingRegistry(), bindingInput());
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.bindings)).toBe(true);
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.isFrozen(binding.claimSubject)).toBe(true);
  });

  it('rejects malformed input (bad digest, bad timestamp, prototype pollution)', () => {
    expect(() =>
      registerVcBinding(createVcBindingRegistry(), bindingInput({ claimDigest: 'not-a-digest' }))
    ).toThrow(CapabilityError);
    expect(() =>
      registerVcBinding(createVcBindingRegistry(), bindingInput({ recordedAt: 'not-a-time' }))
    ).toThrow(CapabilityError);
    expect(() =>
      // @ts-expect-error: testing prototype-pollution guard
      registerVcBinding(createVcBindingRegistry(), {
        ...bindingInput(),
        __proto__: { polluted: true }
      })
    ).toThrow(CapabilityError);
  });

  it('rejects empty / overlong claimType', () => {
    expect(() =>
      registerVcBinding(createVcBindingRegistry(), bindingInput({ claimType: '' }))
    ).toThrow(/claimType must be a non-empty string/);
    expect(() =>
      registerVcBinding(createVcBindingRegistry(), bindingInput({ claimType: 'x'.repeat(257) }))
    ).toThrow(/exceeds 256 characters/);
  });
});

/* -------------------------------------------------------------------------- */

describe('getBindingsForCapability / getBindingsForVc', () => {
  it('returns all bindings for a capability, sorted by bindingId for determinism', () => {
    let reg = createVcBindingRegistry();
    reg = registerVcBinding(
      reg,
      bindingInput({ bindingId: 'binding:z', capabilityId: 'cap:x' })
    ).registry;
    reg = registerVcBinding(
      reg,
      bindingInput({ bindingId: 'binding:a', capabilityId: 'cap:x' })
    ).registry;
    reg = registerVcBinding(
      reg,
      bindingInput({ bindingId: 'binding:other', capabilityId: 'cap:y' })
    ).registry;
    const got = getBindingsForCapability(reg, 'cap:x');
    expect(got.map((b) => b.bindingId)).toEqual(['binding:a', 'binding:z']);
  });

  it('returns all bindings for a VC proof', () => {
    let reg = createVcBindingRegistry();
    reg = registerVcBinding(
      reg,
      bindingInput({ bindingId: 'b1', vcProofId: 'vc:1', capabilityId: 'cap:a' })
    ).registry;
    reg = registerVcBinding(
      reg,
      bindingInput({ bindingId: 'b2', vcProofId: 'vc:1', capabilityId: 'cap:b' })
    ).registry;
    reg = registerVcBinding(
      reg,
      bindingInput({ bindingId: 'b3', vcProofId: 'vc:2', capabilityId: 'cap:c' })
    ).registry;
    expect(getBindingsForVc(reg, 'vc:1').map((b) => b.capabilityId)).toEqual(['cap:a', 'cap:b']);
    expect(getBindingsForVc(reg, 'vc:2').map((b) => b.capabilityId)).toEqual(['cap:c']);
  });

  it('returns frozen arrays', () => {
    const { registry } = registerVcBinding(createVcBindingRegistry(), bindingInput());
    expect(Object.isFrozen(getBindingsForCapability(registry, 'cap:room:1'))).toBe(true);
    expect(Object.isFrozen(getBindingsForVc(registry, 'proof:vc:1'))).toBe(true);
  });

  it('returns empty for unknown capability or VC', () => {
    const reg = createVcBindingRegistry();
    expect(getBindingsForCapability(reg, 'cap:ghost')).toEqual([]);
    expect(getBindingsForVc(reg, 'vc:ghost')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('resolveVcBindings — joins binding with proof registry', () => {
  it('reports unverified when the bound proof is not in the proof registry (fail closed)', () => {
    const { registry } = registerVcBinding(createVcBindingRegistry(), bindingInput());
    const resolved = resolveVcBindings(registry, createProofRegistry(), 'cap:room:1');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.proofState).toBe('unverified');
    expect(resolved[0]?.proof).toBeUndefined();
  });

  it('mirrors the proof registry state when the VC proof exists', () => {
    const { registry: proofs } = registerVc('proof:vc:1');
    let bindings = createVcBindingRegistry();
    bindings = registerVcBinding(bindings, bindingInput()).registry;
    const resolved = resolveVcBindings(bindings, proofs, 'cap:room:1');
    expect(resolved[0]?.proofState).toBe('unverified');
    expect(resolved[0]?.proof?.proofId).toBe('proof:vc:1');
  });

  it('updates as the proof registry transitions verified → revoked', () => {
    // verified (via injected verifier)
    let proofs = registerVc('proof:vc:1').registry;
    proofs = verifyProof(proofs, 'proof:vc:1', { now: NOW, verifier: verifyAll }).registry;
    let bindings = createVcBindingRegistry();
    bindings = registerVcBinding(bindings, bindingInput()).registry;
    expect(resolveVcBindings(bindings, proofs, 'cap:room:1')[0]?.proofState).toBe('verified');

    // revoke and check again
    proofs = revokeProof(proofs, 'proof:vc:1', { revokedAt: LATER }).registry;
    expect(resolveVcBindings(bindings, proofs, 'cap:room:1')[0]?.proofState).toBe('revoked');
  });

  it('silently drops bindings that reference a non-VC proof (does NOT throw — audit must survive a single bad row)', () => {
    // Register a native proof, then bind it as if it were a VC. The
    // resolver must reject the mismatch without poisoning peer
    // bindings.
    const native = registerProof(createProofRegistry(), {
      proofId: 'proof:native:1',
      scheme: 'native-signed-event',
      issuer: ISSUER,
      subject: SUBJECT,
      issuedAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2026-12-31T00:00:00.000Z',
      digest: DIGEST
    }).registry;

    let bindings = createVcBindingRegistry();
    bindings = registerVcBinding(
      bindings,
      bindingInput({ bindingId: 'b:mismatch', vcProofId: 'proof:native:1' })
    ).registry;
    bindings = registerVcBinding(
      bindings,
      bindingInput({ bindingId: 'b:ghost', vcProofId: 'proof:vc:absent' })
    ).registry;

    const resolved = resolveVcBindings(bindings, native, 'cap:room:1');
    // mismatch is dropped; ghost survives as unverified.
    expect(resolved.map((r) => r.binding.bindingId)).toEqual(['b:ghost']);
    expect(resolved[0]?.proofState).toBe('unverified');
  });

  it('drops bindings whose VC proof subject differs from the binding claimSubject (confused-deputy defense)', () => {
    // Build a VC proof about Damon (the registered subject is
    // controller:damon — see registerVc / SUBJECT above), then file a
    // binding that points at that proof but CLAIMS it is evidence
    // about Alice. The resolver MUST drop the entry: a verified
    // credential about one party MUST NOT be reported as verified
    // evidence about another. Drop quietly so peer bindings survive.
    const proofs = registerVc('proof:vc:1').registry;
    const aliceSubject: CapabilityPartyRef = { kind: 'actor', id: 'actor:alice' };
    let bindings = createVcBindingRegistry();
    bindings = registerVcBinding(
      bindings,
      bindingInput({ bindingId: 'b:wrong-subject', claimSubject: aliceSubject })
    ).registry;
    bindings = registerVcBinding(
      bindings,
      bindingInput({ bindingId: 'b:matching-subject' /* default SUBJECT matches */ })
    ).registry;

    const resolved = resolveVcBindings(bindings, proofs, 'cap:room:1');
    expect(resolved.map((r) => r.binding.bindingId)).toEqual(['b:matching-subject']);
  });

  it('also drops a subject mismatch when only the kind differs (kind+id is the comparison)', () => {
    const proofs = registerVc('proof:vc:1').registry;
    // Same id, different kind — defense-in-depth: kind matters.
    const oddSubject: CapabilityPartyRef = { kind: 'device', id: SUBJECT.id };
    const { registry: bindings } = registerVcBinding(
      createVcBindingRegistry(),
      bindingInput({ bindingId: 'b:kind-mismatch', claimSubject: oddSubject })
    );
    expect(resolveVcBindings(bindings, proofs, 'cap:room:1')).toEqual([]);
  });

  it('drops a subject mismatch on publicKeyRef even when kind+id match (gemini security-high)', () => {
    // The VC proof is about Damon-PINNED-TO-KEY-A. The binding
    // claims Damon (no key pinned). A bearer of the binding could
    // try to use a different Damon-shaped credential (Damon-PINNED-
    // TO-KEY-B) and have the resolver pretend it's verified. The
    // confused-deputy defense MUST drop this — kind+id alone is not
    // enough when a credential pins a key.
    const proofs = registerVc('proof:vc:1', {
      subject: { ...SUBJECT, publicKeyRef: 'device-key:damon-laptop-A' }
    }).registry;
    const { registry: bindings } = registerVcBinding(
      createVcBindingRegistry(),
      // claimSubject lacks the publicKeyRef pin — mismatch
      bindingInput({ bindingId: 'b:no-key-pin' })
    );
    expect(resolveVcBindings(bindings, proofs, 'cap:room:1')).toEqual([]);
  });

  it('drops a subject mismatch on digest even when kind+id match (gemini security-high)', () => {
    const proofs = registerVc('proof:vc:1', {
      subject: { ...SUBJECT, digest: 'sha-256:aaaabbbbccccdddd' }
    }).registry;
    const { registry: bindings } = registerVcBinding(
      createVcBindingRegistry(),
      bindingInput({
        bindingId: 'b:digest-mismatch',
        claimSubject: { ...SUBJECT, digest: 'sha-256:1111222233334444' }
      })
    );
    expect(resolveVcBindings(bindings, proofs, 'cap:room:1')).toEqual([]);
  });

  it('matches when ALL four CapabilityPartyRef fields agree, including pins', () => {
    const pinned: CapabilityPartyRef = {
      ...SUBJECT,
      digest: 'sha-256:aaaabbbbccccdddd',
      publicKeyRef: 'device-key:damon-laptop-A'
    };
    const proofs = registerVc('proof:vc:1', { subject: pinned }).registry;
    const { registry: bindings } = registerVcBinding(
      createVcBindingRegistry(),
      bindingInput({ bindingId: 'b:full-match', claimSubject: pinned })
    );
    const resolved = resolveVcBindings(bindings, proofs, 'cap:room:1');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.proofState).toBe('unverified');
  });

  it('returns frozen output', () => {
    const { registry: proofs } = registerVc('proof:vc:1');
    const { registry: bindings } = registerVcBinding(createVcBindingRegistry(), bindingInput());
    const resolved = resolveVcBindings(bindings, proofs, 'cap:room:1');
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved[0])).toBe(true);
  });

  it('throws CapabilityError on a non-object / malformed proofs registry (never crashes with TypeError)', () => {
    const { registry } = registerVcBinding(createVcBindingRegistry(), bindingInput());
    // null
    expect(() =>
      // @ts-expect-error: testing runtime guard
      resolveVcBindings(registry, null, 'cap:room:1')
    ).toThrow(CapabilityError);
    // empty object — would have crashed with `TypeError: Cannot read
    // properties of undefined (reading 'get')` before the fix.
    expect(() =>
      // @ts-expect-error: testing runtime guard
      resolveVcBindings(registry, {}, 'cap:room:1')
    ).toThrow(CapabilityError);
    // object with a `proofs` field that's not a Map.
    expect(() =>
      // @ts-expect-error: testing runtime guard
      resolveVcBindings(registry, { proofs: {} }, 'cap:room:1')
    ).toThrow(CapabilityError);
  });

  it('throws CapabilityError when proofsRegistry.version is wrong (version sentinel; gemini medium)', () => {
    const { registry } = registerVcBinding(createVcBindingRegistry(), bindingInput());
    // A future proof-registry v2 with different semantics must not
    // be silently consumed here. The registry-shape guard accepts
    // only the v1 sentinel.
    expect(() =>
      resolveVcBindings(
        registry,
        // @ts-expect-error: testing runtime version-sentinel guard
        { version: 'lfp2p.capability.proof-registry.v2', proofs: new Map() },
        'cap:room:1'
      )
    ).toThrow(CapabilityError);
  });
});

/* -------------------------------------------------------------------------- */

describe('structural invariant: bindings never grant authority', () => {
  it('a VC-only authority claim is denied — registering a binding does NOT change that', () => {
    // Build a binding registry full of bindings naming Damon as VC
    // subject. The reliance gate still denies VC-only authority
    // because authority MUST come from a capability decision, never
    // from credential evidence alone.
    const { registry: bindings } = registerVcBinding(createVcBindingRegistry(), bindingInput());
    // sanity: the binding is real
    expect(bindings.bindings.size).toBe(1);

    const decision = evaluateCapabilityReliance({
      credentialEvidence: [{ credentialId: 'vc:1', issuerId: 'svc:1', claimType: 'controls-did' }],
      action: 'room.moderate',
      now: NOW
    });
    expect(decision.status).toBe('deny');
    expect(decision.reasonCodes).toEqual(['capability.vc-only-authority-denied']);
  });

  it('an allowing capability decision with a verified VC binding is allowed (binding is evidence, not the source of authority)', () => {
    const allowed: CapabilityDecision = {
      status: 'allow',
      reasonCodes: ['capability.valid'],
      capabilityId: 'cap:room:1',
      invocationId: 'invoke:room:1',
      createdAt: NOW
    };
    const decision = evaluateCapabilityReliance({
      capabilityDecision: allowed,
      proofsState: 'verified',
      action: 'room.moderate',
      now: NOW
    });
    expect(decision.status).toBe('allow');
  });
});

/* -------------------------------------------------------------------------- */

describe('validateVcAuthorityBinding standalone', () => {
  it('accepts a well-formed binding and returns it frozen', () => {
    const b = validateVcAuthorityBinding({
      version: VC_AUTHORITY_BINDING_VERSION,
      ...bindingInput()
    });
    expect(b.version).toBe(VC_AUTHORITY_BINDING_VERSION);
    expect(Object.isFrozen(b)).toBe(true);
  });

  it('rejects wrong version', () => {
    expect(() =>
      validateVcAuthorityBinding({
        ...bindingInput(),
        version: 'lfp2p.capability.vc-authority-binding.v2'
      })
    ).toThrow(/version must be lfp2p.capability.vc-authority-binding.v1/);
  });
});
