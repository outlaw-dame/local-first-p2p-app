import { describe, expect, it } from 'vitest';
import invalidKindFixture from '../fixtures/invalid/event-envelope-unsupported-kind.json';
import invalidPrivacyFixture from '../fixtures/invalid/event-envelope-unsupported-privacy.json';
import invalidRefFixture from '../fixtures/invalid/event-envelope-malformed-source-ref.json';
import invalidVersionFixture from '../fixtures/invalid/event-envelope-unsupported-version.json';
import invalidIdentityControllerPrivacyFixture from '../fixtures/invalid/identity-controller-created-invalid-privacy.json';
import invalidIdentityControllerMissingPublicKeyFixture from '../fixtures/invalid/identity-controller-created-missing-controller-public-key.json';
import validIdentityControllerCreatedFixture from '../fixtures/valid/identity-controller-created.v1.json';
import validSignedEventFixture from '../fixtures/valid/signed-event-envelope.v1.json';
import { canonicalizeJson, validateSignedEvent, type SignedEventEnvelope } from './index.js';

const invalidSignedEventFixtures = [
  ['unsupported version', invalidVersionFixture, /Unsupported event version/],
  ['unsupported kind', invalidKindFixture, /Unsupported event kind/],
  ['unsupported privacy scope', invalidPrivacyFixture, /Unsupported privacy scope/],
  ['malformed source ref', invalidRefFixture, /ref\.sourceId/],
  [
    'identity controller created with invalid privacy',
    invalidIdentityControllerPrivacyFixture,
    /identity\.controller\.created must use privacy scope self/
  ],
  [
    'identity controller created missing controller key',
    invalidIdentityControllerMissingPublicKeyFixture,
    /identity\.controller\.created payload\.controllerPublicKey must be a non-empty string/
  ]
] as const;

describe('protocol event fixtures', () => {
  it('accepts the valid signed event fixture', () => {
    expect(() => validateSignedEvent(validSignedEventFixture as SignedEventEnvelope)).not.toThrow();
  });

  it('accepts the valid identity controller created fixture', () => {
    expect(() => validateSignedEvent(validIdentityControllerCreatedFixture as SignedEventEnvelope)).not.toThrow();
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

  it('rejects invalid signature fields', () => {
    const base = validSignedEventFixture as SignedEventEnvelope;

    expect(() =>
      validateSignedEvent({
        ...base,
        signature: { ...base.signature, algorithm: 'rsa' }
      } as unknown as SignedEventEnvelope)
    ).toThrow(/Unsupported signature algorithm/);

    expect(() =>
      validateSignedEvent({
        ...base,
        signature: { ...base.signature, publicKey: '' }
      } as unknown as SignedEventEnvelope)
    ).toThrow(/signature\.publicKey/);

    expect(() =>
      validateSignedEvent({
        ...base,
        signature: { ...base.signature, value: '   ' }
      } as unknown as SignedEventEnvelope)
    ).toThrow(/signature\.value/);
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
