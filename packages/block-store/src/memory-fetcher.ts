import type { ComputableHashAlgorithm, DigestRef } from '@lfp2p/content-addressing';
import { createDigest, MAX_BLOCK_BYTE_LENGTH } from '@lfp2p/content-addressing';
import { bsError } from './errors.js';
import type { BlockFetcher, BlockFetchRequest, BlockFetchResult } from './fetcher.js';

export type MemoryBlockStoreConfig = Readonly<{
  id?: string;
  /** Per-block cap. Defaults to 32 MiB; never above the protocol max. */
  maxBlockBytes?: number;
  /** Total cache budget. Oldest-accessed entries are evicted to fit. */
  maxTotalBytes?: number;
}>;

const DEFAULT_MAX_BLOCK_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

function cacheKey(ref: DigestRef): string {
  return `${ref.algorithm}:${ref.digest}`;
}

/**
 * In-memory content-addressed block cache, usable both as a writable
 * local store and as a `BlockFetcher` in a BlockStore fetcher chain.
 *
 * Integrity and isolation properties:
 * - `put` computes the digest itself; callers cannot claim a digest
 *   for bytes that do not hash to it.
 * - Bytes are defensively copied on `put` and on every read so no
 *   caller can mutate cached content after the fact (cache poisoning
 *   via shared references).
 * - Bounded by total bytes with least-recently-used eviction, so an
 *   adversarial workload cannot exhaust memory.
 */
export class MemoryBlockStore implements BlockFetcher {
  public readonly id: string;
  private readonly maxBlockBytes: number;
  private readonly maxTotalBytes: number;
  /** Map iteration order doubles as the LRU order (oldest first). */
  private readonly blocks = new Map<string, Uint8Array>();
  private total = 0;

  constructor(config: MemoryBlockStoreConfig = {}) {
    this.id = config.id ?? 'memory';
    if (this.id.length === 0) {
      throw bsError('BS_INVALID_CONFIG', 'MemoryBlockStore id must be non-empty');
    }
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
    const maxTotalBytes = config.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    if (!Number.isInteger(maxTotalBytes) || maxTotalBytes < maxBlockBytes) {
      throw bsError('BS_INVALID_CONFIG', 'maxTotalBytes must be an integer >= maxBlockBytes');
    }
    this.maxBlockBytes = maxBlockBytes;
    this.maxTotalBytes = maxTotalBytes;
  }

  get totalBytes(): number {
    return this.total;
  }

  /**
   * Store bytes and return the computed DigestRef. Rejects oversized
   * blocks; evicts least-recently-used entries until the new block
   * fits the total budget.
   */
  async put(bytes: Uint8Array, algorithm: ComputableHashAlgorithm = 'sha-256'): Promise<DigestRef> {
    if (!(bytes instanceof Uint8Array)) {
      throw bsError('BS_INVALID_INPUT', 'put() requires a Uint8Array');
    }
    if (bytes.byteLength > this.maxBlockBytes) {
      throw bsError(
        'BS_BYTE_CAP_EXCEEDED',
        `block of ${bytes.byteLength} bytes exceeds maxBlockBytes ${this.maxBlockBytes}`
      );
    }
    const digest = await createDigest(bytes, algorithm);
    const key = cacheKey(digest);
    const existing = this.blocks.get(key);
    if (existing !== undefined) {
      // Same digest ⇒ same content; refresh LRU position only.
      this.blocks.delete(key);
      this.blocks.set(key, existing);
      return digest;
    }
    while (this.total + bytes.byteLength > this.maxTotalBytes && this.blocks.size > 0) {
      const oldestKey: string = this.blocks.keys().next().value as string;
      const evicted = this.blocks.get(oldestKey) as Uint8Array;
      this.blocks.delete(oldestKey);
      this.total -= evicted.byteLength;
    }
    this.blocks.set(key, bytes.slice());
    this.total += bytes.byteLength;
    return digest;
  }

  /** Remove a block (e.g. after it served digest-mismatching bytes). */
  delete(digest: DigestRef): boolean {
    const key = cacheKey(digest);
    const existing = this.blocks.get(key);
    if (existing === undefined) return false;
    this.blocks.delete(key);
    this.total -= existing.byteLength;
    return true;
  }

  has(digest: DigestRef): boolean {
    return this.blocks.has(cacheKey(digest));
  }

  fetchBlock(request: BlockFetchRequest): Promise<BlockFetchResult> {
    const { source } = request.ref;
    if (source.kind !== 'digest') {
      return Promise.resolve({ outcome: 'not-found' as const });
    }
    const key = cacheKey(source.digest);
    const bytes = this.blocks.get(key);
    if (bytes === undefined) {
      return Promise.resolve({ outcome: 'not-found' as const });
    }
    // Refresh LRU position on read.
    this.blocks.delete(key);
    this.blocks.set(key, bytes);
    return Promise.resolve({ outcome: 'ok' as const, bytes: bytes.slice() });
  }
}
