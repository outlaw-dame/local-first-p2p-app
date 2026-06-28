import { describe, expect, it } from 'vitest';
import {
  MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION,
  MLS_GROUP_CONTROL_VERSION,
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

// ---------------------------------------------------------------------------
// Phase 4 — MLS group-control event kinds and MLS application-message envelopes.
//
// These tests pin the protocol-boundary contract for Phase 4:
//
//   1. All 11 MLS group-control event kinds are recognised.
//   2. Group-control payloads require version, groupId, epoch, controlId,
//      createdAt, issuerDeviceId; non-creation records require previousControlId;
//      epoch-advancing records require membershipDigest.
//   3. `group` privacy accepts Phase 2 private payload envelopes (non-MLS groups).
//   4. `group` privacy accepts MLS application-message envelopes.
//   5. `group` privacy rejects plaintext payloads.
//   6. MLS application-message envelopes validate version, epoch, ids, ciphertext.
//   7. Unsupported fields in MLS envelopes are rejected.
// ---------------------------------------------------------------------------

describe('Phase 4 MLS group-control protocol kinds', () => {
  const BASE_CONTROL = {
    version: MLS_GROUP_CONTROL_VERSION,
    groupId: 'group:team-alpha',
    epoch: 0,
    controlId: 'ctrl-001',
    createdAt: '2026-06-27T00:00:00.000Z',
    issuerDeviceId: 'device:alice-phone'
  };

  it('accepts valid mls.group.created payload (epoch 0, no previousControlId required)', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_group_created',
        kind: 'mls.group.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: { ...BASE_CONTROL, creatorDeviceId: 'device:alice-phone' }
      })
    ).not.toThrow();
  });

  it('accepts epoch 0 on group control payloads', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_epoch0',
        kind: 'mls.group.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: { ...BASE_CONTROL, epoch: 0 }
      })
    ).not.toThrow();
  });

  it('rejects negative epoch on group control payloads', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_neg_epoch',
        kind: 'mls.group.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: { ...BASE_CONTROL, epoch: -1 }
      })
    ).toThrow(/epoch must be a safe non-negative integer/);
  });

  it('requires previousControlId on non-creation control kinds', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_member_add_no_prev',
        kind: 'mls.member.added',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: { ...BASE_CONTROL }
      })
    ).toThrow(/previousControlId/);
  });

  it('accepts mls.member.added with previousControlId', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_member_added',
        kind: 'mls.member.added',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: {
          ...BASE_CONTROL,
          previousControlId: 'ctrl-000',
          addedIdentityId: 'identity:bob',
          addedDeviceId: 'device:bob-laptop',
          welcomeRef: 'ref:welcome-abc'
        }
      })
    ).not.toThrow();
  });

  it('requires membershipDigest on epoch-advancing kinds (mls.commit.published)', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_commit_no_digest',
        kind: 'mls.commit.published',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: { ...BASE_CONTROL, previousControlId: 'ctrl-000', commitRef: 'ref:commit-1' }
      })
    ).toThrow(/membershipDigest/);
  });

  it('accepts mls.epoch.advanced with membershipDigest', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_epoch_adv',
        kind: 'mls.epoch.advanced',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: {
          ...BASE_CONTROL,
          epoch: 1,
          previousControlId: 'ctrl-000',
          priorEpoch: 0,
          nextEpoch: 1,
          checkpoint: 'ckpt-1',
          membershipDigest: 'sha256:abc123'
        }
      })
    ).not.toThrow();
  });

  it('rejects wrong group-control version string', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_bad_version',
        kind: 'mls.group.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: { ...BASE_CONTROL, version: 'lfp2p.mls-group-control.v2' }
      })
    ).toThrow(/lfp2p.mls-group-control.v1/);
  });

  it('rejects unsupported fields in group-control payload', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_extra_field',
        kind: 'mls.group.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: { ...BASE_CONTROL, unknownField: 'evil' }
      })
    ).toThrow(/unsupported field: unknownField/);
  });

  it('rejects empty groupId on group-control payload', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_empty_group',
        kind: 'mls.group.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: { ...BASE_CONTROL, groupId: '' }
      })
    ).toThrow(/groupId/);
  });
});

describe('Phase 4 group privacy — MLS application-message envelopes', () => {
  const VALID_MLS_APP_MSG = {
    version: MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION,
    groupId: 'group:team-alpha',
    epoch: 3,
    senderDeviceId: 'device:alice-phone',
    ciphertext: 'aGVsbG8',
    messageRef: 'ref:msg-001'
  };

  it('accepts MLS application-message envelope for group privacy', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_app_msg',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'group',
        payload: VALID_MLS_APP_MSG
      })
    ).not.toThrow();
  });

  it('accepts MLS application-message envelope with optional aadRef and contentRefs', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_app_msg_refs',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'group',
        payload: {
          ...VALID_MLS_APP_MSG,
          aadRef: 'ref:aad-001',
          contentRefs: ['ref:content-1', 'ref:content-2']
        }
      })
    ).not.toThrow();
  });

  it('accepts Phase 2 private payload envelope for group privacy (non-MLS-active group)', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_group_phase2',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'group',
        payload: {
          version: 'lfp2p.private-payload.envelope.v1',
          algorithm: 'aes-gcm-256',
          ciphertext: 'aGVsbG8',
          nonce: 'AAAAAAAAAAAAAAAA',
          keyId: 'group-key-1'
        }
      })
    ).not.toThrow();
  });

  it('rejects plaintext group payloads', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_group_plaintext',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'group',
        payload: { body: 'unencrypted group message' }
      })
    ).toThrow(/must contain a private payload envelope or MLS application-message envelope/);
  });

  it('rejects MLS application-message envelope with negative epoch', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_neg_epoch',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'group',
        payload: { ...VALID_MLS_APP_MSG, epoch: -1 }
      })
    ).toThrow(/epoch must be a safe non-negative integer/);
  });

  it('rejects MLS application-message envelope with empty groupId', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_empty_gid',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'group',
        payload: { ...VALID_MLS_APP_MSG, groupId: '' }
      })
    ).toThrow(/groupId/);
  });

  it('rejects MLS application-message envelope with non-base64url ciphertext', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_bad_ciphertext',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'group',
        payload: { ...VALID_MLS_APP_MSG, ciphertext: 'not valid base64url!!!' }
      })
    ).toThrow(/base64url/);
  });

  it('rejects MLS application-message envelope with unsupported extra fields', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_extra',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'group',
        payload: { ...VALID_MLS_APP_MSG, extraField: 'evil' }
      })
    ).toThrow(/unsupported field: extraField/);
  });

  it('rejects MLS application-message envelope outside group privacy', () => {
    expect(() =>
      createUnsignedEvent({
        eventId: 'evt_mls_public',
        kind: 'note.created',
        author: 'identity:alice',
        deviceId: 'device:alice-phone',
        createdAt: '2026-06-27T00:00:00.000Z',
        privacy: 'public',
        payload: VALID_MLS_APP_MSG
      })
    ).toThrow(/must not contain a private payload envelope/);
  });
});
