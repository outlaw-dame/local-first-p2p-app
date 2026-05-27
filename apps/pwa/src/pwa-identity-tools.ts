import { type IdentityVerificationStatus } from '@lfp2p/local-store';

export function formatIdentityVerificationStatus(status: IdentityVerificationStatus): string {
  switch (status) {
    case 'controller-known':
      return 'Controller key verified from identity control projection.';
    case 'revoked-device-seen':
      return 'Controller key verified, with revoked devices present in projection history.';
    case 'mismatch-detected':
      return 'Controller key mismatch detected. Review trusted contact details before syncing sensitive data.';
    case 'unknown':
      return 'Controller key is not yet known for this identity.';
  }
}

export function identityVerificationBadgeColor(status: IdentityVerificationStatus): string {
  switch (status) {
    case 'controller-known':
      return 'green';
    case 'revoked-device-seen':
      return 'orange';
    case 'mismatch-detected':
      return 'red';
    case 'unknown':
      return 'gray';
  }
}