export const MLS_PROVIDER_VERSION = 'lfp2p.mls-provider.v1' as const;
export type MlsProviderVersion = typeof MLS_PROVIDER_VERSION;

export { MLS_ERROR_CODES, MlsProviderError, mlsError } from './errors.js';
export type { MlsErrorCode } from './errors.js';

export {
  decodeIdentityBinding,
  encodeIdentityBinding,
  identityBindingsEqual,
  MAX_CREDENTIAL_BYTES,
  MLS_CREDENTIAL_VERSION,
  validateIdentityBinding
} from './identity.js';
export type { MlsIdentityBinding } from './identity.js';

export { InMemoryMlsStateStore } from './store.js';
export type { MlsStateStore } from './store.js';

export { PINNED_CIPHERSUITE, TsMlsProvider } from './provider.js';
export type {
  GeneratedKeyPackage,
  MlsCommitResult,
  MlsEpochCheckpoint,
  MlsGroupActiveState,
  MlsProcessResult,
  MlsProviderConfig
} from './provider.js';
