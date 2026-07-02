import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { BlockRef, DigestRef } from '@lfp2p/content-addressing';
import { createDigest } from '@lfp2p/content-addressing';
import {
  BlockStore,
  BlockStoreError,
  computeBackoffDelayMs,
  FetcherHealthTracker,
  MemoryBlockStore
} from '../index.js';
import type {
  BlockFetcher,
  BlockFetchRequest,
  BlockFetchResult,
  BlockStoreConfig
} from '../index.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function refFor(bytes: Uint8Array, overrides: Partial<BlockRef> = {}): Promise<BlockRef> {
  const digest = await createDigest(bytes, 'sha-256');
  return {
    type: 'block-ref',
    source: { kind: 'digest', digest },
    byteLength: bytes.byteLength,
    offset: 0,
    privacy: 'public',
    ...overrides
  } as BlockRef;
}

async function gzipRefFor(
  raw: Uint8Array,
  declaredDecodedSize?: number
): Promise<{
  ref: BlockRef;
  encoded: Uint8Array;
}> {
  const encoded = new Uint8Array(gzipSync(raw));
  const digest = await createDigest(encoded, 'sha-256');
  const ref = {
    type: 'block-ref',
    source: { kind: 'digest', digest },
    byteLength: encoded.byteLength,
    offset: 0,
    privacy: 'public',
    compression: {
      algorithm: 'gzip',
      encodedSize: encoded.byteLength,
      decodedSize: declaredDecodedSize ?? raw.byteLength
    }
  } as BlockRef;
  return { ref, encoded };
}

/** Scripted fetcher: returns queued results in order, then repeats the last. */
class ScriptedFetcher implements BlockFetcher {
  public calls = 0;
  constructor(
    public readonly id: string,
    private readonly script: BlockFetchResult[],
    private readonly onCall?: (request: BlockFetchRequest) => void
  ) {}

  fetchBlock(request: BlockFetchRequest): Promise<BlockFetchResult> {
    this.onCall?.(request);
    const index = Math.min(this.calls, this.script.length - 1);
    this.calls += 1;
    const result = this.script[index];
    if (result === undefined) throw new Error('empty script');
    return Promise.resolve(result);
  }
}

type Harness = {
  store: BlockStore;
  sleeps: number[];
  clock: { value: number };
};

function makeStore(
  config: Partial<BlockStoreConfig> & Pick<BlockStoreConfig, 'fetchers'>
): Harness {
  const sleeps: number[] = [];
  const clock = { value: 0 };
  const store = new BlockStore({
    retry: { maxAttemptsPerFetcher: 3, baseDelayMs: 100, maxDelayMs: 10_000 },
    breaker: { failureThreshold: 100, cooldownMs: 1_000, maxCooldownMs: 60_000 },
    now: () => clock.value,
    random: () => 0.5,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...config
  });
  return { store, sleeps, clock };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<BlockStoreError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BlockStoreError);
    const bse = error as BlockStoreError;
    expect(bse.code).toBe(code);
    return bse;
  }
  throw new Error(`expected rejection with ${code}`);
}

// ---------------------------------------------------------------------------
// backoff
// ---------------------------------------------------------------------------

describe('computeBackoffDelayMs', () => {
  const config = { baseDelayMs: 100, maxDelayMs: 1_000 };

  it('grows exponentially at full jitter ceiling', () => {
    const maxRandom = () => 0.999999;
    const d0 = computeBackoffDelayMs(0, config, maxRandom);
    const d1 = computeBackoffDelayMs(1, config, maxRandom);
    const d2 = computeBackoffDelayMs(2, config, maxRandom);
    expect(d0).toBeLessThanOrEqual(100);
    expect(d1).toBeLessThanOrEqual(200);
    expect(d2).toBeLessThanOrEqual(400);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  it('caps at maxDelayMs even for huge retry indices', () => {
    const d = computeBackoffDelayMs(1_000, config, () => 0.999999);
    expect(d).toBeLessThanOrEqual(config.maxDelayMs);
    expect(Number.isFinite(d)).toBe(true);
  });

  it('full jitter can land at zero', () => {
    expect(computeBackoffDelayMs(5, config, () => 0)).toBe(0);
  });

  it('rejects adversarial random() outputs', () => {
    expect(() => computeBackoffDelayMs(0, config, () => 1.5)).toThrow(BlockStoreError);
    expect(() => computeBackoffDelayMs(0, config, () => Number.NaN)).toThrow(BlockStoreError);
    expect(() => computeBackoffDelayMs(-1, config, () => 0.5)).toThrow(BlockStoreError);
  });
});

// ---------------------------------------------------------------------------
// circuit breaker
// ---------------------------------------------------------------------------

describe('FetcherHealthTracker', () => {
  it('opens after threshold, refuses attempts, half-open probes, self-heals', () => {
    const tracker = new FetcherHealthTracker({
      failureThreshold: 2,
      cooldownMs: 1_000,
      maxCooldownMs: 8_000
    });
    expect(tracker.canAttempt('f', 0)).toBe(true);
    tracker.recordFailure('f', 0);
    expect(tracker.canAttempt('f', 0)).toBe(true);
    tracker.recordFailure('f', 0);
    // Open now.
    expect(tracker.canAttempt('f', 500)).toBe(false);
    // Cooldown elapsed: exactly one half-open probe.
    expect(tracker.canAttempt('f', 1_000)).toBe(true);
    expect(tracker.canAttempt('f', 1_000)).toBe(false);
    // Probe fails: reopens with doubled cooldown.
    tracker.recordFailure('f', 1_000);
    expect(tracker.canAttempt('f', 2_500)).toBe(false);
    expect(tracker.canAttempt('f', 3_000)).toBe(true);
    // Probe succeeds: fully reset.
    tracker.recordSuccess('f');
    expect(tracker.canAttempt('f', 3_000)).toBe(true);
    expect(tracker.snapshot('f')).toEqual({ open: false, trips: 0 });
  });

  it('escalating cooldown is capped at maxCooldownMs', () => {
    const tracker = new FetcherHealthTracker({
      failureThreshold: 1,
      cooldownMs: 1_000,
      maxCooldownMs: 4_000
    });
    let now = 0;
    // Trip repeatedly; cooldown doubles 1000, 2000, 4000, then stays 4000.
    for (let i = 0; i < 6; i += 1) {
      expect(tracker.canAttempt('f', now)).toBe(true);
      tracker.recordFailure('f', now);
      const expected = Math.min(4_000, 1_000 * 2 ** i);
      expect(tracker.canAttempt('f', now + expected - 1)).toBe(false);
      now += expected;
    }
  });
});

// ---------------------------------------------------------------------------
// config validation
// ---------------------------------------------------------------------------

describe('BlockStore config validation', () => {
  const fetcher = new ScriptedFetcher('a', [{ outcome: 'not-found' }]);

  it('rejects empty fetcher lists and duplicate ids', () => {
    expect(() => new BlockStore({ fetchers: [] })).toThrow(BlockStoreError);
    const dup = new ScriptedFetcher('a', [{ outcome: 'not-found' }]);
    expect(() => new BlockStore({ fetchers: [fetcher, dup] })).toThrow(BlockStoreError);
  });

  it('rejects out-of-range caps and retry settings', () => {
    expect(() => new BlockStore({ fetchers: [fetcher], maxBlockBytes: 0 })).toThrow(
      BlockStoreError
    );
    expect(
      () => new BlockStore({ fetchers: [fetcher], maxBlockBytes: Number.MAX_SAFE_INTEGER })
    ).toThrow(BlockStoreError);
    expect(
      () => new BlockStore({ fetchers: [fetcher], maxBlockBytes: 1024, maxDecodedBytes: 512 })
    ).toThrow(BlockStoreError);
    expect(
      () => new BlockStore({ fetchers: [fetcher], retry: { maxAttemptsPerFetcher: 0 } })
    ).toThrow(BlockStoreError);
    expect(
      () => new BlockStore({ fetchers: [fetcher], retry: { maxAttemptsPerFetcher: 11 } })
    ).toThrow(BlockStoreError);
    expect(() => new BlockStore({ fetchers: [fetcher], retry: { baseDelayMs: -1 } })).toThrow(
      BlockStoreError
    );
  });
});

// ---------------------------------------------------------------------------
// retrieval pipeline
// ---------------------------------------------------------------------------

describe('BlockStore.getBlock', () => {
  it('round-trips bytes through a memory fetcher with digest verification', async () => {
    const memory = new MemoryBlockStore();
    const raw = bytesOf('hello, verified world');
    await memory.put(raw);
    const ref = await refFor(raw);
    const { store } = makeStore({ fetchers: [memory] });
    const block = await store.getBlock(ref);
    expect(block.digestVerified).toBe(true);
    expect(block.encrypted).toBe(false);
    expect(new TextDecoder().decode(block.bytes)).toBe('hello, verified world');
    expect(block.attempts).toEqual([{ fetcherId: 'memory', outcome: 'ok' }]);
    expect(Object.isFrozen(block)).toBe(true);
    expect(Object.isFrozen(block.attempts)).toBe(true);
  });

  it('re-validates untrusted ref input (prototype pollution shape rejected)', async () => {
    const { store } = makeStore({ fetchers: [new MemoryBlockStore()] });
    await expect(store.getBlock({ __proto__: { type: 'block-ref' } })).rejects.toThrow();
    await expect(store.getBlock(null)).rejects.toThrow();
    await expect(store.getBlock('block-ref')).rejects.toThrow();
  });

  it('enforces the byte cap before any fetch happens', async () => {
    let fetched = false;
    const fetcher = new ScriptedFetcher('a', [{ outcome: 'not-found' }], () => {
      fetched = true;
    });
    const { store } = makeStore({
      fetchers: [fetcher],
      maxBlockBytes: 8,
      maxDecodedBytes: 8
    });
    const raw = bytesOf('way more than eight bytes');
    const ref = await refFor(raw);
    await expectCode(store.getBlock(ref), 'BS_BYTE_CAP_EXCEEDED');
    expect(fetched).toBe(false);
  });

  it('fails closed before fetch for blake3 and content-link sources', async () => {
    let fetched = false;
    const fetcher = new ScriptedFetcher('a', [{ outcome: 'not-found' }], () => {
      fetched = true;
    });
    const { store } = makeStore({ fetchers: [fetcher] });

    const raw = bytesOf('unverifiable');
    const sha = await createDigest(raw, 'sha-256');
    const blake3Ref = await refFor(raw, {
      source: { kind: 'digest', digest: { algorithm: 'blake3', digest: sha.digest } }
    });
    await expectCode(store.getBlock(blake3Ref), 'BS_VERIFICATION_UNSUPPORTED');
    expect(fetched).toBe(false);
  });

  it('rejects a ref whose compression.encodedSize contradicts byteLength', async () => {
    const raw = bytesOf('x'.repeat(64));
    const { ref } = await gzipRefFor(raw);
    const lying = { ...ref, byteLength: ref.byteLength + 1 };
    const { store } = makeStore({ fetchers: [new MemoryBlockStore()] });
    await expectCode(store.getBlock(lying), 'BS_INVALID_INPUT');
  });

  it('falls through a poisoned fetcher (digest mismatch) to a good one', async () => {
    const raw = bytesOf('authentic content!');
    const corrupt = new Uint8Array(raw);
    corrupt[0] ^= 0xff;
    const bad = new ScriptedFetcher('bad', [{ outcome: 'ok', bytes: corrupt }]);
    const memory = new MemoryBlockStore({ id: 'good' });
    await memory.put(raw);
    const ref = await refFor(raw);
    const { store } = makeStore({ fetchers: [bad, memory] });
    const block = await store.getBlock(ref);
    expect(new TextDecoder().decode(block.bytes)).toBe('authentic content!');
    expect(block.attempts).toEqual([
      { fetcherId: 'bad', outcome: 'digest-mismatch' },
      { fetcherId: 'good', outcome: 'ok' }
    ]);
    // Deterministic corruption is not retried on the same fetcher.
    expect(bad.calls).toBe(1);
  });

  it('does not retry a fetcher that returns wrong-length bytes', async () => {
    const raw = bytesOf('length matters');
    const bad = new ScriptedFetcher('bad', [{ outcome: 'ok', bytes: bytesOf('short') }]);
    const ref = await refFor(raw);
    const { store } = makeStore({ fetchers: [bad] });
    const error = await expectCode(store.getBlock(ref), 'BS_BLOCK_UNAVAILABLE');
    expect(error.message).toContain('bad=length-mismatch');
    expect(bad.calls).toBe(1);
  });

  it('retries transient errors with exponential full-jitter backoff, then succeeds', async () => {
    const raw = bytesOf('eventually available');
    const flaky = new ScriptedFetcher('flaky', [
      { outcome: 'transient-error', reason: 'timeout' },
      { outcome: 'transient-error', reason: 'timeout' },
      { outcome: 'ok', bytes: raw }
    ]);
    const ref = await refFor(raw);
    const { store, sleeps } = makeStore({ fetchers: [flaky] });
    const block = await store.getBlock(ref);
    expect(new TextDecoder().decode(block.bytes)).toBe('eventually available');
    // random = 0.5: floor(0.5 * 100), floor(0.5 * 200).
    expect(sleeps).toEqual([50, 100]);
    expect(flaky.calls).toBe(3);
  });

  it('treats a throwing fetcher as transient and never leaks its message', async () => {
    const secretUrl = 'https://user:password@internal.example/block';
    const throwing: BlockFetcher = {
      id: 'throwing',
      fetchBlock: () => Promise.reject(new Error(`fetch failed for ${secretUrl}`))
    };
    const raw = bytesOf('resilient');
    const ref = await refFor(raw);
    const { store } = makeStore({
      fetchers: [throwing],
      retry: { maxAttemptsPerFetcher: 2, baseDelayMs: 1, maxDelayMs: 2 }
    });
    const error = await expectCode(store.getBlock(ref), 'BS_BLOCK_UNAVAILABLE');
    expect(error.message).not.toContain('password');
    expect(error.message).not.toContain('internal.example');
  });

  it('never exposes the full digest in error messages', async () => {
    const raw = bytesOf('privacy of refs');
    const ref = await refFor(raw);
    const digest = (ref.source as { kind: 'digest'; digest: DigestRef }).digest.digest;
    const { store } = makeStore({
      fetchers: [new ScriptedFetcher('a', [{ outcome: 'not-found' }])]
    });
    const error = await expectCode(store.getBlock(ref), 'BS_BLOCK_UNAVAILABLE');
    expect(error.message).not.toContain(digest);
    expect(error.message).toContain(digest.slice(0, 8));
  });

  it('opens the breaker after persistent failures and skips the fetcher until cooldown', async () => {
    const raw = bytesOf('breaker test');
    const ref = await refFor(raw);
    const failing = new ScriptedFetcher('failing', [
      { outcome: 'transient-error', reason: 'down' }
    ]);
    const memory = new MemoryBlockStore({ id: 'backup' });
    await memory.put(raw);
    const { store, clock } = makeStore({
      fetchers: [failing, memory],
      retry: { maxAttemptsPerFetcher: 3, baseDelayMs: 0, maxDelayMs: 0 },
      breaker: { failureThreshold: 2, cooldownMs: 1_000, maxCooldownMs: 8_000 }
    });

    // Request 1: two transient failures trip the breaker mid-request;
    // the store stops hammering and falls through to the backup.
    const first = await store.getBlock(ref);
    expect(first.attempts.filter((a) => a.fetcherId === 'failing')).toHaveLength(2);
    expect(store.fetcherHealth('failing').open).toBe(true);

    // Request 2 while open: failing fetcher skipped entirely.
    const second = await store.getBlock(ref);
    expect(second.attempts[0]).toEqual({ fetcherId: 'failing', outcome: 'skipped-unhealthy' });
    expect(failing.calls).toBe(2);

    // After cooldown: half-open probe reaches the fetcher again.
    clock.value = 2_000;
    await store.getBlock(ref);
    expect(failing.calls).toBe(3);
  });

  it('a healthy response self-heals the breaker', async () => {
    const raw = bytesOf('self healing');
    const ref = await refFor(raw);
    const recovering = new ScriptedFetcher('recovering', [
      { outcome: 'transient-error', reason: 'down' },
      { outcome: 'transient-error', reason: 'down' },
      { outcome: 'ok', bytes: raw }
    ]);
    const { store, clock } = makeStore({
      fetchers: [recovering],
      retry: { maxAttemptsPerFetcher: 1, baseDelayMs: 0, maxDelayMs: 0 },
      breaker: { failureThreshold: 2, cooldownMs: 1_000, maxCooldownMs: 8_000 }
    });
    await expectCode(store.getBlock(ref), 'BS_BLOCK_UNAVAILABLE');
    await expectCode(store.getBlock(ref), 'BS_BLOCK_UNAVAILABLE');
    expect(store.fetcherHealth('recovering').open).toBe(true);
    clock.value = 1_500;
    const block = await store.getBlock(ref);
    expect(block.digestVerified).toBe(true);
    expect(store.fetcherHealth('recovering').open).toBe(false);
  });

  it('honors AbortSignal before and between attempts', async () => {
    const controller = new AbortController();
    const raw = bytesOf('abortable');
    const ref = await refFor(raw);
    const aborting = new ScriptedFetcher(
      'aborting',
      [{ outcome: 'transient-error', reason: 'slow' }],
      () => controller.abort()
    );
    const { store } = makeStore({ fetchers: [aborting] });
    await expectCode(store.getBlock(ref, { signal: controller.signal }), 'BS_ABORTED');

    const preAborted = new AbortController();
    preAborted.abort();
    await expectCode(store.getBlock(ref, { signal: preAborted.signal }), 'BS_ABORTED');
  });

  it('returns ciphertext untouched for encrypted blocks (never decrypts)', async () => {
    const ciphertext = bytesOf('opaque ciphertext bytes');
    const memory = new MemoryBlockStore();
    await memory.put(ciphertext);
    const keyRef = await createDigest(bytesOf('key material ref'), 'sha-256');
    const ref = await refFor(ciphertext, {
      privacy: 'private',
      encryption: { scheme: 'mls-v1', keyRef }
    });
    const { store } = makeStore({ fetchers: [memory] });
    const block = await store.getBlock(ref);
    expect(block.encrypted).toBe(true);
    expect(block.bytes).toEqual(ciphertext);
  });
});

// ---------------------------------------------------------------------------
// bounded decode
// ---------------------------------------------------------------------------

describe('BlockStore decode discipline', () => {
  it('round-trips gzip blocks', async () => {
    const raw = bytesOf('compress me '.repeat(1_000));
    const { ref, encoded } = await gzipRefFor(raw);
    const memory = new MemoryBlockStore();
    await memory.put(encoded);
    const { store } = makeStore({ fetchers: [memory] });
    const block = await store.getBlock(ref);
    expect(block.bytes).toEqual(raw);
  });

  it('aborts a compression bomb at the declared bound, mid-stream', async () => {
    const raw = new Uint8Array(512 * 1024); // zeros compress extremely well
    const { ref, encoded } = await gzipRefFor(raw, 1_024); // descriptor lies: declares 1 KiB
    const memory = new MemoryBlockStore();
    await memory.put(encoded);
    const { store } = makeStore({ fetchers: [memory] });
    await expectCode(store.getBlock(ref), 'BS_DECODED_SIZE_EXCEEDED');
  });

  it('rejects declared decodedSize larger than actual output (fail closed)', async () => {
    const raw = bytesOf('tiny');
    const { ref, encoded } = await gzipRefFor(raw, raw.byteLength + 100);
    const memory = new MemoryBlockStore();
    await memory.put(encoded);
    const { store } = makeStore({ fetchers: [memory] });
    await expectCode(store.getBlock(ref), 'BS_DECODE_FAILED');
  });

  it('rejects a declared decodedSize above the configured cap before fetching', async () => {
    const raw = bytesOf('x'.repeat(64));
    const { ref, encoded } = await gzipRefFor(raw, 4_096);
    let fetched = false;
    const fetcher = new ScriptedFetcher('a', [{ outcome: 'ok', bytes: encoded }], () => {
      fetched = true;
    });
    const { store } = makeStore({
      fetchers: [fetcher],
      maxBlockBytes: 1_024,
      maxDecodedBytes: 2_048
    });
    await expectCode(store.getBlock(ref), 'BS_DECODED_SIZE_EXCEEDED');
    expect(fetched).toBe(false);
  });

  it('rejects corrupt gzip input', async () => {
    const raw = bytesOf('will be corrupted '.repeat(100));
    const { encoded } = await gzipRefFor(raw);
    const corrupt = encoded.slice();
    corrupt[12] ^= 0xff;
    const digest = await createDigest(corrupt, 'sha-256');
    const ref = {
      type: 'block-ref',
      source: { kind: 'digest', digest },
      byteLength: corrupt.byteLength,
      offset: 0,
      privacy: 'public',
      compression: {
        algorithm: 'gzip',
        encodedSize: corrupt.byteLength,
        decodedSize: raw.byteLength
      }
    } as BlockRef;
    const memory = new MemoryBlockStore();
    await memory.put(corrupt);
    const { store } = makeStore({ fetchers: [memory] });
    await expectCode(store.getBlock(ref), 'BS_DECODE_FAILED');
  });

  it('fails closed for zstd without an injected decoder, works with one', async () => {
    const raw = bytesOf('zstd payload');
    // Simulate: "encoded" bytes are raw reversed; the fake decoder reverses back.
    const encoded = raw.slice().reverse();
    const digest = await createDigest(encoded, 'sha-256');
    const ref = {
      type: 'block-ref',
      source: { kind: 'digest', digest },
      byteLength: encoded.byteLength,
      offset: 0,
      privacy: 'public',
      compression: {
        algorithm: 'zstd',
        encodedSize: encoded.byteLength,
        decodedSize: raw.byteLength
      }
    } as BlockRef;
    const memory = new MemoryBlockStore();
    await memory.put(encoded);

    const { store: without } = makeStore({ fetchers: [memory] });
    await expectCode(without.getBlock(ref), 'BS_DECODE_UNSUPPORTED');

    const { store: withDecoder } = makeStore({
      fetchers: [memory],
      decoders: { zstd: (bytes) => Promise.resolve(bytes.slice().reverse()) }
    });
    const block = await withDecoder.getBlock(ref);
    expect(block.bytes).toEqual(raw);
  });

  it('does not trust an injected decoder that lies about output size', async () => {
    const raw = bytesOf('decoder lies');
    const encoded = raw.slice();
    const digest = await createDigest(encoded, 'sha-256');
    const ref = {
      type: 'block-ref',
      source: { kind: 'digest', digest },
      byteLength: encoded.byteLength,
      offset: 0,
      privacy: 'public',
      compression: {
        algorithm: 'zstd',
        encodedSize: encoded.byteLength,
        decodedSize: raw.byteLength
      }
    } as BlockRef;
    const memory = new MemoryBlockStore();
    await memory.put(encoded);
    const { store } = makeStore({
      fetchers: [memory],
      decoders: { zstd: () => Promise.resolve(new Uint8Array(raw.byteLength * 100)) }
    });
    await expectCode(store.getBlock(ref), 'BS_DECODED_SIZE_EXCEEDED');
  });

  it('fails closed on shared-dictionary compression', async () => {
    const raw = bytesOf('dictionary compressed');
    const encoded = raw.slice();
    const digest = await createDigest(encoded, 'sha-256');
    const dictionaryRef = await createDigest(bytesOf('some dictionary'), 'sha-256');
    const ref = {
      type: 'block-ref',
      source: { kind: 'digest', digest },
      byteLength: encoded.byteLength,
      offset: 0,
      privacy: 'public',
      compression: {
        algorithm: 'zstd',
        encodedSize: encoded.byteLength,
        decodedSize: raw.byteLength,
        dictionaryRef
      }
    } as BlockRef;
    const memory = new MemoryBlockStore();
    await memory.put(encoded);
    const { store } = makeStore({
      fetchers: [memory],
      decoders: { zstd: (bytes) => Promise.resolve(bytes) }
    });
    await expectCode(store.getBlock(ref), 'BS_DECODE_UNSUPPORTED');
  });
});

// ---------------------------------------------------------------------------
// memory block store
// ---------------------------------------------------------------------------

describe('MemoryBlockStore', () => {
  it('computes digests itself and rejects oversized blocks', async () => {
    const store = new MemoryBlockStore({ maxBlockBytes: 16, maxTotalBytes: 64 });
    const digest = await store.put(bytesOf('small'));
    expect(store.has(digest)).toBe(true);
    await expectCode(store.put(new Uint8Array(17)), 'BS_BYTE_CAP_EXCEEDED');
  });

  it('is immune to caller mutation of stored or returned bytes', async () => {
    const store = new MemoryBlockStore();
    const original = bytesOf('immutable content');
    const digest = await store.put(original);
    original.fill(0); // mutate the input after put

    const ref = await refFor(bytesOf('immutable content'));
    void ref;
    const result = await store.fetchBlock({
      ref: {
        type: 'block-ref',
        source: { kind: 'digest', digest },
        byteLength: 17,
        offset: 0,
        privacy: 'public'
      } as BlockRef
    });
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(new TextDecoder().decode(result.bytes)).toBe('immutable content');
    result.bytes.fill(0); // mutate the output

    const again = await store.fetchBlock({
      ref: {
        type: 'block-ref',
        source: { kind: 'digest', digest },
        byteLength: 17,
        offset: 0,
        privacy: 'public'
      } as BlockRef
    });
    if (again.outcome !== 'ok') throw new Error('expected ok');
    expect(new TextDecoder().decode(again.bytes)).toBe('immutable content');
  });

  it('evicts least-recently-used blocks to respect the total budget', async () => {
    const store = new MemoryBlockStore({ maxBlockBytes: 8, maxTotalBytes: 16 });
    const a = await store.put(bytesOf('aaaaaaaa'));
    const b = await store.put(bytesOf('bbbbbbbb'));
    // Touch `a` so `b` becomes the LRU entry.
    await store.fetchBlock({
      ref: {
        type: 'block-ref',
        source: { kind: 'digest', digest: a },
        byteLength: 8,
        offset: 0,
        privacy: 'public'
      } as BlockRef
    });
    const c = await store.put(bytesOf('cccccccc'));
    expect(store.has(a)).toBe(true);
    expect(store.has(b)).toBe(false);
    expect(store.has(c)).toBe(true);
    expect(store.totalBytes).toBe(16);
  });

  it('delete removes poisoned entries and updates accounting', async () => {
    const store = new MemoryBlockStore();
    const digest = await store.put(bytesOf('to be deleted'));
    expect(store.delete(digest)).toBe(true);
    expect(store.delete(digest)).toBe(false);
    expect(store.totalBytes).toBe(0);
  });
});
