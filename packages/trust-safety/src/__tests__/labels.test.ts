import { describe, expect, it } from 'vitest';
import {
  SAFETY_LABEL_DEFINITION_VERSION,
  SAFETY_LABEL_VERSION,
  validateSafetyLabel,
  validateSafetyLabelDefinition
} from '../index.js';

const AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_1',
  actorId: 'actor_1',
  scope: 'community-local' as const,
  createdAt: '2026-01-01T00:00:00Z'
};

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

const PRIVATE_BLOB_SUBJECT = {
  type: 'blob' as const,
  blockRef: {
    type: 'block-ref' as const,
    source: { kind: 'digest' as const, digest: VALID_DIGEST },
    byteLength: 1024,
    privacy: 'private' as const,
    encryption: {
      scheme: 'xchacha20-poly1305' as const,
      keyRef: VALID_DIGEST
    }
  }
};

const DEFINITION_BASE = {
  version: SAFETY_LABEL_DEFINITION_VERSION,
  labelKey: 'security.spam',
  namespace: 'lfp2p.safety',
  displayName: 'Spam',
  description: 'Bulk unsolicited content.',
  category: 'security' as const,
  defaultSeverity: 'low' as const,
  defaultAction: 'collapse' as const,
  userConfigurable: true,
  createdBy: AUTHORITY,
  createdAt: '2026-01-01T00:00:00Z'
};

describe('validateSafetyLabelDefinition', () => {
  it('accepts a well-formed definition', () => {
    expect(() => validateSafetyLabelDefinition(DEFINITION_BASE)).not.toThrow();
  });

  it('rejects hardSafety + permissive defaultAction', () => {
    expect(() =>
      validateSafetyLabelDefinition({
        ...DEFINITION_BASE,
        labelKey: 'media-safety.csam',
        category: 'media-safety',
        defaultSeverity: 'critical',
        defaultAction: 'allow',
        userConfigurable: false,
        hardSafety: true
      })
    ).toThrow(/TS_HARD_SAFETY_DOWNGRADE/);
  });

  it('rejects hardSafety + userConfigurable=true', () => {
    expect(() =>
      validateSafetyLabelDefinition({
        ...DEFINITION_BASE,
        hardSafety: true,
        userConfigurable: true,
        defaultAction: 'hide'
      })
    ).toThrow(/TS_HARD_SAFETY_DOWNGRADE/);
  });

  it('rejects invalid label key pattern', () => {
    expect(() =>
      validateSafetyLabelDefinition({ ...DEFINITION_BASE, labelKey: 'BAD-KEY' })
    ).toThrow(/TS_INVALID_LABEL/);
  });

  it('rejects invalid category', () => {
    expect(() =>
      validateSafetyLabelDefinition({ ...DEFINITION_BASE, category: 'invalid' })
    ).toThrow(/TS_INVALID_ENUM/);
  });
});

const LABEL_BASE = {
  version: SAFETY_LABEL_VERSION,
  labelId: 'label_1',
  issuer: AUTHORITY,
  subject: { type: 'event' as const, eventId: 'evt_x' },
  labelKey: 'security.spam',
  namespace: 'lfp2p.safety',
  scope: 'community-local' as const,
  createdAt: '2026-05-31T00:00:00Z'
};

describe('validateSafetyLabel', () => {
  it('accepts a minimal label', () => {
    expect(() => validateSafetyLabel(LABEL_BASE)).not.toThrow();
  });

  it('rejects confidence outside [0,1]', () => {
    expect(() => validateSafetyLabel({ ...LABEL_BASE, confidence: 1.5 })).toThrow(
      /TS_INVALID_NUMBER/
    );
    expect(() => validateSafetyLabel({ ...LABEL_BASE, confidence: -0.1 })).toThrow();
  });

  it('rejects NaN/Infinity confidence', () => {
    expect(() => validateSafetyLabel({ ...LABEL_BASE, confidence: Number.NaN })).toThrow();
  });

  it('rejects private blob subject at network-advisory scope (privacy leak)', () => {
    expect(() =>
      validateSafetyLabel({
        ...LABEL_BASE,
        subject: PRIVATE_BLOB_SUBJECT,
        scope: 'network-advisory'
      })
    ).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('rejects private blob subject at index-local scope (privacy leak)', () => {
    expect(() =>
      validateSafetyLabel({
        ...LABEL_BASE,
        subject: PRIVATE_BLOB_SUBJECT,
        scope: 'index-local'
      })
    ).toThrow(/TS_PRIVATE_LEAK/);
  });

  it('accepts private blob subject at community-local scope', () => {
    expect(() =>
      validateSafetyLabel({
        ...LABEL_BASE,
        subject: PRIVATE_BLOB_SUBJECT,
        scope: 'community-local'
      })
    ).not.toThrow();
  });

  it('rejects oversized evidenceRefs', () => {
    const big = new Array(33).fill({
      type: 'object-ref',
      kind: 'report',
      digest: VALID_DIGEST
    });
    expect(() => validateSafetyLabel({ ...LABEL_BASE, evidenceRefs: big })).toThrow(/exceeds 32/);
  });
});
