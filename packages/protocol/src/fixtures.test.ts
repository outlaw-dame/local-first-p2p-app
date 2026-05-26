import { describe, expect, it } from 'vitest';
import invalidKindFixture from '../fixtures/invalid/event-envelope-unsupported-kind.json';
import invalidPrivacyFixture from '../fixtures/invalid/event-envelope-unsupported-privacy.json';
import invalidRefFixture from '../fixtures/invalid/event-envelope-malformed-source-ref.json';
import invalidSignatureAlgorithmFixture from '../fixtures/invalid/event-envelope-unsupported-signature-algorithm.json';
import invalidSignaturePublicKeyFixture from '../fixtures/invalid/event-envelope-empty-signature-public-key.json';
import invalidSignatureValueFixture from '../fixtures/invalid/event-envelope-empty-signature-value.json';
import invalidVersionFixture from '../fixtures/invalid/event-envelope-unsupported-version.json';
import validSignedEventFixture from '../fixtures/valid/signed-event-envelope.v1.json';
import { canonicalizeJson, validateSignedEvent, type SignedEventEnvelope } from './index.js';

const invalidSignedEventFixtures = [
  ['unsupported version', invalidVersionFixture, /Unsupported event version/],
  ['unsupported kind', invalidKindFixture, /Unsupported event kind/],
  ['unsupported privacy scope', invalidPrivacyFixture, /Unsupported privacy scope/],
  ['malformed source ref', invalidRefFixture, /ref\.sourceId/],
  ['unsupported signature algorithm', invalidSignatureAlgorithmFixture, /Unsupported signature algorithm/],
  ['empty signature public key', invalidSignaturePublicKeyFixture, /signature\.publicKey/],
  ['empty signature value', invalidSignatureValueFixture, /signature\.value/]
] as const;

describe('protocol event fixtures', () => {
  it('accepts the valid signed event fixture', () => {
    expect(() => validateSignedEvent(validSignedEventFixture as SignedEventEnvelope)).not.toThrow();
  });

  it.each(invalidSignedEventFixtures)('rejects the %s fixture', (_name, fixture, errorPattern) => {
    expect(() => validateSignedEvent(fixture as SignedEventEnvelope)).toThrow(errorPattern);
  });

  it('rejects non-object payload values', () => {
    expect(() =>
      validateSignedEvent({
        ...validSignedEventFixture,
        payload: []
      } as unknown as SignedEventEnvelope)
    ).toThrow(/payload must be a JSON object/);
  });

  it('rejects invalid date formats', () => {
    expect(() =>
      validateSignedEvent({
        ...validSignedEventFixture,
        createdAt: 'not-a-date'
      } as unknown as SignedEventEnvelope)
    ).toThrow(/createdAt must be an ISO date string/);
  });

  it('rejects non-finite JSON values before canonicalization', () => {
    expect(() => canonicalizeJson({ nan: Number.NaN } as never)).toThrow(
      /Cannot canonicalize non-finite number/
    );
    expect(() => canonicalizeJson({ inf: Number.POSITIVE_INFINITY } as never)).toThrow(
      /Cannot canonicalize non-finite number/
    );
    expect(() => canonicalizeJson({ negInf: Number.NEGATIVE_INFINITY } as never)).toThrow(
      /Cannot canonicalize non-finite number/
    );
  });
});
