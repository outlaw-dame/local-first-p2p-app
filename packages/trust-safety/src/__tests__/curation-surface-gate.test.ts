import { describe, expect, it } from 'vitest';
import type { SafetyReport } from '../index.js';
import {
  assertCurationSurfaceIngest,
  assertReportAsCurationSignal,
  decideCurationSurfaceIngest,
  decideReportAsCurationSignal,
  LOCAL_CURATION_SURFACES,
  PUBLIC_CURATION_SURFACES
} from '../index.js';

const AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_mod_42',
  actorId: 'actor_mod_alice',
  role: 'moderator' as const,
  scope: 'community-local' as const,
  createdAt: '2026-05-01T00:00:00Z'
};

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

const KEY_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: 'ypeBEsobvcr6wjGzmiPcTaeG7_gUfE5yuYB3ha_uSLs'
};

describe('decideCurationSurfaceIngest — public surfaces', () => {
  it.each([...PUBLIC_CURATION_SURFACES])(
    'rejects device-local envelope scope on %s',
    (surface) => {
      const d = decideCurationSurfaceIngest(
        surface,
        'device-local',
        { type: 'event', eventId: 'evt_x' }
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe('private-envelope-scope');
    }
  );

  it.each([...PUBLIC_CURATION_SURFACES])(
    'rejects dm envelope scope on %s',
    (surface) => {
      const d = decideCurationSurfaceIngest(
        surface,
        'dm',
        { type: 'event', eventId: 'evt_x' }
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe('private-envelope-scope');
    }
  );

  it.each([...PUBLIC_CURATION_SURFACES])(
    'rejects group envelope scope on %s',
    (surface) => {
      const d = decideCurationSurfaceIngest(
        surface,
        'group',
        { type: 'event', eventId: 'evt_x' }
      );
      expect(d.allowed).toBe(false);
    }
  );

  it.each([...PUBLIC_CURATION_SURFACES])(
    'accepts public envelope + event subject on %s',
    (surface) => {
      const d = decideCurationSurfaceIngest(
        surface,
        'public',
        { type: 'event', eventId: 'evt_x' }
      );
      expect(d.allowed).toBe(true);
    }
  );

  it.each([...PUBLIC_CURATION_SURFACES])(
    'rejects private-by-nature subject (blob) on %s even when envelope is public',
    (surface) => {
      const d = decideCurationSurfaceIngest(
        surface,
        'public',
        {
          type: 'blob',
          blockRef: {
            type: 'block-ref',
            source: { kind: 'digest', digest: VALID_DIGEST },
            byteLength: 1024,
            offset: 0,
            privacy: 'private',
            encryption: { scheme: 'xchacha20-poly1305', keyRef: KEY_DIGEST }
          }
        }
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe('private-by-nature-subject');
    }
  );
});

describe('decideCurationSurfaceIngest — local surfaces', () => {
  it.each([...LOCAL_CURATION_SURFACES])(
    'accepts any envelope scope on %s',
    (surface) => {
      for (const scope of ['device-local', 'self', 'dm', 'group', 'public'] as const) {
        const d = decideCurationSurfaceIngest(
          surface,
          scope,
          { type: 'event', eventId: 'evt_x' }
        );
        expect(d.allowed, `surface=${surface} scope=${scope}`).toBe(true);
      }
    }
  );
});

describe('assertCurationSurfaceIngest', () => {
  it('throws TS_PRIVATE_LEAK on a private/public mismatch', () => {
    expect(() =>
      assertCurationSurfaceIngest('public-feed', 'dm', {
        type: 'event',
        eventId: 'evt_x'
      })
    ).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('rejects unknown surface and unknown envelope scope', () => {
    expect(() =>
      assertCurationSurfaceIngest('unknown-surface', 'public', {
        type: 'event',
        eventId: 'evt_x'
      })
    ).toThrow();
    expect(() =>
      assertCurationSurfaceIngest('public-feed', 'cosmic', {
        type: 'event',
        eventId: 'evt_x'
      })
    ).toThrow();
  });
});

describe('decideReportAsCurationSignal — Phase 1.63 deferral', () => {
  const PUBLIC_REPORT: SafetyReport = {
    version: 'lfp2p.safety-report.v1',
    reportId: 'r_pub',
    reporter: { kind: 'actor', actor: { actorId: 'actor_damon' } },
    subject: { type: 'event', eventId: 'evt_public' },
    targetAuthority: AUTHORITY,
    reasonCode: 'abuse.harassment',
    scope: 'community-local',
    idempotencyKey: 'idem_1',
    createdAt: '2026-05-31T00:00:00Z',
    reporterPrivacy: 'identified-to-authority'
  };

  const PRIVATE_REPORT: SafetyReport = {
    ...PUBLIC_REPORT,
    reportId: 'r_priv',
    subject: {
      type: 'blob',
      blockRef: {
        type: 'block-ref',
        source: { kind: 'digest', digest: VALID_DIGEST },
        byteLength: 1024,
        offset: 0,
        privacy: 'private',
        encryption: { scheme: 'xchacha20-poly1305', keyRef: KEY_DIGEST }
      }
    }
  };

  it.each([...PUBLIC_CURATION_SURFACES])(
    'private-only report cannot drive curation on %s',
    (surface) => {
      const d = decideReportAsCurationSignal(PRIVATE_REPORT, surface);
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe('private-only-report-signal');
    }
  );

  it.each([...PUBLIC_CURATION_SURFACES])(
    'public-routable report may drive curation on %s',
    (surface) => {
      const d = decideReportAsCurationSignal(PUBLIC_REPORT, surface);
      expect(d.allowed).toBe(true);
    }
  );

  it.each([...LOCAL_CURATION_SURFACES])(
    'private-only report may drive curation on local surface %s',
    (surface) => {
      const d = decideReportAsCurationSignal(PRIVATE_REPORT, surface);
      expect(d.allowed).toBe(true);
    }
  );

  it('assertReportAsCurationSignal throws TS_PRIVATE_LEAK on private/public', () => {
    expect(() =>
      assertReportAsCurationSignal(PRIVATE_REPORT, 'public-feed')
    ).toThrow(/TS_PRIVATE_LEAK/);
  });
});
