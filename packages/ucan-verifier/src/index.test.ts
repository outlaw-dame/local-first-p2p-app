/**
 * Adversarial tests for `@lfp2p/ucan-verifier`.
 *
 * Tokens are minted inline (deterministic seeds → did:key) so each
 * test can mutate one field at a time and pin a specific
 * fail-closed path. No external fixture files.
 *
 * Headline guarantees pinned:
 *
 *   1. Scheme dispatch — every non-UCAN scheme abstains (undefined).
 *   2. Once UCAN is the claimed scheme, every failure path
 *      surfaces as 'invalid' (never abstain). The verifier can
 *      never silently downgrade a present-but-broken UCAN proof to
 *      'unverified'.
 *   3. Honest signature gate — Ed25519 alg only; signature
 *      mismatch / tampered token → invalid.
 *   4. did:key resolution honest — non-did:key issuer, non-Ed25519
 *      multicodec, wrong key bytes → invalid.
 *   5. Time gates — nbf / exp enforced against the injected clock.
 *   6. Chain validation — child.iss=parent.aud linkage, expiry
 *      monotonic (child.exp ≤ parent.exp), attenuation (child.att ⊆
 *      parent.att), depth bound.
 */
import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import type { CapabilityProofRecord } from '@lfp2p/capabilities';
import {
  DEFAULT_MAX_CHAIN_DEPTH,
  createUcanVerifier
} from './index.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encodeBase58Btc(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  // Big-endian base conversion to base58.
  const digits: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    let carry = bytes[i] as number;
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
    out += BASE58_ALPHABET[digits[i] as number] as string;
  }
  return out;
}

function makeDidKey(publicKey: Uint8Array): string {
  // Multicodec Ed25519 prefix 0xed 0x01.
  const prefixed = new Uint8Array(2 + 32);
  prefixed[0] = 0xed;
  prefixed[1] = 0x01;
  prefixed.set(publicKey, 2);
  return `did:key:z${encodeBase58Btc(prefixed)}`;
}

function keypairFromSeed(seed: number): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  did: string;
} {
  const seedBytes = new Uint8Array(32).fill(seed);
  const kp = nacl.sign.keyPair.fromSeed(seedBytes);
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    did: makeDidKey(kp.publicKey)
  };
}

type UcanCapability = { with: string; can: string };
type UcanBody = {
  iss: string;
  aud: string;
  att: UcanCapability[];
  prf: string[];
  nbf?: number;
  exp?: number;
};

function mintUcan(secretKey: Uint8Array, body: UcanBody): string {
  const header = { alg: 'EdDSA', typ: 'JWT', ucv: '0.9.0' };
  const headerB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = nacl.sign.detached(new TextEncoder().encode(signingInput), secretKey);
  return `${signingInput}.${toBase64Url(signature)}`;
}

function makeRecord(
  overrides: Partial<CapabilityProofRecord> = {}
): CapabilityProofRecord {
  return {
    proofId: 'proof:ucan:1',
    scheme: 'ucan',
    issuer: { kind: 'actor', id: 'placeholder-did' },
    subject: { kind: 'actor', id: 'identity:bob' },
    issuedAt: '2026-06-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    digest: 'sha-256:placeholder-not-checked-by-verifier',
    verificationState: 'unverified',
    ...overrides
  };
}

const NOW_MS = Date.UTC(2026, 5, 10, 0, 0, 0); // 2026-06-10
const NOW_SEC = Math.floor(NOW_MS / 1000);

const root = keypairFromSeed(7);
const audience = keypairFromSeed(11);
const stranger = keypairFromSeed(13);

/* -------------------------------------------------------------------------- */

describe('createUcanVerifier — input guards', () => {
  it('throws on missing/non-object options', () => {
    // @ts-expect-error: testing runtime guard
    expect(() => createUcanVerifier(null)).toThrow(TypeError);
    // @ts-expect-error: testing runtime guard
    expect(() => createUcanVerifier()).toThrow(TypeError);
  });

  it('throws on non-function resolveUcanToken', () => {
    expect(() =>
      // @ts-expect-error: testing runtime guard
      createUcanVerifier({ resolveUcanToken: 'nope' })
    ).toThrow(TypeError);
  });

  it('throws on non-integer or negative maxChainDepth', () => {
    expect(() =>
      createUcanVerifier({ resolveUcanToken: () => undefined, maxChainDepth: 1.5 })
    ).toThrow(TypeError);
    expect(() =>
      createUcanVerifier({ resolveUcanToken: () => undefined, maxChainDepth: -1 })
    ).toThrow(TypeError);
  });

  it('throws on non-function now', () => {
    expect(() =>
      // @ts-expect-error: testing runtime guard
      createUcanVerifier({ resolveUcanToken: () => undefined, now: 'nope' })
    ).toThrow(TypeError);
  });
});

describe('scheme dispatch (abstain on non-ucan)', () => {
  const verifier = createUcanVerifier({ resolveUcanToken: () => undefined });

  for (const scheme of [
    'native-signed-event',
    'identity-control-log',
    'vc',
    'zcap-ld',
    'bearcap',
    'manual-local-policy'
  ] as const) {
    it(`abstains for ${scheme}`, () => {
      expect(verifier(makeRecord({ scheme }))).toBeUndefined();
    });
  }

  it('abstains on a malformed (non-object) record', () => {
    // @ts-expect-error: testing runtime guard
    expect(verifier(null)).toBeUndefined();
    // @ts-expect-error: testing runtime guard
    expect(verifier('nope')).toBeUndefined();
  });
});

describe('structural soundness — once scheme === ucan, malformed record is invalid (not abstain)', () => {
  const verifier = createUcanVerifier({ resolveUcanToken: () => undefined });

  it('missing proofId → invalid', () => {
    // @ts-expect-error: testing runtime guard
    expect(verifier(makeRecord({ proofId: undefined }))).toBe('invalid');
  });

  it('empty proofId → invalid', () => {
    expect(verifier(makeRecord({ proofId: '' }))).toBe('invalid');
  });

  it('non-object issuer → invalid', () => {
    // @ts-expect-error: testing runtime guard
    expect(verifier(makeRecord({ issuer: null }))).toBe('invalid');
  });

  it('empty issuer.id → invalid', () => {
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: '' } }))).toBe('invalid');
  });
});

describe('token resolution', () => {
  it('returns invalid when resolver returns undefined (scheme is claimed, no token to verify)', () => {
    const verifier = createUcanVerifier({ resolveUcanToken: () => undefined });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });

  it('returns invalid when resolver throws (DoS-resistant)', () => {
    const verifier = createUcanVerifier({
      resolveUcanToken: () => {
        throw new Error('storage broke');
      }
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });

  it('returns invalid when resolver returns an empty string', () => {
    const verifier = createUcanVerifier({ resolveUcanToken: () => '' });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });
});

describe('happy-path single-token verification', () => {
  it('returns verified for an honest Ed25519-signed UCAN that matches the record issuer', () => {
    const token = mintUcan(root.secretKey, {
      iss: root.did,
      aud: audience.did,
      att: [{ with: 'community:alpha', can: 'community.member.remove' }],
      prf: [],
      exp: NOW_SEC + 3600
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'verified'
    );
  });
});

describe('JWT structural rejection', () => {
  const verifier = (token: string | undefined) =>
    createUcanVerifier({ resolveUcanToken: () => token, now: () => NOW_MS });

  it('returns invalid on a token that is not three dot-separated segments', () => {
    expect(
      verifier('only.two')(makeRecord({ issuer: { kind: 'actor', id: root.did } }))
    ).toBe('invalid');
  });

  it('returns invalid when the header is not base64url JSON', () => {
    expect(
      verifier('not_base64!.abc.def')(
        makeRecord({ issuer: { kind: 'actor', id: root.did } })
      )
    ).toBe('invalid');
  });

  it('returns invalid for a non-EdDSA algorithm (RS256 etc.)', () => {
    const header = { alg: 'RS256', typ: 'JWT' };
    const body = { iss: root.did, aud: audience.did, att: [], prf: [] };
    const headerB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(body)));
    const sig = nacl.sign.detached(
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
      root.secretKey
    );
    const token = `${headerB64}.${payloadB64}.${toBase64Url(sig)}`;
    expect(verifier(token)(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });
});

describe('signature verification', () => {
  it('returns invalid when the signature was produced by a different key (forged token)', () => {
    const headerB64 = toBase64Url(
      new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }))
    );
    const payloadB64 = toBase64Url(
      new TextEncoder().encode(
        JSON.stringify({ iss: root.did, aud: audience.did, att: [], prf: [] })
      )
    );
    const sig = nacl.sign.detached(
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
      stranger.secretKey // signed with the wrong key
    );
    const token = `${headerB64}.${payloadB64}.${toBase64Url(sig)}`;
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });

  it('returns invalid when the signing input has been tampered with (payload swap after signing)', () => {
    const goodToken = mintUcan(root.secretKey, {
      iss: root.did,
      aud: audience.did,
      att: [],
      prf: []
    });
    const parts = goodToken.split('.');
    const tampered = `${parts[0]}.${toBase64Url(
      new TextEncoder().encode(
        JSON.stringify({ iss: root.did, aud: audience.did, att: [{ with: 'x', can: 'y' }], prf: [] })
      )
    )}.${parts[2]}`;
    const verifier = createUcanVerifier({
      resolveUcanToken: () => tampered,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });
});

describe('did:key + issuer-match', () => {
  it('returns invalid when payload.iss is not a did:key', () => {
    const token = mintUcan(root.secretKey, {
      iss: 'did:web:example.com',
      aud: audience.did,
      att: [],
      prf: []
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(
      verifier(makeRecord({ issuer: { kind: 'actor', id: 'did:web:example.com' } }))
    ).toBe('invalid');
  });

  it('returns invalid when payload.iss is a did:key with the WRONG public key (signature won\'t verify)', () => {
    // Sign with root, but claim iss = stranger.did. Signature is over
    // signing input that includes the false iss claim, so the
    // signature DOES verify against root.secretKey — but the
    // verifier resolves iss → stranger's public key, which won't
    // verify the signature.
    const token = mintUcan(root.secretKey, {
      iss: stranger.did,
      aud: audience.did,
      att: [],
      prf: []
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(
      verifier(makeRecord({ issuer: { kind: 'actor', id: stranger.did } }))
    ).toBe('invalid');
  });

  it('returns invalid when record.issuer.id !== token.iss (exact-issuer pin)', () => {
    const token = mintUcan(root.secretKey, {
      iss: root.did,
      aud: audience.did,
      att: [],
      prf: []
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: stranger.did } }))).toBe(
      'invalid'
    );
  });
});

describe('time bounds', () => {
  it('returns invalid when nbf is in the future', () => {
    const token = mintUcan(root.secretKey, {
      iss: root.did,
      aud: audience.did,
      att: [],
      prf: [],
      nbf: NOW_SEC + 3600
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });

  it('returns invalid when exp is in the past', () => {
    const token = mintUcan(root.secretKey, {
      iss: root.did,
      aud: audience.did,
      att: [],
      prf: [],
      exp: NOW_SEC - 1
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });

  it('returns invalid at exp boundary (now == exp is expired — fail closed)', () => {
    const token = mintUcan(root.secretKey, {
      iss: root.did,
      aud: audience.did,
      att: [],
      prf: [],
      exp: NOW_SEC
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });

  it('default clock is Date.now() — picks up real wall time', () => {
    // Mint a token that expires far in the past — the default clock
    // should reject it.
    const token = mintUcan(root.secretKey, {
      iss: root.did,
      aud: audience.did,
      att: [],
      prf: [],
      exp: 1_000_000 // year 1970
    });
    const verifier = createUcanVerifier({ resolveUcanToken: () => token });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: root.did } }))).toBe(
      'invalid'
    );
  });
});

describe('chain verification — delegation linkage + attenuation + expiry', () => {
  const buildChain = (overrides: {
    childAtt?: UcanCapability[];
    parentAtt?: UcanCapability[];
    childExp?: number;
    parentExp?: number;
    childAud?: string;
    parentIss?: string;
  } = {}) => {
    const parentToken = mintUcan(root.secretKey, {
      iss: overrides.parentIss ?? root.did,
      aud: audience.did,
      att: overrides.parentAtt ?? [{ with: 'community:alpha', can: 'community.member.remove' }],
      prf: [],
      exp: overrides.parentExp ?? NOW_SEC + 7200
    });
    const childToken = mintUcan(audience.secretKey, {
      iss: audience.did,
      aud: overrides.childAud ?? stranger.did,
      att: overrides.childAtt ?? [
        { with: 'community:alpha', can: 'community.member.remove' }
      ],
      prf: [parentToken],
      exp: overrides.childExp ?? NOW_SEC + 3600
    });
    return childToken;
  };

  it('verifies a 2-link chain where child.att ⊆ parent.att and child.exp ≤ parent.exp', () => {
    const token = buildChain();
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(
      verifier(makeRecord({ issuer: { kind: 'actor', id: audience.did } }))
    ).toBe('verified');
  });

  it('rejects when child.iss !== parent.aud (delegation linkage broken)', () => {
    const token = buildChain({ parentIss: stranger.did });
    // parent.iss = stranger, parent.aud = audience (the mint default).
    // But we tampered parent.iss to stranger; parent.aud is still
    // audience. The child's iss = audience, which DOES match
    // parent.aud — so this test as written wouldn't fail. Mint a
    // version that breaks the linkage explicitly:
    const parentToken = mintUcan(root.secretKey, {
      iss: root.did,
      aud: 'did:key:zSomeOtherAudience', // child.iss won't match
      att: [{ with: 'community:alpha', can: 'community.member.remove' }],
      prf: [],
      exp: NOW_SEC + 7200
    });
    const childToken = mintUcan(audience.secretKey, {
      iss: audience.did, // != parent.aud
      aud: stranger.did,
      att: [{ with: 'community:alpha', can: 'community.member.remove' }],
      prf: [parentToken],
      exp: NOW_SEC + 3600
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => childToken,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: audience.did } }))).toBe(
      'invalid'
    );
    void token; // silence unused
  });

  it('rejects when child.exp > parent.exp (expiry expansion)', () => {
    const token = buildChain({
      childExp: NOW_SEC + 10_000,
      parentExp: NOW_SEC + 5_000
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: audience.did } }))).toBe(
      'invalid'
    );
  });

  it('rejects when child.att claims a capability not in parent.att (attenuation violated)', () => {
    const token = buildChain({
      parentAtt: [{ with: 'community:alpha', can: 'community.member.remove' }],
      childAtt: [{ with: 'community:alpha', can: 'community.member.remove' }, { with: 'community:alpha', can: 'community.role.assign' }]
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => token,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: audience.did } }))).toBe(
      'invalid'
    );
  });

  it('rejects when a prf chain element fails to verify (every link must verify, no silent skips)', () => {
    // Build a chain where the parent token is corrupt (signed by
    // stranger, but claims root.did as iss → signature mismatch).
    const headerB64 = toBase64Url(
      new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }))
    );
    const parentPayloadB64 = toBase64Url(
      new TextEncoder().encode(
        JSON.stringify({
          iss: root.did, // claims root
          aud: audience.did,
          att: [{ with: 'community:alpha', can: 'community.member.remove' }],
          prf: []
        })
      )
    );
    const badSig = nacl.sign.detached(
      new TextEncoder().encode(`${headerB64}.${parentPayloadB64}`),
      stranger.secretKey // wrong key
    );
    const corruptParent = `${headerB64}.${parentPayloadB64}.${toBase64Url(badSig)}`;

    const childToken = mintUcan(audience.secretKey, {
      iss: audience.did,
      aud: stranger.did,
      att: [{ with: 'community:alpha', can: 'community.member.remove' }],
      prf: [corruptParent]
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => childToken,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: audience.did } }))).toBe(
      'invalid'
    );
  });

  it('rejects a chain that exceeds maxChainDepth (default depth bound)', () => {
    // Construct a chain longer than the (overridden) max depth of 1.
    const grandparentToken = mintUcan(root.secretKey, {
      iss: root.did,
      aud: audience.did,
      att: [{ with: 'community:alpha', can: 'community.member.remove' }],
      prf: [],
      exp: NOW_SEC + 7200
    });
    const parentToken = mintUcan(audience.secretKey, {
      iss: audience.did,
      aud: stranger.did,
      att: [{ with: 'community:alpha', can: 'community.member.remove' }],
      prf: [grandparentToken],
      exp: NOW_SEC + 7200
    });
    const childToken = mintUcan(stranger.secretKey, {
      iss: stranger.did,
      aud: root.did,
      att: [{ with: 'community:alpha', can: 'community.member.remove' }],
      prf: [parentToken],
      exp: NOW_SEC + 3600
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => childToken,
      now: () => NOW_MS,
      maxChainDepth: 1
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: stranger.did } }))).toBe(
      'invalid'
    );
  });

  it('default max chain depth is the documented constant', () => {
    expect(DEFAULT_MAX_CHAIN_DEPTH).toBe(16);
  });

  it('rejects a prf entry that is not a parseable JWT (no silent skip)', () => {
    const childToken = mintUcan(audience.secretKey, {
      iss: audience.did,
      aud: stranger.did,
      att: [{ with: 'x', can: 'y' }],
      prf: ['this-is-not-a-jwt']
    });
    const verifier = createUcanVerifier({
      resolveUcanToken: () => childToken,
      now: () => NOW_MS
    });
    expect(verifier(makeRecord({ issuer: { kind: 'actor', id: audience.did } }))).toBe(
      'invalid'
    );
  });
});
