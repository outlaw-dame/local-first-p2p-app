import { describe, expect, it } from 'vitest';
import {
  REPUTATION_EVENT_PAYLOAD_VERSION,
  canonicalizeJson,
  createUnsignedEvent,
  isReputationEventKind,
  validateUnsignedEvent
} from './index.js';

describe('protocol event envelopes', () => {
  it('creates a deterministic unsigned event envelope', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_001',
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: { body: 'hello' }
    });

    expect(event.version).toBe('lfp2p.event.v1');
    expect(event.lamport).toBe(0);
    expect(event.schemaVersion).toBe(1);
  });

  it('canonicalizes object keys recursively', () => {
    expect(canonicalizeJson({ z: 1, a: { y: true, b: 'x' } })).toBe(
      '{"a":{"b":"x","y":true},"z":1}'
    );
  });

  it('rejects invalid timestamps', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_bad',
        kind: 'outbox.test.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: 'not-a-date',
        privacy: 'device-local',
        payload: {}
      })
    ).toThrow(/createdAt/);
  });

  it('rejects unsupported runtime event kinds and privacy scopes', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_runtime_validation',
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: {}
    });

    expect(() => validateUnsignedEvent({ ...event, kind: 'evil.kind' } as never)).toThrow(
      /Unsupported event kind/
    );
    expect(() => validateUnsignedEvent({ ...event, privacy: 'secret' } as never)).toThrow(
      /Unsupported privacy scope/
    );
  });

  it('accepts a self private payload envelope for user content', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_self_encrypted',
      kind: 'note.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'self',
      payload: {
        version: 'lfp2p.private-payload.envelope.v1',
        algorithm: 'aes-gcm-256',
        ciphertext: 'aGVsbG8',
        nonce: 'AAAAAAAAAAAAAAAA',
        keyId: 'content:key:alice'
      }
    });

    expect(() => validateUnsignedEvent(event)).not.toThrow();
  });

  it('rejects plaintext dm payloads', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_dm_plaintext',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: { body: 'hello' }
      })
    ).toThrow(/must contain a private payload envelope/);
  });

  it('rejects public payloads containing an envelope', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_public_envelope',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'public',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice'
        }
      })
    ).toThrow(/must not contain a private payload envelope/);
  });

  it('rejects invalid private payload envelope version', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_invalid_version',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v2',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice'
        }
      })
    ).toThrow(/Unsupported private payload envelope version/);
  });

  it('rejects invalid private payload envelope algorithm', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_invalid_algorithm',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-128',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice'
        }
      })
    ).toThrow(/Unsupported private payload envelope algorithm/);
  });

  it('rejects invalid private payload envelope nonce values', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_invalid_nonce',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAA',
          keyId: 'content:key:alice'
        }
      })
    ).toThrow(/payload\.nonce must be base64url with no padding|payload\.nonce must decode to 12 bytes/);
  });

  it('rejects duplicate recipient device IDs in private payload envelope', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_dup_recipients',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice',
          recipientWraps: [
            {
              recipientIdentityId: 'identity:alice',
              recipientDeviceId: 'device:alice-phone',
              keyAgreement: 'x25519-v1',
              wrappedKey: 'aGVsbG8',
              wrappingKeyRef: 'device-key:alice-phone-enc'
            },
            {
              recipientIdentityId: 'identity:alice',
              recipientDeviceId: 'device:alice-phone',
              keyAgreement: 'x25519-v1',
              wrappedKey: 'aGVsbG8',
              wrappingKeyRef: 'device-key:alice-phone-enc'
            }
          ]
        }
      })
    ).toThrow(/duplicate.*recipientDeviceId/);
  });

  it('rejects unsupported key agreement algorithms in recipient wraps', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_bad_ka',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice',
          recipientWraps: [
            {
              recipientIdentityId: 'identity:alice',
              recipientDeviceId: 'device:alice-phone',
              keyAgreement: 'x25519-v2' as unknown as 'x25519-v1',
              wrappedKey: 'aGVsbG8',
              wrappingKeyRef: 'device-key:alice-phone-enc'
            }
          ]
        }
      })
    ).toThrow(/Unsupported key agreement algorithm/);
  });

  it('rejects recipient wraps with missing required fields', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_missing_wrap_field',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-05-22T00:00:00.000Z',
        privacy: 'dm',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'content:key:alice',
          recipientWraps: [
            {
              recipientIdentityId: 'identity:alice',
              recipientDeviceId: 'device:alice-phone',
              keyAgreement: 'x25519-v1',
              wrappedKey: 'aGVsbG8'
            }
          ]
        }
      })
    ).toThrow(/wrappingKeyRef/);
  });

  it('validates runtime source references', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_refs',
      kind: 'outbox.test.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-22T00:00:00.000Z',
      privacy: 'device-local',
      payload: {},
      refs: [{ sourceId: 'source:one', sequence: 1 }]
    });

    expect(() => validateUnsignedEvent(event)).not.toThrow();
    expect(() =>
      validateUnsignedEvent({
        ...event,
        refs: [{ sourceId: '', sequence: -1 }]
      } as never)
    ).toThrow(/ref\.sourceId|ref\.sequence/);
  });

  it('validates identity-control payload requirements', () => {
    const identityControllerCreated = createUnsignedEvent({
      eventId: 'evt_identity_controller_created',
      kind: 'identity.controller.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-26T00:00:00.000Z',
      privacy: 'self',
      payload: {
        controllerPublicKey: 'controller-public-key',
        initialDeviceId: 'device:alice-phone'
      }
    });
    expect(() => validateUnsignedEvent(identityControllerCreated)).not.toThrow();

    expect(() =>
      validateUnsignedEvent({
        ...identityControllerCreated,
        privacy: 'device-local'
      } as never)
    ).toThrow(/must use privacy scope self/);

    expect(() =>
      validateUnsignedEvent({
        ...identityControllerCreated,
        payload: {
          ...identityControllerCreated.payload,
          controllerPublicKey: ''
        }
      } as never)
    ).toThrow(/payload\.controllerPublicKey must be a non-empty string/);
  });
});

// ---------------------------------------------------------------------------
// Phase 1.8.14 — reputation events as first-class protocol kinds.
//
// These tests pin the protocol-boundary contract for reputation
// envelopes:
//
//   1. Five reputation kinds are recognised at envelope construction.
//   2. Aggregator events MUST be `public`; observation / attestation /
//      revocation MUST be `device-local` or `self` (Phase 5.0 wraps
//      `self` ones inside a private payload envelope; until then the
//      doctrine default `device-local` is the only off-the-wire path).
//   3. Inner payload `eventId` / `kind` / `createdAt` MUST pin to the
//      envelope's counterparts. An envelope that drifts is rejected at
//      the protocol boundary, BEFORE bridge admission or local
//      persistence sees it.
//   4. Inner payload `version` MUST be the documented sentinel
//      `lfp2p.reputation-event.v1`.
//
// Structural-only checks here. The full semantic validation
// (`@lfp2p/trust-safety::validateReputationEvent`) runs again at the
// store boundary — defense in depth.
// ---------------------------------------------------------------------------

describe('reputation events as first-class protocol kinds', () => {
  const baseAggregatorPayload = (overrides: Record<string, unknown> = {}) => ({
    version: REPUTATION_EVENT_PAYLOAD_VERSION,
    eventId: 'evt_rep_agg_001',
    kind: 'reputation.aggregator.published',
    createdAt: '2026-06-01T00:00:00.000Z',
    algorithm: 'openrank.v1',
    computedAt: '2026-06-01T00:00:00.000Z',
    subjects: [
      {
        subject: { type: 'actor', actorId: 'actor_alice' },
        score: 0.5,
        confidence: 0.9,
        observationCount: 10
      }
    ],
    ...overrides
  });

  const baseObservationPayload = (overrides: Record<string, unknown> = {}) => ({
    version: REPUTATION_EVENT_PAYLOAD_VERSION,
    eventId: 'evt_rep_obs_001',
    kind: 'reputation.observation.recorded',
    createdAt: '2026-06-01T00:00:00.000Z',
    subject: { type: 'actor', actorId: 'actor_alice' },
    observationKind: 'outbox.useful',
    satCount: 3,
    unsatCount: 0,
    windowStart: '2026-05-25T00:00:00.000Z',
    windowEnd: '2026-06-01T00:00:00.000Z',
    ...overrides
  });

  it('isReputationEventKind narrows the five reputation kinds (and only those)', () => {
    expect(isReputationEventKind('reputation.observation.recorded')).toBe(true);
    expect(isReputationEventKind('reputation.attestation.published')).toBe(true);
    expect(isReputationEventKind('reputation.attestation.revoked')).toBe(true);
    expect(isReputationEventKind('reputation.aggregator.published')).toBe(true);
    expect(isReputationEventKind('reputation.aggregator.score.removed')).toBe(true);
    expect(isReputationEventKind('note.created')).toBe(false);
    expect(isReputationEventKind('reputation.unknown')).toBe(false);
    expect(isReputationEventKind('reputation.')).toBe(false);
    expect(isReputationEventKind('')).toBe(false);
    expect(isReputationEventKind(null)).toBe(false);
    expect(isReputationEventKind(42)).toBe(false);
  });

  it('accepts an aggregator.published envelope at privacy=public', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_rep_agg_001',
      kind: 'reputation.aggregator.published',
      author: 'identity:openrank',
      deviceId: 'device:openrank-runner',
      createdAt: '2026-06-01T00:00:00.000Z',
      privacy: 'public',
      payload: baseAggregatorPayload()
    });
    expect(() => validateUnsignedEvent(event)).not.toThrow();
  });

  it('accepts an aggregator.score.removed envelope at privacy=public', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_rep_rem_001',
      kind: 'reputation.aggregator.score.removed',
      author: 'identity:openrank',
      deviceId: 'device:openrank-runner',
      createdAt: '2026-06-02T00:00:00.000Z',
      privacy: 'public',
      payload: {
        version: REPUTATION_EVENT_PAYLOAD_VERSION,
        eventId: 'evt_rep_rem_001',
        kind: 'reputation.aggregator.score.removed',
        createdAt: '2026-06-02T00:00:00.000Z',
        subject: { type: 'actor', actorId: 'actor_alice' },
        reason: 'revoked'
      }
    });
    expect(() => validateUnsignedEvent(event)).not.toThrow();
  });

  it('rejects aggregator events with privacy != public', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_rep_agg_001',
        kind: 'reputation.aggregator.published',
        author: 'identity:openrank',
        deviceId: 'device:openrank-runner',
        createdAt: '2026-06-01T00:00:00.000Z',
        privacy: 'device-local',
        payload: baseAggregatorPayload()
      })
    ).toThrow(/must use privacy scope public/);
  });

  it('accepts an observation envelope at privacy=device-local', () => {
    const event = createUnsignedEvent({
      eventId: 'evt_rep_obs_001',
      kind: 'reputation.observation.recorded',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-06-01T00:00:00.000Z',
      privacy: 'device-local',
      payload: baseObservationPayload()
    });
    expect(() => validateUnsignedEvent(event)).not.toThrow();
  });

  it('rejects an observation envelope at privacy=public (must stay private)', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_rep_obs_001',
        kind: 'reputation.observation.recorded',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-01T00:00:00.000Z',
        privacy: 'public',
        payload: baseObservationPayload()
      })
    ).toThrow(/must use privacy scope device-local or self/);
  });

  it('rejects an aggregator envelope whose inner payload eventId drifts', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_rep_agg_001',
        kind: 'reputation.aggregator.published',
        author: 'identity:openrank',
        deviceId: 'device:openrank-runner',
        createdAt: '2026-06-01T00:00:00.000Z',
        privacy: 'public',
        payload: baseAggregatorPayload({ eventId: 'evt_rep_agg_DRIFTED' })
      })
    ).toThrow(/payload\.eventId must equal envelope\.eventId/);
  });

  it('rejects an aggregator envelope whose inner payload kind drifts', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_rep_agg_001',
        kind: 'reputation.aggregator.published',
        author: 'identity:openrank',
        deviceId: 'device:openrank-runner',
        createdAt: '2026-06-01T00:00:00.000Z',
        privacy: 'public',
        payload: baseAggregatorPayload({ kind: 'reputation.observation.recorded' })
      })
    ).toThrow(/payload\.kind must equal envelope\.kind/);
  });

  it('rejects an aggregator envelope whose inner payload createdAt drifts', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_rep_agg_001',
        kind: 'reputation.aggregator.published',
        author: 'identity:openrank',
        deviceId: 'device:openrank-runner',
        createdAt: '2026-06-01T00:00:00.000Z',
        privacy: 'public',
        payload: baseAggregatorPayload({ createdAt: '2026-06-02T00:00:00.000Z' })
      })
    ).toThrow(/payload\.createdAt must equal envelope\.createdAt/);
  });

  it('rejects an envelope whose inner payload version is wrong', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_rep_agg_001',
        kind: 'reputation.aggregator.published',
        author: 'identity:openrank',
        deviceId: 'device:openrank-runner',
        createdAt: '2026-06-01T00:00:00.000Z',
        privacy: 'public',
        payload: baseAggregatorPayload({ version: 'lfp2p.reputation-event.v2' })
      })
    ).toThrow(/payload\.version must equal lfp2p\.reputation-event\.v1/);
  });

  it('rejects reputation envelopes with non-string required identity fields', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_rep_agg_001',
        kind: 'reputation.aggregator.published',
        author: 'identity:openrank',
        deviceId: 'device:openrank-runner',
        createdAt: '2026-06-01T00:00:00.000Z',
        privacy: 'public',
        payload: baseAggregatorPayload({ eventId: 42 })
      })
    ).toThrow(/payload\.eventId must be a non-empty string/);
  });
});
