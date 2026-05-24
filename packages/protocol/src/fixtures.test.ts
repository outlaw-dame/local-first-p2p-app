import { describe, expect, it } from 'vitest';
import invalidKindFixture from '../fixtures/invalid/event-envelope-unsupported-kind.json';
import invalidPrivacyFixture from '../fixtures/invalid/event-envelope-unsupported-privacy.json';
import invalidRefFixture from '../fixtures/invalid/event-envelope-malformed-source-ref.json';
import invalidVersionFixture from '../fixtures/invalid/event-envelope-unsupported-version.json';
import validSignedEventFixture from '../fixtures/valid/signed-event-envelope.v1.json';
import { canonicalizeJson, validateSignedEvent, type SignedEventEnvelope } from './index.js';

const invalidSignedEventFixtures = [
  ['unsupported version', invalidVersionFixture, /Unsupported event version/],
  ['unsupported kind', invalidKindFixture, /Unsupported event kind/],
  ['unsupported privacy scope', invalidPrivacyFixture, /Unsupported privacy scope/],
  ['malformed source ref', invalidRefFixture, /ref\.sourceId/]
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

  it('rejects non-finite JSON values before canonicalization', () => {
    expect(() => canonicalizeJson({ score: Number.NaN } as never)).toThrow(
      /Cannot canonicalize non-finite number/
    );
  });
});
