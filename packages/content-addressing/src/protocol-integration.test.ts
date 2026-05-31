import { describe, expect, it } from 'vitest';
import { createDigest, CONTENT_ADDRESSING_VERSION, verifyDigest, canonicalizeJson } from './index.js';

describe('content-addressing module versioning and integration', () => {
  it('exports version constant matching the module version', () => {
    expect(CONTENT_ADDRESSING_VERSION).toBe('lfp2p.content-addressing.v1');
  });

  it('produces stable digests for objects using canonical JSON', async () => {
    const eventPayload = {
      kind: 'note.created',
      author: 'user:alice',
      deviceId: 'device:alice-phone',
      createdAt: '2026-05-30T22:30:00.000Z',
      body: 'hello world'
    };

    const canonical = canonicalizeJson(eventPayload);
    const digest1 = await createDigest(canonical);
    const digest2 = await createDigest(canonical);

    expect(digest1).toEqual(digest2);
    expect(digest1.algorithm).toBe('sha256');
  });

  it('verifies digests created from canonical JSON', async () => {
    const payload = { a: 1, b: 2, c: 3 };
    const canonical = canonicalizeJson(payload);
    const ref = await createDigest(canonical);

    expect(await verifyDigest(canonical, ref)).toBe(true);
    expect(await verifyDigest('different', ref)).toBe(false);
  });

  it('version constant can be used for module negotiation', () => {
    const supportedVersions: string[] = ['lfp2p.content-addressing.v1'];
    expect(supportedVersions).toContain(CONTENT_ADDRESSING_VERSION);
  });
});
