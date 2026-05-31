import { describe, expect, it } from 'vitest';
import {
  createBlockRef,
  createDigest,
  redactBlockRef,
  redactContentLink,
  redactDigestRef,
  validateContentLink
} from '../index.js';

describe('redaction', () => {
  it('redacts a digest body to a short prefix only', async () => {
    const ref = await createDigest('hello world');
    const redacted = redactDigestRef(ref);
    expect(redacted.startsWith('sha-256:')).toBe(true);
    // We should never see the full digest body in the redaction string.
    expect(redacted.includes(ref.digest)).toBe(false);
    // The body portion is the prefix + ellipsis.
    const body = redacted.slice('sha-256:'.length);
    expect(body.length).toBeLessThan(ref.digest.length);
    expect(body.endsWith('…')).toBe(true);
  });

  it('redacts a content link to codec + truncated cid', () => {
    const link = validateContentLink({
      type: 'content-link',
      cid: 'bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa',
      codec: 'raw'
    });
    const redacted = redactContentLink(link);
    expect(redacted.startsWith('cid:raw:')).toBe(true);
    expect(redacted.includes(link.cid)).toBe(false);
  });

  it('redacts a block ref with privacy and length but not the encryption key', async () => {
    const digest = await createDigest('hello');
    const keyRef = await createDigest('key');
    const block = createBlockRef({
      source: { kind: 'digest', digest },
      byteLength: 1024,
      privacy: 'private',
      encryption: { scheme: 'xchacha20-poly1305', keyRef }
    });
    const redacted = redactBlockRef(block);
    expect(redacted.startsWith('block(private,')).toBe(true);
    expect(redacted).toContain('len=1024');
    // Encryption key digest body must not appear in the redacted form.
    expect(redacted.includes(keyRef.digest)).toBe(false);
  });
});
