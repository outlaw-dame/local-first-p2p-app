export const BLOCK_STORE_VERSION = 'lfp2p.block-store.v1' as const;
export type BlockStoreVersion = typeof BLOCK_STORE_VERSION;

export { BS_ERROR_CODES, BlockStoreError, bsError } from './errors.js';
export type { BSErrorCode } from './errors.js';

export type { BlockFetcher, BlockFetchRequest, BlockFetchResult } from './fetcher.js';

export { computeBackoffDelayMs, DEFAULT_BACKOFF, validateBackoffConfig } from './backoff.js';
export type { BackoffConfig } from './backoff.js';

export { DEFAULT_BREAKER, FetcherHealthTracker, validateBreakerConfig } from './health.js';
export type { BreakerConfig } from './health.js';

export { decodeBlockBytes } from './decode.js';
export type { BoundedDecoder, DecoderMap } from './decode.js';

export { MemoryBlockStore } from './memory-fetcher.js';
export type { MemoryBlockStoreConfig } from './memory-fetcher.js';

export { BlockStore, DEFAULT_RETRY } from './block-store.js';
export type {
  BlockStoreConfig,
  FetchAttempt,
  FetchAttemptOutcome,
  GetBlockOptions,
  RetryConfig,
  VerifiedBlock
} from './block-store.js';
