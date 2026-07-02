import type { BlockRef } from '@lfp2p/content-addressing';

/**
 * A single attempt outcome reported by a fetcher.
 *
 * - `ok`: bytes were produced. They are NOT trusted yet — the store
 *   verifies length and digest before anything downstream sees them.
 * - `not-found`: the fetcher definitively does not have the block.
 *   This is not a fetcher failure and is never retried on the same
 *   fetcher for the same request.
 * - `transient-error`: a retryable condition (timeout, connection
 *   reset, throttling). The store applies bounded exponential backoff
 *   before retrying and records the failure against fetcher health.
 *   `reason` must be privacy-safe: a short stable token, never URLs,
 *   credentials, digests, or upstream exception text.
 */
export type BlockFetchResult =
  | Readonly<{ outcome: 'ok'; bytes: Uint8Array }>
  | Readonly<{ outcome: 'not-found' }>
  | Readonly<{ outcome: 'transient-error'; reason: string }>;

export type BlockFetchRequest = Readonly<{
  ref: BlockRef;
  signal?: AbortSignal;
}>;

/**
 * A byte source for content-addressed blocks. Fetchers move bytes and
 * nothing else: they hold no authority, never decrypt, and their output
 * is always digest-verified by the store before use. A fetcher that
 * throws is treated as a transient error (with the exception text
 * discarded, since it may contain URLs or credentials).
 */
export interface BlockFetcher {
  /** Stable identifier used in diagnostics and health tracking. */
  readonly id: string;
  fetchBlock(request: BlockFetchRequest): Promise<BlockFetchResult>;
}
