import { describe, expect, it } from 'vitest';
import {
  appendAuditEntry,
  createAuditLog,
  redactBlockRefForAudit,
  redactDigestForAudit,
  SAFETY_REASON_CODES,
  type SafetyReasonCode
} from '../index.js';

const VALID_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU'
};

const KEY_DIGEST = {
  algorithm: 'sha-256' as const,
  digest: 'ypeBEsobvcr6wjGzmiPcTaeG7_gUfE5yuYB3ha_uSLs'
};

describe('audit redaction', () => {
  it('redactDigestForAudit emits an 8-char prefix only', () => {
    const redacted = redactDigestForAudit(VALID_DIGEST);
    expect(redacted.startsWith('sha-256:')).toBe(true);
    expect(redacted.includes(VALID_DIGEST.digest)).toBe(false);
    expect(redacted).toMatch(/^sha-256:[A-Za-z0-9_-]{1,8}…$/);
  });

  it('redactBlockRefForAudit never logs the encryption key digest', () => {
    const block = {
      type: 'block-ref' as const,
      source: { kind: 'digest' as const, digest: VALID_DIGEST },
      byteLength: 4096,
      offset: 0,
      privacy: 'private' as const,
      encryption: { scheme: 'xchacha20-poly1305' as const, keyRef: KEY_DIGEST }
    };
    const redacted = redactBlockRefForAudit(block);
    expect(redacted.includes(KEY_DIGEST.digest)).toBe(false);
    expect(redacted.includes(VALID_DIGEST.digest)).toBe(false);
    expect(redacted.startsWith('block(private,')).toBe(true);
  });

  it('redactBlockRefForAudit truncates CID body to a short prefix', () => {
    const block = {
      type: 'block-ref' as const,
      source: {
        kind: 'content-link' as const,
        link: {
          type: 'content-link' as const,
          cid: 'bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa',
          codec: 'raw' as const
        }
      },
      byteLength: 32768,
      offset: 0,
      privacy: 'public' as const
    };
    const redacted = redactBlockRefForAudit(block);
    expect(redacted.includes('bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa')).toBe(
      false
    );
    expect(redacted.includes('cid:raw:')).toBe(true);
  });
});

describe('audit log', () => {
  const validCodes = SAFETY_REASON_CODES as ReadonlyArray<SafetyReasonCode>;

  it('appends entries and rounds timestamps to whole seconds', () => {
    const now = 12_345_678;
    const log = appendAuditEntry(
      createAuditLog(),
      {
        operatorAuthorityId: 'auth_1',
        surface: 'bridge',
        action: 'accept',
        reasonCode: 'policy.local-preference'
      },
      now,
      validCodes
    );
    expect(log.entries.length).toBe(1);
    expect(log.entries[0]?.ts).toBe(Math.floor(now / 1000));
  });

  it('rejects unknown reason codes', () => {
    expect(() =>
      appendAuditEntry(
        createAuditLog(),
        {
          operatorAuthorityId: 'auth_1',
          surface: 'bridge',
          action: 'reject',
          reasonCode: 'invented-code' as unknown as SafetyReasonCode
        },
        0,
        validCodes
      )
    ).toThrow(/TS_INVALID_ENUM/);
  });

  it('FIFO-evicts when capacity is exceeded', () => {
    let log = createAuditLog(3);
    for (let i = 0; i < 5; i += 1) {
      log = appendAuditEntry(
        log,
        {
          operatorAuthorityId: `auth_${i}`,
          surface: 'bridge',
          action: 'accept',
          reasonCode: 'policy.local-preference'
        },
        i * 1_000,
        validCodes
      );
    }
    expect(log.entries.length).toBe(3);
    expect(log.entries[0]?.operatorAuthorityId).toBe('auth_2');
    expect(log.entries[2]?.operatorAuthorityId).toBe('auth_4');
  });
});
