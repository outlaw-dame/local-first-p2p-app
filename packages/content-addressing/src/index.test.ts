import { describe, expect, it } from 'vitest';
import {
  createDigest,
  createObjectRef,
  createContentLink,
  createBlockRef,
  createBundleRef,
  canonicalizeJson,
  verifyDigest,
  validateDigestRef,
  type ContentLink,
  type ObjectRef,
  type BlockRef,
  type BundleRef,
  type StorageLocationHint
} from './index.js';

describe('@lfp2p/content-addressing', () => {
  it('creates the same digest for canonical JSON regardless of property order', async () => {
    const inputA = { b: 2, a: 1 };
    const inputB = { a: 1, b: 2 };

    const digestA = await createDigest(inputA);
    const digestB = await createDigest(inputB);

    expect(digestA).toEqual(digestB);
  });

  it('verifies a digest for a string input', async () => {
    const ref = await createDigest('hello world');
    expect(await verifyDigest('hello world', ref)).toBe(true);
    expect(await verifyDigest('hello earth', ref)).toBe(false);
  });

  it('throws for unsupported hash algorithms', async () => {
    await expect(() =>
      createDigest('hello', 'sha1' as unknown as 'sha256')
    ).rejects.toThrow('Unsupported hash algorithm');
  });

  it('produces valid content links, block refs, and bundle refs', async () => {
    const ref = await createDigest({ data: 'value' });
    const link = createContentLink(ref, { mediaType: 'application/json', size: 25 });
    const objectRef = createObjectRef(ref, { schemaVersion: 2 });
    const blockRef = createBlockRef(ref, { offset: 0, length: 100 });
    const bundleRef = createBundleRef(ref, { itemCount: 1, contentType: 'application/json' });

    expect(link).toMatchObject<Partial<ContentLink>>({ type: 'content-link', ref });
    expect(objectRef).toMatchObject<Partial<ObjectRef>>({ type: 'object-ref', ref });
    expect(blockRef).toMatchObject<Partial<BlockRef>>({ type: 'block-ref', ref });
    expect(bundleRef).toMatchObject<Partial<BundleRef>>({ type: 'bundle-ref', ref });
  });

  it('produces valid block refs with storage hints', async () => {
    const ref = await createDigest('object');
    const hint: StorageLocationHint = { kind: 'http', uri: 'https://example.com/blob' };
    const blockRef = createBlockRef(ref, { storageLocationHint: hint });

    expect(blockRef.storageLocationHint).toEqual(hint);
  });

  it('rejects invalid block offsets', async () => {
    const ref = await createDigest('object');
    await expect(() => createBlockRef(ref, { offset: -1 })).toThrow(
      'BlockRef.offset must be non-negative'
    );
  });

  it('rejects invalid digest references', () => {
    expect(() =>
      validateDigestRef({
        algorithm: 'sha256',
        digest: 'not valid++'
      } as unknown as Parameters<typeof validateDigestRef>[0])
    ).toThrow('DigestRef.digest must be base64url encoded without padding');
  });

  it('canonicalizes JSON with sorted object keys and rejects undefined values', () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(() =>
      canonicalizeJson({ a: undefined } as unknown as Parameters<typeof canonicalizeJson>[0])
    ).toThrow('JSON objects must not contain undefined values');
  });
});
