import { describe, expect, it } from 'vitest';
import { formatIdentityVerificationStatus, identityVerificationBadgeColor } from './pwa-identity-tools.js';

describe('PWA identity tools', () => {
  it('formats identity verification statuses for user-facing text', () => {
    expect(formatIdentityVerificationStatus('unknown')).toMatch(/not yet known/i);
    expect(formatIdentityVerificationStatus('controller-known')).toMatch(/verified/i);
    expect(formatIdentityVerificationStatus('revoked-device-seen')).toMatch(/revoked devices/i);
    expect(formatIdentityVerificationStatus('mismatch-detected')).toMatch(/mismatch detected/i);
  });

  it('maps verification statuses to stable badge colors', () => {
    expect(identityVerificationBadgeColor('unknown')).toBe('gray');
    expect(identityVerificationBadgeColor('controller-known')).toBe('green');
    expect(identityVerificationBadgeColor('revoked-device-seen')).toBe('orange');
    expect(identityVerificationBadgeColor('mismatch-detected')).toBe('red');
  });
});