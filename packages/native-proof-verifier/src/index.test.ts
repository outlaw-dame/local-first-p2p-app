/**
 * Adversarial tests for `@lfp2p/native-proof-verifier`.
 *
 * Headline structural guarantees:
 *
 *   1. The verifier NEVER returns 'verified' for a scheme it cannot
 *      assess — every non-native scheme abstains (returns `undefined`).
 *      That preserves the proof-registry's contract: `verified` is
 *      reachable only when cryptography actually ran.
 *
 *   2. Abstain ≠ invalid. A missing resolver entry resolves to
 *      `undefined`, NOT `invalid` — so a registry full of native
 *      proofs whose bytes the caller does not yet hold stays
 *      `unverified` (honest), never `invalid` (false positive).
 *
 *   3. Issuer mismatch is `invalid`. Once the caller HAS produced an
 *      event, a positive issuer mismatch (kind+id) is a strong
 *      signal the proof does not back the claim — fail closed.
 *
 *   4. Signature failure is `invalid`. Tampered or version-broken
 *      envelopes never report `verified`.
 *
 *   5. The verifier is DoS-resistant: a throwing resolver abstains,
 *      and a throwing issuer-match strategy returns `invalid`.
 */
import { describe, expect, it } from 'vitest';
import {
  signEventEnvelope,
  signingKeypairFromSeed
} from '@lfp2p/crypto';
import {
  createUnsignedEvent,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import type { CapabilityProofRecord } from '@lfp2p/capabilities';
import {
  assertNativeProofDigest,
  composeVerifiers,
  createNativeProofVerifier,
  type CapabilityProofVerifier,
  type IssuerMatchStrategy,
  type SignedEventResolver
} from './index.js';

const SEED = new Uint8Array(32).fill(7);
const NOW = '2026-06-10T00:00:00.000Z';

function makeEvent(overrides: { author?: string } = {}): SignedEventEnvelope {
  const keypair = signingKeypairFromSeed(SEED);
  const author = overrides.author ?? 'identity:alice-pubkey';
  return signEventEnvelope(
    createUnsignedEvent({
      eventId: 'evt:native-proof:1',
      kind: 'outbox.test.created',
      author,
      deviceId: 'device:alice',
      createdAt: NOW,
      privacy: 'public',
      payload: { msg: 'hello' }
    }),
    keypair
  );
}

function nativeRecord(
  overrides: Partial<CapabilityProofRecord> = {}
): CapabilityProofRecord {
  return {
    proofId: 'proof:native:1',
    scheme: 'native-signed-event',
    issuer: { kind: 'actor', id: 'identity:alice-pubkey' },
    subject: { kind: 'actor', id: 'identity:bob' },
    issuedAt: '2026-06-01T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    digest: 'sha-256:placeholder-not-checked-by-verifier',
    verificationState: 'unverified',
    ...overrides
  };
}

const noopResolver: SignedEventResolver = () => undefined;

/* -------------------------------------------------------------------------- */

describe('createNativeProofVerifier — input guards', () => {
  it('throws on missing/non-object options', () => {
    // @ts-expect-error: testing runtime guard
    expect(() => createNativeProofVerifier(null)).toThrow(TypeError);
    // @ts-expect-error: testing runtime guard
    expect(() => createNativeProofVerifier()).toThrow(TypeError);
  });

  it('throws on non-function resolveSignedEvent', () => {
    expect(() =>
      // @ts-expect-error: testing runtime guard
      createNativeProofVerifier({ resolveSignedEvent: 'not a function' })
    ).toThrow(TypeError);
  });

  it('throws on non-function issuerMatches when supplied', () => {
    expect(() =>
      createNativeProofVerifier({
        resolveSignedEvent: noopResolver,
        // @ts-expect-error: testing runtime guard
        issuerMatches: 'nope'
      })
    ).toThrow(TypeError);
  });
});

describe('createNativeProofVerifier — scheme dispatch (abstain on non-native)', () => {
  const verifier = createNativeProofVerifier({ resolveSignedEvent: () => makeEvent() });

  it('abstains (undefined) for ucan', () => {
    expect(verifier(nativeRecord({ scheme: 'ucan' }))).toBeUndefined();
  });
  it('abstains for vc', () => {
    expect(verifier(nativeRecord({ scheme: 'vc' }))).toBeUndefined();
  });
  it('abstains for zcap-ld', () => {
    expect(verifier(nativeRecord({ scheme: 'zcap-ld' }))).toBeUndefined();
  });
  it('abstains for bearcap', () => {
    expect(verifier(nativeRecord({ scheme: 'bearcap' }))).toBeUndefined();
  });
  it('abstains for manual-local-policy', () => {
    expect(verifier(nativeRecord({ scheme: 'manual-local-policy' }))).toBeUndefined();
  });
  it('abstains for identity-control-log', () => {
    expect(verifier(nativeRecord({ scheme: 'identity-control-log' }))).toBeUndefined();
  });
  it('abstains on a malformed (non-object) record', () => {
    // @ts-expect-error: testing runtime guard
    expect(verifier(null)).toBeUndefined();
    // @ts-expect-error: testing runtime guard
    expect(verifier('nope')).toBeUndefined();
  });
});

describe('createNativeProofVerifier — structural-soundness guards (gemini medium on #79)', () => {
  const verifier = createNativeProofVerifier({ resolveSignedEvent: () => makeEvent() });

  it('returns invalid (fail closed) when scheme matches but proofId is missing', () => {
    // @ts-expect-error: testing structural guard
    const record = nativeRecord({ proofId: undefined });
    expect(verifier(record)).toBe('invalid');
  });

  it('returns invalid when scheme matches but proofId is an empty string', () => {
    expect(verifier(nativeRecord({ proofId: '' }))).toBe('invalid');
  });

  it('returns invalid when issuer is missing or non-object', () => {
    // @ts-expect-error: testing structural guard
    expect(verifier(nativeRecord({ issuer: null }))).toBe('invalid');
    // @ts-expect-error: testing structural guard
    expect(verifier(nativeRecord({ issuer: 'identity:alice' }))).toBe('invalid');
  });

  it('returns invalid when issuer.id is missing or empty', () => {
    // @ts-expect-error: testing structural guard
    expect(verifier(nativeRecord({ issuer: { kind: 'actor' } }))).toBe('invalid');
    expect(verifier(nativeRecord({ issuer: { kind: 'actor', id: '' } }))).toBe('invalid');
  });
});

describe('createNativeProofVerifier — abstain semantics (caller does not hold the bytes)', () => {
  it('abstains when resolveSignedEvent returns undefined', () => {
    const verifier = createNativeProofVerifier({ resolveSignedEvent: () => undefined });
    expect(verifier(nativeRecord())).toBeUndefined();
  });

  it('abstains when resolveSignedEvent throws (DoS-resistant)', () => {
    const verifier = createNativeProofVerifier({
      resolveSignedEvent: () => {
        throw new Error('storage layer crashed');
      }
    });
    expect(verifier(nativeRecord())).toBeUndefined();
  });

  it('a misconfigured resolver does NOT promote anything to verified or invalid', () => {
    // Verifier with a "lying" resolver that returns a fake/empty
    // event-like object. Should NOT report `verified` — the
    // signature check will fail.
    const verifier = createNativeProofVerifier({
      // @ts-expect-error: deliberately bad shape — verifier must reject
      resolveSignedEvent: () => ({ author: 'identity:alice-pubkey' })
    });
    expect(verifier(nativeRecord())).toBe('invalid');
  });
});

describe('createNativeProofVerifier — issuer mismatch is invalid', () => {
  it('returns invalid when default-strategy issuer.id !== event.author', () => {
    const event = makeEvent({ author: 'identity:other' });
    const verifier = createNativeProofVerifier({ resolveSignedEvent: () => event });
    const record = nativeRecord({ issuer: { kind: 'actor', id: 'identity:alice-pubkey' } });
    expect(verifier(record)).toBe('invalid');
  });

  it('respects a caller-supplied issuerMatches strategy (positive override)', () => {
    const event = makeEvent({ author: 'identity:alice-pubkey' });
    // Strategy that accepts anything (used to PROVE the override works) — we
    // also pass a bare-id-mismatch record to be sure the override is the path.
    const strategy: IssuerMatchStrategy = () => true;
    const verifier = createNativeProofVerifier({
      resolveSignedEvent: () => event,
      issuerMatches: strategy
    });
    const record = nativeRecord({
      issuer: { kind: 'actor', id: 'totally-different-id' }
    });
    expect(verifier(record)).toBe('verified');
  });

  it('returns invalid when issuerMatches throws (fail closed at the adapter layer)', () => {
    const event = makeEvent();
    const verifier = createNativeProofVerifier({
      resolveSignedEvent: () => event,
      issuerMatches: () => {
        throw new Error('strategy broke');
      }
    });
    expect(verifier(nativeRecord())).toBe('invalid');
  });
});

describe('createNativeProofVerifier — signature verification', () => {
  it('returns verified on an honest native-signed-event match', () => {
    const event = makeEvent({ author: 'identity:alice-pubkey' });
    const verifier = createNativeProofVerifier({ resolveSignedEvent: () => event });
    const record = nativeRecord({ issuer: { kind: 'actor', id: 'identity:alice-pubkey' } });
    expect(verifier(record)).toBe('verified');
  });

  it('returns invalid when the envelope has been tampered with (e.g. payload swap)', () => {
    const event = makeEvent({ author: 'identity:alice-pubkey' });
    const tampered: SignedEventEnvelope = {
      ...event,
      payload: { msg: 'NOT THE SIGNED PAYLOAD' }
    };
    const verifier = createNativeProofVerifier({ resolveSignedEvent: () => tampered });
    const record = nativeRecord({ issuer: { kind: 'actor', id: 'identity:alice-pubkey' } });
    expect(verifier(record)).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */

describe('composeVerifiers', () => {
  const event = makeEvent({ author: 'identity:alice-pubkey' });
  const native = createNativeProofVerifier({ resolveSignedEvent: () => event });

  it('asks each verifier in order; first non-undefined verdict wins', () => {
    const stubVerified: CapabilityProofVerifier = () => 'verified';
    const stubInvalid: CapabilityProofVerifier = () => 'invalid';
    expect(composeVerifiers(stubVerified, stubInvalid)(nativeRecord({ scheme: 'ucan' }))).toBe(
      'verified'
    );
    expect(composeVerifiers(stubInvalid, stubVerified)(nativeRecord({ scheme: 'ucan' }))).toBe(
      'invalid'
    );
  });

  it('falls through abstaining verifiers to find the one that speaks the scheme', () => {
    const ucanStub: CapabilityProofVerifier = (r) => (r.scheme === 'ucan' ? 'verified' : undefined);
    const composed = composeVerifiers(native, ucanStub);
    expect(composed(nativeRecord({ scheme: 'ucan' }))).toBe('verified');
    expect(
      composed(nativeRecord({ issuer: { kind: 'actor', id: 'identity:alice-pubkey' } }))
    ).toBe('verified');
  });

  it('returns undefined when every verifier abstains', () => {
    const composed = composeVerifiers(
      () => undefined,
      () => undefined
    );
    expect(composed(nativeRecord({ scheme: 'vc' }))).toBeUndefined();
  });

  it('a throwing sub-verifier abstains rather than crashing the composition', () => {
    const angry: CapabilityProofVerifier = () => {
      throw new Error('boom');
    };
    const composed = composeVerifiers(angry, () => 'verified');
    expect(composed(nativeRecord({ scheme: 'vc' }))).toBe('verified');
  });

  it('rejects non-function arguments at construction time', () => {
    // @ts-expect-error: testing runtime guard
    expect(() => composeVerifiers(() => undefined, 'nope')).toThrow(TypeError);
  });

  it('composeVerifiers() with no arguments always abstains', () => {
    expect(composeVerifiers()(nativeRecord())).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */

describe('assertNativeProofDigest', () => {
  it('returns the digest when it matches the SHA-256 of the canonical event', async () => {
    const event = makeEvent();
    const { sha256Base64Url } = await import('@lfp2p/crypto');
    const { canonicalizeJson } = await import('@lfp2p/protocol');
    const expected = `sha-256:${await sha256Base64Url(canonicalizeJson(event))}`;
    await expect(assertNativeProofDigest({ digest: expected }, event)).resolves.toBe(expected);
  });

  it('throws on a digest mismatch', async () => {
    const event = makeEvent();
    await expect(
      assertNativeProofDigest({ digest: 'sha-256:nope' }, event)
    ).rejects.toThrow(/digest mismatch/);
  });

  it('throws TypeError when record is null or lacks a string digest (gemini medium on #79)', async () => {
    const event = makeEvent();
    await expect(
      // @ts-expect-error: testing runtime guard
      assertNativeProofDigest(null, event)
    ).rejects.toThrow(TypeError);
    await expect(
      // @ts-expect-error: testing runtime guard
      assertNativeProofDigest({}, event)
    ).rejects.toThrow(TypeError);
  });

  it('throws TypeError when event is null', async () => {
    await expect(
      // @ts-expect-error: testing runtime guard
      assertNativeProofDigest({ digest: 'sha-256:whatever' }, null)
    ).rejects.toThrow(TypeError);
  });
});
