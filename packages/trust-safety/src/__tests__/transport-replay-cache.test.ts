import { describe, expect, it } from 'vitest';
import type { ReplayCacheConfig } from '../index.js';
import {
  createReplayCache,
  pruneReplayCache,
  recordSeen,
  validateReplayCacheConfig
} from '../index.js';

const SMALL: ReplayCacheConfig = Object.freeze({
  ttlMs: 1_000,
  maxEntries: 4
});

describe('replay cache — first-seen / duplicate', () => {
  it('treats first appearance of a key as first-seen', () => {
    const result = recordSeen(createReplayCache(), 'idem_1', 0, SMALL);
    expect(result.outcome).toBe('first-seen');
  });

  it('treats repeat appearance as duplicate when within TTL', () => {
    const r1 = recordSeen(createReplayCache(), 'idem_1', 0, SMALL);
    const r2 = recordSeen(r1.cache, 'idem_1', 500, SMALL);
    expect(r2.outcome).toBe('duplicate');
    expect(r2.cache).toBe(r1.cache);
  });

  it('expires keys after ttlMs and re-treats as first-seen', () => {
    const r1 = recordSeen(createReplayCache(), 'idem_1', 0, SMALL);
    const r2 = recordSeen(r1.cache, 'idem_1', SMALL.ttlMs + 1, SMALL);
    expect(r2.outcome).toBe('first-seen');
  });
});

describe('replay cache — capacity eviction', () => {
  it('evicts oldest-first when over capacity', () => {
    let cache = createReplayCache();
    for (let i = 0; i < SMALL.maxEntries; i += 1) {
      const r = recordSeen(cache, `k${i}`, i, SMALL);
      cache = r.cache;
    }
    // One more key forces eviction of the oldest.
    const r = recordSeen(cache, 'kN', SMALL.maxEntries, SMALL);
    expect(r.outcome).toBe('first-seen');
    expect(r.cache.insertionOrder.length).toBeLessThanOrEqual(SMALL.maxEntries);
    // 'k0' should no longer be a duplicate because it was evicted.
    const followup = recordSeen(r.cache, 'k0', SMALL.maxEntries, SMALL);
    expect(followup.outcome).toBe('first-seen');
  });

  it('hardens against flood attack: cache size never exceeds maxEntries', () => {
    let cache = createReplayCache();
    for (let i = 0; i < SMALL.maxEntries * 5; i += 1) {
      cache = recordSeen(cache, `flood_${i}`, i, SMALL).cache;
      expect(cache.insertionOrder.length).toBeLessThanOrEqual(SMALL.maxEntries);
    }
  });
});

describe('replay cache — pruning', () => {
  it('pruneReplayCache removes expired entries deterministically', () => {
    let cache = createReplayCache();
    cache = recordSeen(cache, 'old', 0, SMALL).cache;
    cache = recordSeen(cache, 'fresh', SMALL.ttlMs, SMALL).cache;
    const pruned = pruneReplayCache(cache, SMALL.ttlMs + 1, SMALL);
    expect(pruned.entries['old']).toBeUndefined();
    expect(pruned.entries['fresh']).toBeDefined();
  });
});

describe('replay cache — config validation', () => {
  it('rejects malformed config', () => {
    expect(() =>
      validateReplayCacheConfig({ ttlMs: 0, maxEntries: 16 })
    ).toThrow();
    expect(() =>
      validateReplayCacheConfig({ ttlMs: 1_000, maxEntries: 1.5 })
    ).toThrow();
  });
});
