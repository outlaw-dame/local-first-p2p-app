import type { BlockRef } from '@lfp2p/content-addressing';
import {
  MAX_BLOCK_BYTE_LENGTH,
  MAX_DECODED_BYTE_LENGTH,
  redactBlockRef,
  validateBlockRef,
  verifyDigest
} from '@lfp2p/content-addressing';
import type { BackoffConfig } from './backoff.js';
import { computeBackoffDelayMs, DEFAULT_BACKOFF, validateBackoffConfig } from './backoff.js';
import type { DecoderMap } from './decode.js';
import { decodeBlockBytes } from './decode.js';
import { bsError } from './errors.js';
import type { BlockFetcher, BlockFetchResult } from './fetcher.js';
import type { BreakerConfig } from './health.js';
import { DEFAULT_BREAKER, FetcherHealthTracker } from './health.js';

export type RetryConfig = BackoffConfig &
  Readonly<{
    /** Attempts per fetcher per request (1 = no retries). */
    maxAttemptsPerFetcher: number;
  }>;

export const DEFAULT_RETRY: RetryConfig = Object.freeze({
  ...DEFAULT_BACKOFF,
  maxAttemptsPerFetcher: 3
});

const MAX_ATTEMPTS_PER_FETCHER_LIMIT = 10;
const DEFAULT_MAX_BLOCK_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_DECODED_BYTES = 256 * 1024 * 1024;

export type BlockStoreConfig = Readonly<{
  /** Byte sources tried in order. Order expresses preference. */
  fetchers: ReadonlyArray<BlockFetcher>;
  /** Per-request cap on encoded block size. Never above protocol max. */
  maxBlockBytes?: number;
  /** Per-request cap on decoded block size. Never above protocol max. */
  maxDecodedBytes?: number;
  retry?: Partial<RetryConfig>;
  breaker?: BreakerConfig;
  /** Injected decoders for zstd/br; gzip and identity are native. */
  decoders?: DecoderMap;
  /** Injectable clock/randomness/sleep for deterministic tests. */
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}>;

export type FetchAttemptOutcome =
  | 'ok'
  | 'not-found'
  | 'transient-error'
  | 'length-mismatch'
  | 'digest-mismatch'
  | 'skipped-unhealthy';

/** Privacy-safe attempt record: fetcher id and outcome token only. */
export type FetchAttempt = Readonly<{
  fetcherId: string;
  outcome: FetchAttemptOutcome;
}>;

export type VerifiedBlock = Readonly<{
  ref: BlockRef;
  /**
   * Decoded (decompressed) bytes. If `encrypted` is true these are
   * ciphertext: the block store NEVER decrypts. Decryption belongs to
   * the layer holding the key referenced by `ref.encryption.keyRef`.
   */
  bytes: Uint8Array;
  digestVerified: true;
  encrypted: boolean;
  attempts: ReadonlyArray<FetchAttempt>;
}>;

export type GetBlockOptions = Readonly<{
  signal?: AbortSignal;
}>;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(bsError('BS_ABORTED', 'request aborted'));
      return;
    }
    if (ms <= 0) {
      resolve();
      return;
    }
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal !== undefined) {
      onAbort = () => {
        clearTimeout(timer);
        reject(bsError('BS_ABORTED', 'request aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw bsError('BS_ABORTED', 'request aborted');
  }
}

/**
 * Content-addressed block retrieval runtime (Phase 7.0).
 *
 * Enforces the fetch discipline required by the content-addressing and
 * encrypted-evidence specifications:
 *
 * ```txt
 * validate ref → cap (before fetch) → fetch → length check
 *   → verify digest (encoded bytes) → bounded decode
 * ```
 *
 * Guarantees:
 * - bytes are NEVER returned without digest verification; sources this
 *   runtime cannot verify fail closed (`BS_VERIFICATION_UNSUPPORTED`);
 * - encrypted blocks are returned as ciphertext — this layer has no
 *   access to keys and no decrypt path;
 * - a fetcher serving wrong-length or digest-mismatching bytes is not
 *   retried for the request (deterministic corruption), is penalized
 *   in health tracking, and the store falls through to the next
 *   fetcher — one poisoned source cannot deny retrieval;
 * - transient failures retry with capped exponential backoff and full
 *   jitter; persistent failures open a per-fetcher circuit breaker
 *   with escalating cooldown that self-heals via half-open probes;
 * - all diagnostics are privacy-safe (redacted refs, outcome tokens,
 *   no URLs, no upstream exception text).
 */
export class BlockStore {
  private readonly fetchers: ReadonlyArray<BlockFetcher>;
  private readonly maxBlockBytes: number;
  private readonly maxDecodedBytes: number;
  private readonly retry: RetryConfig;
  private readonly decoders: DecoderMap;
  private readonly health: FetcherHealthTracker;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(config: BlockStoreConfig) {
    if (!Array.isArray(config.fetchers) || config.fetchers.length === 0) {
      throw bsError('BS_INVALID_CONFIG', 'at least one fetcher is required');
    }
    const ids = new Set<string>();
    for (const fetcher of config.fetchers) {
      if (typeof fetcher.id !== 'string' || fetcher.id.length === 0) {
        throw bsError('BS_INVALID_CONFIG', 'every fetcher needs a non-empty string id');
      }
      if (ids.has(fetcher.id)) {
        throw bsError('BS_INVALID_CONFIG', `duplicate fetcher id "${fetcher.id}"`);
      }
      ids.add(fetcher.id);
    }
    this.fetchers = [...config.fetchers];

    const maxBlockBytes = config.maxBlockBytes ?? DEFAULT_MAX_BLOCK_BYTES;
    if (
      !Number.isInteger(maxBlockBytes) ||
      maxBlockBytes < 1 ||
      maxBlockBytes > MAX_BLOCK_BYTE_LENGTH
    ) {
      throw bsError(
        'BS_INVALID_CONFIG',
        `maxBlockBytes must be an integer in [1, ${MAX_BLOCK_BYTE_LENGTH}]`
      );
    }
    this.maxBlockBytes = maxBlockBytes;

    const maxDecodedBytes = config.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
    if (
      !Number.isInteger(maxDecodedBytes) ||
      maxDecodedBytes < maxBlockBytes ||
      maxDecodedBytes > MAX_DECODED_BYTE_LENGTH
    ) {
      throw bsError(
        'BS_INVALID_CONFIG',
        `maxDecodedBytes must be an integer in [maxBlockBytes, ${MAX_DECODED_BYTE_LENGTH}]`
      );
    }
    this.maxDecodedBytes = maxDecodedBytes;

    const retry: RetryConfig = { ...DEFAULT_RETRY, ...config.retry };
    validateBackoffConfig(retry);
    if (
      !Number.isInteger(retry.maxAttemptsPerFetcher) ||
      retry.maxAttemptsPerFetcher < 1 ||
      retry.maxAttemptsPerFetcher > MAX_ATTEMPTS_PER_FETCHER_LIMIT
    ) {
      throw bsError(
        'BS_INVALID_CONFIG',
        `retry.maxAttemptsPerFetcher must be an integer in [1, ${MAX_ATTEMPTS_PER_FETCHER_LIMIT}]`
      );
    }
    this.retry = retry;

    this.decoders = config.decoders ?? {};
    this.health = new FetcherHealthTracker(config.breaker ?? DEFAULT_BREAKER);
    this.now = config.now ?? (() => Date.now());
    this.random = config.random ?? (() => Math.random());
    this.sleep = config.sleep ?? defaultSleep;
  }

  async getBlock(refInput: unknown, options: GetBlockOptions = {}): Promise<VerifiedBlock> {
    const { signal } = options;
    throwIfAborted(signal);

    // Re-validate at retrieval time even if the caller claims to hold a
    // validated ref: refs cross trust boundaries (sync, mailbox,
    // reports) and this store is the last line before bytes are used.
    const ref = validateBlockRef(refInput);

    // Fail closed BEFORE fetching if we could not verify the result.
    if (ref.source.kind !== 'digest') {
      throw bsError(
        'BS_VERIFICATION_UNSUPPORTED',
        `cannot verify ${redactBlockRef(ref)}: content-link digest verification is not implemented in this runtime`
      );
    }
    if (ref.source.digest.algorithm === 'blake3') {
      throw bsError(
        'BS_VERIFICATION_UNSUPPORTED',
        `cannot verify ${redactBlockRef(ref)}: blake3 is fail-closed pending a vetted runtime (Phase 1.56)`
      );
    }

    // Encrypted blocks are compress-then-encrypt: the compression
    // descriptor describes the PLAINTEXT and can only be applied after
    // decryption. This store never decrypts, so for encrypted blocks it
    // treats the fetched bytes as opaque ciphertext — it neither applies
    // the plaintext-domain compression invariants (encodedSize would
    // describe compressed plaintext, not the ciphertext byteLength) nor
    // decodes them. The key-holding layer decrypts, then decompresses.
    const isEncrypted = ref.encryption !== undefined;

    // Caps are enforced before any bytes move.
    if (ref.byteLength > this.maxBlockBytes) {
      throw bsError(
        'BS_BYTE_CAP_EXCEEDED',
        `${redactBlockRef(ref)} exceeds maxBlockBytes ${this.maxBlockBytes}`
      );
    }
    if (!isEncrypted && ref.compression !== undefined) {
      if (ref.compression.encodedSize !== ref.byteLength) {
        throw bsError(
          'BS_INVALID_INPUT',
          `${redactBlockRef(ref)}: compression.encodedSize must equal byteLength`
        );
      }
      if (ref.compression.decodedSize > this.maxDecodedBytes) {
        throw bsError(
          'BS_DECODED_SIZE_EXCEEDED',
          `${redactBlockRef(ref)}: declared decodedSize exceeds maxDecodedBytes ${this.maxDecodedBytes}`
        );
      }
    }

    const sourceDigest = ref.source.digest;
    const attempts: FetchAttempt[] = [];

    for (const fetcher of this.fetchers) {
      if (!this.health.canAttempt(fetcher.id, this.now())) {
        attempts.push({ fetcherId: fetcher.id, outcome: 'skipped-unhealthy' });
        continue;
      }

      perFetcher: for (let attempt = 0; attempt < this.retry.maxAttemptsPerFetcher; attempt += 1) {
        throwIfAborted(signal);

        let result: BlockFetchResult;
        try {
          // Only attach `signal` when present: exactOptionalPropertyTypes
          // forbids an explicit `signal: undefined`.
          const request = signal === undefined ? { ref } : { ref, signal };
          result = await fetcher.fetchBlock(request);
        } catch {
          // Exception text is discarded: it may contain URLs,
          // credentials, or storage-layer details we must not surface.
          result = { outcome: 'transient-error', reason: 'fetcher-threw' };
        }
        throwIfAborted(signal);

        // A misbehaving fetcher may resolve with a non-conforming value
        // (null, undefined, wrong shape) instead of throwing. Treat that
        // as a transient failure rather than dereferencing it and
        // crashing the whole retrieval.
        if (
          result === null ||
          typeof result !== 'object' ||
          typeof (result as { outcome?: unknown }).outcome !== 'string'
        ) {
          this.health.recordFailure(fetcher.id, this.now());
          attempts.push({ fetcherId: fetcher.id, outcome: 'transient-error' });
          const isLastAttempt = attempt === this.retry.maxAttemptsPerFetcher - 1;
          if (isLastAttempt || !this.health.canAttempt(fetcher.id, this.now())) {
            break perFetcher;
          }
          await this.sleep(computeBackoffDelayMs(attempt, this.retry, this.random), signal);
          continue;
        }

        if (result.outcome === 'not-found') {
          // Definitive, healthy answer — not a failure.
          this.health.recordSuccess(fetcher.id);
          attempts.push({ fetcherId: fetcher.id, outcome: 'not-found' });
          break perFetcher;
        }

        if (result.outcome === 'transient-error') {
          this.health.recordFailure(fetcher.id, this.now());
          attempts.push({ fetcherId: fetcher.id, outcome: 'transient-error' });
          const isLastAttempt = attempt === this.retry.maxAttemptsPerFetcher - 1;
          // If the breaker just opened, stop hammering this fetcher.
          if (isLastAttempt || !this.health.canAttempt(fetcher.id, this.now())) {
            break perFetcher;
          }
          await this.sleep(computeBackoffDelayMs(attempt, this.retry, this.random), signal);
          continue;
        }

        // outcome === 'ok': verify before trusting anything.
        if (!(result.bytes instanceof Uint8Array) || result.bytes.byteLength !== ref.byteLength) {
          // Deterministic corruption — retrying the same source would
          // return the same wrong bytes. Penalize and move on.
          this.health.recordFailure(fetcher.id, this.now());
          attempts.push({ fetcherId: fetcher.id, outcome: 'length-mismatch' });
          break perFetcher;
        }
        // Take an owned copy at the trust boundary before hashing: a
        // fetcher that reuses or mutates its buffer after resolving must
        // not be able to change the bytes we verify and return. Every
        // downstream path (verify, decode, return) uses this copy, so
        // VerifiedBlock.bytes is always store-owned.
        const bytes = result.bytes.slice();
        const digestOk = await verifyDigest(bytes, sourceDigest);
        if (!digestOk) {
          this.health.recordFailure(fetcher.id, this.now());
          attempts.push({ fetcherId: fetcher.id, outcome: 'digest-mismatch' });
          break perFetcher;
        }

        this.health.recordSuccess(fetcher.id);
        attempts.push({ fetcherId: fetcher.id, outcome: 'ok' });
        // Ciphertext is returned untouched (see isEncrypted note above);
        // only cleartext blocks are decompressed here.
        const decoded = isEncrypted
          ? bytes
          : await decodeBlockBytes(bytes, ref.compression, this.decoders);
        return Object.freeze({
          ref,
          bytes: decoded,
          digestVerified: true as const,
          encrypted: isEncrypted,
          attempts: Object.freeze(attempts.map((a) => Object.freeze(a)))
        });
      }
    }

    const summary = attempts.map((a) => `${a.fetcherId}=${a.outcome}`).join(', ');
    throw bsError(
      'BS_BLOCK_UNAVAILABLE',
      `${redactBlockRef(ref)} unavailable after trying all fetchers (${summary || 'none eligible'})`
    );
  }

  /** Privacy-safe breaker snapshot for diagnostics surfaces. */
  fetcherHealth(fetcherId: string): Readonly<{ open: boolean; trips: number }> {
    return this.health.snapshot(fetcherId);
  }
}
