/**
 * Adversarial test suite for `@lfp2p/bearcap-verifier`.
 *
 * Coverage:
 *   - Input guards / abstain dispatch
 *   - Structural soundness once scheme is claimed
 *   - Digest format gating (sha-256 only in v1)
 *   - Happy path: bytes match registry digest → possession-confirmed
 *   - Digest mismatch (substituted token, single-bit flip)
 *   - Resolver fail-closed paths
 *   - Defense-in-depth on bytes shape
 *   - Constant-time comparison sanity
 */
import { describe, it, expect } from 'vitest';
import { sha256, toBase64Url } from '@lfp2p/crypto';
import type { CapabilityProofRecord } from '@lfp2p/capabilities';
import { createBearcapVerifier } from './index.js';

function digestOf(bytes: Uint8Array): string {
  return 'sha-256:' + toBase64Url(sha256(bytes));
}

const HAPPY_BYTES = new TextEncoder().encode('bearer-token-content-that-exceeds-eight-chars');
const HAPPY_DIGEST = digestOf(HAPPY_BYTES);

function makeRecord(overrides: Partial<CapabilityProofRecord> = {}): CapabilityProofRecord {
  return {
    proofId: 'bearcap-1',
    scheme: 'bearcap',
    issuer: { id: 'did:example:issuer', kind: 'identity' },
    subject: { id: 'did:example:holder', kind: 'identity' },
    issuedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2030-01-01T00:00:00Z',
    digest: HAPPY_DIGEST,
    verificationState: 'unverified',
    ...overrides
  } as CapabilityProofRecord;
}

function vfor(bytes: Uint8Array | undefined | (() => Uint8Array | undefined)) {
  const resolver = typeof bytes === 'function' ? bytes : () => bytes;
  return createBearcapVerifier({ resolveBearcap: resolver });
}

/* -------------------------------------------------------------------------- */
/*                                input guards                                */
/* -------------------------------------------------------------------------- */

describe('createBearcapVerifier: input guards', () => {
  it('throws if options is not an object', () => {
    expect(() => createBearcapVerifier(null as never)).toThrow(TypeError);
  });
  it('throws if resolveBearcap is not a function', () => {
    expect(() => createBearcapVerifier({ resolveBearcap: 'oops' as never })).toThrow(TypeError);
  });
});

/* -------------------------------------------------------------------------- */
/*                              scheme dispatch                               */
/* -------------------------------------------------------------------------- */

describe('createBearcapVerifier: scheme dispatch', () => {
  const v = vfor(HAPPY_BYTES);

  it('abstains for null / non-object record', () => {
    expect(v(null as never)).toBeUndefined();
    expect(v(42 as never)).toBeUndefined();
  });

  it.each(['ucan', 'vc', 'zcap-ld', 'native-signed-event', 'manual-local-policy'] as const)(
    'abstains for scheme === %s',
    (s) => {
      expect(v(makeRecord({ scheme: s as never }))).toBeUndefined();
    }
  );

  it('owns the verdict for scheme === "bearcap"', () => {
    expect(v(makeRecord())).toBe('possession-confirmed');
  });
});

/* -------------------------------------------------------------------------- */
/*                  structural soundness once scheme claimed                  */
/* -------------------------------------------------------------------------- */

describe('createBearcapVerifier: structural soundness when scheme is bearcap', () => {
  const v = vfor(HAPPY_BYTES);

  it('invalid on empty proofId', () => {
    expect(v(makeRecord({ proofId: '' }))).toBe('invalid');
  });

  it('invalid on missing/empty digest', () => {
    expect(v(makeRecord({ digest: '' as never }))).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                            digest format gating                            */
/* -------------------------------------------------------------------------- */

describe('createBearcapVerifier: digest format gating', () => {
  it('invalid when digest uses sha-512 prefix (out of v1 scope)', () => {
    const digest = 'sha-512:' + toBase64Url(new Uint8Array(64).fill(0x42));
    expect(vfor(HAPPY_BYTES)(makeRecord({ digest }))).toBe('invalid');
  });

  it('invalid when digest uses blake3 prefix (out of v1 scope)', () => {
    const digest = 'blake3:' + toBase64Url(new Uint8Array(32).fill(0x42));
    expect(vfor(HAPPY_BYTES)(makeRecord({ digest }))).toBe('invalid');
  });

  it('invalid when digest has the sha-256 prefix but empty payload', () => {
    // The registry's assertDigest would have rejected this at
    // registration, but we still fail-closed here as defense-in-
    // depth against a record that bypassed validation (e.g.,
    // serialized from a future schema version).
    expect(vfor(HAPPY_BYTES)(makeRecord({ digest: 'sha-256:' as never }))).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                                happy path                                  */
/* -------------------------------------------------------------------------- */

describe('createBearcapVerifier: happy path', () => {
  it('returns "possession-confirmed" when bytes match record.digest', () => {
    expect(vfor(HAPPY_BYTES)(makeRecord())).toBe('possession-confirmed');
  });

  it('NEVER returns "verified" — bearcap cannot establish authority by design', () => {
    const verdict = vfor(HAPPY_BYTES)(makeRecord());
    expect(verdict).not.toBe('verified');
  });

  it('possession-confirmed for a different but matching byte sequence', () => {
    const other = new TextEncoder().encode('different-token-but-also-long-1234');
    expect(vfor(other)(makeRecord({ digest: digestOf(other) }))).toBe('possession-confirmed');
  });
});

/* -------------------------------------------------------------------------- */
/*                              digest mismatch                               */
/* -------------------------------------------------------------------------- */

describe('createBearcapVerifier: digest mismatch', () => {
  it('invalid when bytes hash to a different digest', () => {
    const wrong = new TextEncoder().encode('completely-different-token-bytes-x');
    expect(vfor(wrong)(makeRecord())).toBe('invalid');
  });

  it('invalid when single-bit flip in resolved bytes', () => {
    const flipped = new Uint8Array(HAPPY_BYTES);
    flipped[0] = (flipped[0] as number) ^ 0x01;
    expect(vfor(flipped)(makeRecord())).toBe('invalid');
  });

  it('invalid when digest is base64url of correct hash but wrong length', () => {
    // Truncate one character — common attacker fuzz pattern.
    const truncated = HAPPY_DIGEST.slice(0, HAPPY_DIGEST.length - 1);
    expect(vfor(HAPPY_BYTES)(makeRecord({ digest: truncated }))).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                         resolver fail-closed paths                         */
/* -------------------------------------------------------------------------- */

describe('createBearcapVerifier: resolveBearcap', () => {
  it('invalid when resolver returns undefined', () => {
    expect(vfor(undefined)(makeRecord())).toBe('invalid');
  });

  it('invalid when resolver throws', () => {
    expect(
      vfor(() => {
        throw new Error('boom');
      })(makeRecord())
    ).toBe('invalid');
  });

  it('invalid when resolver returns an empty Uint8Array', () => {
    expect(vfor(new Uint8Array(0))(makeRecord())).toBe('invalid');
  });

  it('invalid when resolver returns a non-Uint8Array (TS cast escape)', () => {
    // A caller could cast a string or ArrayBuffer past the resolver
    // type. The verifier must not pass that to sha256() — fail
    // closed instead.
    const v = createBearcapVerifier({
      resolveBearcap: (() => 'not-bytes') as never
    });
    expect(v(makeRecord())).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                    constant-time comparison sanity                         */
/* -------------------------------------------------------------------------- */

describe('createBearcapVerifier: constant-time digest compare', () => {
  it('does not short-circuit on first-byte mismatch (both branches return invalid)', () => {
    // Two different "wrong" candidates: one matches the leading
    // chars of HAPPY_DIGEST, one differs from the first char.
    // A timing-leak implementation would behave differently. We
    // can't observe time directly in unit tests, but we CAN
    // confirm both produce the same verdict so the code path
    // isn't accidentally branching early.
    const a = HAPPY_DIGEST.slice(0, -1) + 'A';
    const b = 'A' + HAPPY_DIGEST.slice(1);
    expect(vfor(HAPPY_BYTES)(makeRecord({ digest: a }))).toBe('invalid');
    expect(vfor(HAPPY_BYTES)(makeRecord({ digest: b }))).toBe('invalid');
  });
});
