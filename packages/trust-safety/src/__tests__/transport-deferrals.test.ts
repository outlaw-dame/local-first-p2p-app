import { describe, expect, it } from 'vitest';
import type { LocalControlEvent, SafetyReport } from '../index.js';
import {
  applyLocalControlEvent,
  createEmptyLocalControlState,
  decideReportForwarding,
  decideUserBlockTransport
} from '../index.js';

const BLOCK_AT_2026_05_01: LocalControlEvent = {
  version: 'lfp2p.local-control-event.v1',
  eventId: 'evt_block',
  createdAt: '2026-05-01T00:00:00Z',
  action: 'apply',
  kind: 'safety.account.blocked',
  targetActorId: 'actor_evil'
};

describe('decideUserBlockTransport — Phase 1.62 deferral', () => {
  it('returns producer-blocked for a current block', () => {
    const state = applyLocalControlEvent(createEmptyLocalControlState(), BLOCK_AT_2026_05_01);
    const r = decideUserBlockTransport(
      state,
      { producerActorId: 'actor_evil', recipientUserId: 'user_me' },
      Date.parse('2026-05-31T00:00:00Z')
    );
    expect(r.shouldReject).toBe(true);
    expect(r.reason).toBe('producer-blocked');
  });

  it('returns producer-allowed when block is expired', () => {
    const expiredBlock: LocalControlEvent = {
      ...BLOCK_AT_2026_05_01,
      expiresAt: '2026-05-15T00:00:00Z'
    };
    const state = applyLocalControlEvent(createEmptyLocalControlState(), expiredBlock);
    const r = decideUserBlockTransport(
      state,
      { producerActorId: 'actor_evil', recipientUserId: 'user_me' },
      Date.parse('2026-05-31T00:00:00Z')
    );
    expect(r.shouldReject).toBe(false);
  });

  it('returns producer-allowed when no block exists', () => {
    const r = decideUserBlockTransport(
      createEmptyLocalControlState(),
      { producerActorId: 'actor_unknown' },
      Date.parse('2026-05-31T00:00:00Z')
    );
    expect(r.shouldReject).toBe(false);
  });
});

const PUBLIC_SUBJECT_REPORT: SafetyReport = {
  version: 'lfp2p.safety-report.v1',
  reportId: 'r1',
  reporter: { kind: 'actor', actor: { actorId: 'actor_damon' } },
  subject: { type: 'event', eventId: 'evt_public' },
  targetAuthority: {
    version: 'lfp2p.safety-authority.v1',
    authorityId: 'auth_mod_42',
    actorId: 'actor_mod_alice',
    role: 'moderator',
    scope: 'community-local',
    createdAt: '2026-05-01T00:00:00Z'
  },
  reasonCode: 'abuse.harassment',
  scope: 'community-local',
  idempotencyKey: 'idem_1',
  createdAt: '2026-05-31T00:00:00Z',
  reporterPrivacy: 'identified-to-authority'
};

const PRIVATE_BLOB_REPORT: SafetyReport = {
  ...PUBLIC_SUBJECT_REPORT,
  reportId: 'r2',
  subject: {
    type: 'blob',
    blockRef: {
      type: 'block-ref',
      source: {
        kind: 'digest',
        digest: { algorithm: 'sha-256', digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU' }
      },
      byteLength: 1024,
      offset: 0,
      privacy: 'private',
      encryption: {
        scheme: 'xchacha20-poly1305',
        keyRef: { algorithm: 'sha-256', digest: 'ypeBEsobvcr6wjGzmiPcTaeG7_gUfE5yuYB3ha_uSLs' }
      }
    }
  }
};

describe('decideReportForwarding — Phase 1.63 deferral', () => {
  it('returns forwardable for a public-subject report', () => {
    expect(decideReportForwarding(PUBLIC_SUBJECT_REPORT).shouldForward).toBe(true);
  });

  it('returns forwardable for a private-subject report with encrypted evidence', () => {
    expect(decideReportForwarding(PRIVATE_BLOB_REPORT).shouldForward).toBe(true);
  });

  it('returns private-evidence-leak-risk when a private-subject report references public media', () => {
    const unsafe: SafetyReport = {
      ...PRIVATE_BLOB_REPORT,
      evidenceRefs: [
        {
          type: 'object-ref',
          kind: 'media',
          block: {
            type: 'block-ref',
            source: {
              kind: 'content-link',
              link: {
                type: 'content-link',
                cid: 'bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa',
                codec: 'raw'
              }
            },
            byteLength: 1024,
            offset: 0,
            privacy: 'public'
          }
        }
      ]
    };
    const r = decideReportForwarding(unsafe);
    expect(r.shouldForward).toBe(false);
    expect(r.reason).toBe('private-evidence-leak-risk');
  });
});
