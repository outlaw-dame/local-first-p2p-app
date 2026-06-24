/**
 * Adversarial test suite for `@lfp2p/zcap-ld-verifier`.
 *
 * Strategy: mint zcap-ld delegation chains inline using tweetnacl +
 * the same `@lfp2p/crypto` JCS implementation the verifier uses, so
 * the round-trip exercises the real signing/verification path.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import {
  canonicalizeJcs,
  sha256
} from '@lfp2p/crypto';
import type { CapabilityProofRecord } from '@lfp2p/capabilities';
import { createZcapLdVerifier, DEFAULT_MAX_CHAIN_DEPTH } from './index.js';

/* -------------------------------------------------------------------------- */
/*                              did:key + base58btc                            */
/* -------------------------------------------------------------------------- */

const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);
const BASE58_BTC_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58Btc(input: Uint8Array): string {
  if (input.length === 0) return '';
  let leadingZeros = 0;
  while (leadingZeros < input.length && input[leadingZeros] === 0) leadingZeros += 1;
  const digits: number[] = [];
  for (let i = leadingZeros; i < input.length; i += 1) {
    let carry = input[i] as number;
    for (let j = 0; j < digits.length; j += 1) {
      carry += (digits[j] as number) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '';
  for (let i = 0; i < leadingZeros; i += 1) out += '1';
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    out += BASE58_BTC_ALPHABET[digits[i] as number];
  }
  return out;
}

function publicKeyToDidKey(publicKey: Uint8Array): string {
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + publicKey.length);
  prefixed.set(ED25519_MULTICODEC, 0);
  prefixed.set(publicKey, ED25519_MULTICODEC.length);
  return 'did:key:z' + encodeBase58Btc(prefixed);
}

function keypairFromSeed(seed: string): nacl.SignKeyPair {
  const bytes = new TextEncoder().encode(seed);
  if (bytes.byteLength !== 32) {
    throw new Error(`test seed must be 32 bytes; got ${bytes.byteLength} for '${seed}'`);
  }
  return nacl.sign.keyPair.fromSeed(bytes);
}

const ROOT_KP = keypairFromSeed('zcap-test-root-32-byte-seed-abcd');
const ROOT_DID = publicKeyToDidKey(ROOT_KP.publicKey);
const LEAF_KP = keypairFromSeed('zcap-test-leaf-32-byte-seed-abcd');
const LEAF_DID = publicKeyToDidKey(LEAF_KP.publicKey);
const MID_KP = keypairFromSeed('zcap-test-midkey-32-byte-seed-ab');
const MID_DID = publicKeyToDidKey(MID_KP.publicKey);
const STRANGER_KP = keypairFromSeed('zcap-test-stranger-32byte-seed-1');
const STRANGER_DID = publicKeyToDidKey(STRANGER_KP.publicKey);

const ZCAP_V1 = 'https://w3id.org/zcap/v1';
const RESOURCE = 'https://api.example.com/resource';

/* -------------------------------------------------------------------------- */
/*                            zcap-ld minter                                   */
/* -------------------------------------------------------------------------- */

type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json | undefined };

type MintZcapOptions = Readonly<{
  id?: string;
  controller: string;
  signerKp: nacl.SignKeyPair;
  signerDid?: string; // verificationMethod base; defaults to derived from signerKp
  invocationTarget?: string;
  parentCapability?: Record<string, unknown>;
  allowedAction?: string | string[];
  expires?: string;
  proofPurpose?: string;
  proofType?: string;
  cryptosuite?: string;
  context?: string | string[];
  extraFields?: Record<string, Json>;
  extraProofFields?: Record<string, Json>;
  proofValueOverride?: string;
  omitProofValue?: boolean;
}>;

function mintZcap(opts: MintZcapOptions): Record<string, unknown> {
  const id = opts.id ?? `urn:zcap:${Math.random().toString(36).slice(2, 10)}`;
  const target = opts.invocationTarget ?? RESOURCE;
  const ctx = opts.context ?? [ZCAP_V1];
  const purpose = opts.proofPurpose ?? 'capabilityDelegation';
  const proofType = opts.proofType ?? 'DataIntegrityProof';
  const cryptosuite = opts.cryptosuite ?? 'eddsa-jcs-2022';
  const signerDid = opts.signerDid ?? publicKeyToDidKey(opts.signerKp.publicKey);

  const zcap: Record<string, Json> = {
    '@context': ctx,
    id,
    controller: opts.controller,
    invocationTarget: target,
    ...(opts.parentCapability !== undefined
      ? { parentCapability: opts.parentCapability as unknown as Json }
      : {}),
    ...(opts.allowedAction !== undefined ? { allowedAction: opts.allowedAction } : {}),
    ...(opts.expires !== undefined ? { expires: opts.expires } : {}),
    ...(opts.extraFields ?? {})
  };

  const proofOptions: Record<string, Json> = {
    type: proofType,
    cryptosuite,
    created: '2026-01-01T00:00:00Z',
    verificationMethod: `${signerDid}#${signerDid.slice('did:key:'.length)}`,
    proofPurpose: purpose,
    ...(opts.extraProofFields ?? {})
  };

  const cfgHash = sha256(new TextEncoder().encode(canonicalizeJcs(proofOptions)));
  const docHash = sha256(new TextEncoder().encode(canonicalizeJcs(zcap)));
  const hashData = new Uint8Array(cfgHash.length + docHash.length);
  hashData.set(cfgHash, 0);
  hashData.set(docHash, cfgHash.length);
  const signature = nacl.sign.detached(hashData, opts.signerKp.secretKey);

  const proofValue =
    opts.proofValueOverride ?? 'z' + encodeBase58Btc(signature);
  const fullProof: Record<string, Json> =
    opts.omitProofValue === true
      ? proofOptions
      : { ...proofOptions, proofValue };

  return { ...zcap, proof: fullProof };
}

/** Standard happy-path chain: root (issuer) → leaf (subject). */
function mintHappyChain(): Record<string, unknown> {
  const root = mintZcap({
    id: 'urn:zcap:root',
    controller: ROOT_DID,
    signerKp: ROOT_KP,
    invocationTarget: RESOURCE,
    allowedAction: ['read', 'write']
  });
  return mintZcap({
    id: 'urn:zcap:leaf',
    controller: LEAF_DID,
    signerKp: ROOT_KP, // root delegates to leaf
    signerDid: ROOT_DID,
    invocationTarget: RESOURCE,
    parentCapability: root,
    allowedAction: ['read']
  });
}

function makeRecord(
  overrides: Partial<CapabilityProofRecord> = {}
): CapabilityProofRecord {
  return {
    proofId: 'zcap-1',
    scheme: 'zcap-ld',
    issuer: { id: ROOT_DID, kind: 'identity' },
    subject: { id: LEAF_DID, kind: 'identity' },
    issuedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2030-01-01T00:00:00Z',
    digest: 'sha-256:0000000000000000000000000000000000000000000000000000000000000000',
    verificationState: 'unverified',
    ...overrides
  } as CapabilityProofRecord;
}

function vfor(zcap: unknown, options: { now?: number; maxChainDepth?: number } = {}) {
  return createZcapLdVerifier({
    resolveCapability: () => zcap,
    ...(options.now !== undefined ? { now: () => options.now as number } : {}),
    ...(options.maxChainDepth !== undefined ? { maxChainDepth: options.maxChainDepth } : {})
  });
}

const FIXED_NOW = Date.parse('2026-06-01T00:00:00Z');

/* -------------------------------------------------------------------------- */
/*                                input guards                                */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: input guards', () => {
  it('throws if options is not an object', () => {
    expect(() => createZcapLdVerifier(null as never)).toThrow(TypeError);
  });
  it('throws if resolveCapability is not a function', () => {
    expect(() =>
      createZcapLdVerifier({ resolveCapability: 'oops' as never })
    ).toThrow(TypeError);
  });
  it('throws if maxChainDepth is negative or non-integer', () => {
    expect(() =>
      createZcapLdVerifier({ resolveCapability: () => undefined, maxChainDepth: -1 })
    ).toThrow(TypeError);
    expect(() =>
      createZcapLdVerifier({ resolveCapability: () => undefined, maxChainDepth: 1.5 })
    ).toThrow(TypeError);
  });
  it('throws if now is non-function', () => {
    expect(() =>
      createZcapLdVerifier({
        resolveCapability: () => undefined,
        now: 'soon' as never
      })
    ).toThrow(TypeError);
  });
  it('exposes DEFAULT_MAX_CHAIN_DEPTH', () => {
    expect(DEFAULT_MAX_CHAIN_DEPTH).toBe(16);
  });
});

/* -------------------------------------------------------------------------- */
/*                              scheme dispatch                               */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: scheme dispatch', () => {
  const v = vfor(mintHappyChain(), { now: FIXED_NOW });
  it('abstains for null/non-object record', () => {
    expect(v(null as never)).toBeUndefined();
    expect(v(42 as never)).toBeUndefined();
  });
  it.each([
    'ucan',
    'vc',
    'native-signed-event',
    'bearcap',
    'manual-local-policy'
  ] as const)('abstains for scheme === %s', (s) => {
    expect(v(makeRecord({ scheme: s as never }))).toBeUndefined();
  });
  it('owns the verdict for scheme === "zcap-ld"', () => {
    expect(v(makeRecord())).toBe('verified');
  });
});

/* -------------------------------------------------------------------------- */
/*                       structural soundness on claimed                      */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: structural soundness when scheme is "zcap-ld"', () => {
  const v = vfor(mintHappyChain(), { now: FIXED_NOW });
  it('invalid on empty proofId', () => {
    expect(v(makeRecord({ proofId: '' }))).toBe('invalid');
  });
  it('invalid on missing issuer.id', () => {
    expect(v(makeRecord({ issuer: { id: '', kind: 'identity' } as never }))).toBe('invalid');
  });
  it('invalid on missing subject.id', () => {
    expect(v(makeRecord({ subject: { id: '', kind: 'identity' } as never }))).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                          resolver fail-closed paths                        */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: resolveCapability', () => {
  it('invalid when resolver returns undefined', () => {
    const v = createZcapLdVerifier({
      resolveCapability: () => undefined,
      now: () => FIXED_NOW
    });
    expect(v(makeRecord())).toBe('invalid');
  });
  it('invalid when resolver throws', () => {
    const v = createZcapLdVerifier({
      resolveCapability: () => {
        throw new Error('boom');
      },
      now: () => FIXED_NOW
    });
    expect(v(makeRecord())).toBe('invalid');
  });
  it('invalid on circular-ref input (non-JSON-serializable)', () => {
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    const v = createZcapLdVerifier({
      resolveCapability: () => circ,
      now: () => FIXED_NOW
    });
    expect(v(makeRecord())).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                                 happy path                                 */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: happy path', () => {
  it('verifies a root→leaf chain', () => {
    expect(vfor(mintHappyChain(), { now: FIXED_NOW })(makeRecord())).toBe('verified');
  });

  it('verifies a 3-link chain root→mid→leaf', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      allowedAction: ['read', 'write']
    });
    const mid = mintZcap({
      id: 'urn:zcap:mid',
      controller: MID_DID,
      signerKp: ROOT_KP, // root delegates to mid
      signerDid: ROOT_DID,
      parentCapability: root,
      allowedAction: ['read', 'write']
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: MID_KP, // mid delegates to leaf
      signerDid: MID_DID,
      parentCapability: mid,
      allowedAction: ['read']
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('verified');
  });

  it('verifies a single-link chain (root === leaf, self-grant)', () => {
    const self = mintZcap({
      id: 'urn:zcap:self',
      controller: ROOT_DID,
      signerKp: ROOT_KP
    });
    expect(
      vfor(self, { now: FIXED_NOW })(
        makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
      )
    ).toBe('verified');
  });

  it('verifies with allowedAction as the string "*"', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      allowedAction: '*'
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root,
      allowedAction: ['delete']
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('verified');
  });

  it('verifies when child target is a slash-bounded subpath', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      invocationTarget: 'https://api.example.com/users'
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root,
      invocationTarget: 'https://api.example.com/users/123'
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('verified');
  });

  it('verifies @context as a string equal to the zcap context', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      context: ZCAP_V1
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root,
      context: ZCAP_V1
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('verified');
  });
});

/* -------------------------------------------------------------------------- */
/*                       proof type / cryptosuite dispatch                    */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: proof type / cryptosuite', () => {
  it('invalid when proof.type is Ed25519Signature2020', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      proofType: 'Ed25519Signature2020'
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });

  it('invalid when cryptosuite is eddsa-rdfc-2022', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      cryptosuite: 'eddsa-rdfc-2022'
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });

  it('invalid when proofPurpose is capabilityInvocation (not delegation)', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      proofPurpose: 'capabilityInvocation'
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });

  it('invalid when proof is missing', () => {
    const z = mintHappyChain();
    delete (z as Record<string, unknown>).proof;
    expect(vfor(z, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when proof is multi-entry array', () => {
    const z = mintHappyChain();
    const p = (z as Record<string, unknown>).proof;
    (z as Record<string, unknown>).proof = [p, p];
    expect(vfor(z, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when proofValue is missing', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      omitProofValue: true
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                                 @context                                   */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: @context', () => {
  it('invalid when @context does not include the zcap v1 context', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      context: ['https://www.w3.org/ns/credentials/v2'] // wrong context
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });
  it('invalid when @context is absent', () => {
    const z = mintHappyChain();
    delete (z as Record<string, unknown>)['@context'];
    expect(vfor(z, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                         identity & controller pins                         */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: leaf + root controller pins', () => {
  it('invalid when leaf.controller != record.subject.id', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: STRANGER_DID, // not LEAF_DID
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when root.controller != record.issuer.id', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: STRANGER_DID, // wrong root authority
      signerKp: STRANGER_KP
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: STRANGER_KP,
      signerDid: STRANGER_DID,
      parentCapability: root
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when root is NOT self-signed (VM base != root.controller)', () => {
    // Mint a root that claims controller = ROOT_DID but was signed
    // by STRANGER. The verifier checks vmBase === root.controller
    // for the root, so this fails.
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: STRANGER_KP,
      signerDid: STRANGER_DID
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                          delegation link integrity                         */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: delegation link integrity', () => {
  it('invalid when child VM base != parent.controller (wrong delegator)', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP
    });
    // Child claims root delegated to it but was actually signed by
    // STRANGER (who is not root.controller).
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: STRANGER_KP,
      signerDid: STRANGER_DID,
      parentCapability: root
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when child.invocationTarget escapes parent prefix', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      invocationTarget: 'https://api.example.com/users'
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root,
      invocationTarget: 'https://api.example.com/admin' // escapes
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when child target is a non-slash-bounded prefix extension', () => {
    // parent: /users; child: /usersbar — looks like prefix but isn't
    // (slash-bounded check rejects).
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      invocationTarget: 'https://api.example.com/users'
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root,
      invocationTarget: 'https://api.example.com/usersbar'
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when child.allowedAction expands beyond parent', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      allowedAction: ['read']
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root,
      allowedAction: ['read', 'write'] // expansion
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when child claims "*" but parent only has ["read"]', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      allowedAction: ['read']
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root,
      allowedAction: ['*']
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when child.expires is after parent.expires', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      expires: '2027-01-01T00:00:00Z'
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root,
      expires: '2028-01-01T00:00:00Z'
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when any expires field is in the past', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      expires: '2025-01-01T00:00:00Z' // past
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when expires === now (boundary is fail-closed)', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      expires: '2026-06-01T00:00:00Z'
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                          parentCapability shape                            */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: parentCapability shape', () => {
  it('invalid when parentCapability is a string ID (not inlined)', () => {
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      // Cast: we deliberately want string here
      parentCapability: 'urn:zcap:root' as unknown as Record<string, unknown>
    });
    expect(vfor(leaf, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when chain depth exceeds the configured bound', () => {
    // Build a 3-link chain but set maxChainDepth = 1.
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP
    });
    const mid = mintZcap({
      id: 'urn:zcap:mid',
      controller: MID_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: MID_KP,
      signerDid: MID_DID,
      parentCapability: mid
    });
    expect(vfor(leaf, { now: FIXED_NOW, maxChainDepth: 1 })(makeRecord())).toBe('invalid');
  });

  it('verifies when chain depth equals the configured bound exactly', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP
    });
    const leaf = mintZcap({
      id: 'urn:zcap:leaf',
      controller: LEAF_DID,
      signerKp: ROOT_KP,
      signerDid: ROOT_DID,
      parentCapability: root
    });
    expect(vfor(leaf, { now: FIXED_NOW, maxChainDepth: 1 })(makeRecord())).toBe('verified');
  });
});

/* -------------------------------------------------------------------------- */
/*                            signature integrity                             */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: signature integrity', () => {
  it('invalid when the leaf zcap document is tampered after signing', () => {
    const z = mintHappyChain();
    (z as Record<string, unknown>).id = 'urn:zcap:tampered';
    expect(vfor(z, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when a leaf proof option is tampered after signing', () => {
    const z = mintHappyChain();
    const p = (z as Record<string, unknown>).proof as Record<string, unknown>;
    p.created = '2099-01-01T00:00:00Z';
    expect(vfor(z, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when the parent zcap is tampered after signing', () => {
    const z = mintHappyChain();
    const parent = (z as Record<string, unknown>).parentCapability as Record<string, unknown>;
    parent.invocationTarget = 'https://api.example.com/something-else';
    expect(vfor(z, { now: FIXED_NOW })(makeRecord())).toBe('invalid');
  });

  it('invalid when proofValue is not multibase-z', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      proofValueOverride: 'uAAAAAA'
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });

  it('invalid when decoded signature is wrong length', () => {
    const short = new Uint8Array(32);
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      proofValueOverride: 'z' + encodeBase58Btc(short)
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                       did:key + verificationMethod                         */
/* -------------------------------------------------------------------------- */

describe('createZcapLdVerifier: did:key verificationMethod', () => {
  it('invalid when verificationMethod is did:web', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      signerDid: 'did:web:example.com'
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });

  it('invalid when controller is empty', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: '',
      signerKp: ROOT_KP
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: '', kind: 'identity' } as never })
    )).toBe('invalid');
  });

  it('invalid when invocationTarget is empty', () => {
    const root = mintZcap({
      id: 'urn:zcap:root',
      controller: ROOT_DID,
      signerKp: ROOT_KP,
      invocationTarget: ''
    });
    expect(vfor(root, { now: FIXED_NOW })(
      makeRecord({ subject: { id: ROOT_DID, kind: 'identity' } as never })
    )).toBe('invalid');
  });
});
