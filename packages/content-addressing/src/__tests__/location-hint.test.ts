import { describe, expect, it } from 'vitest';
import { LOCATION_HINT_KINDS, validateStorageLocationHint } from '../index.js';

describe('validateStorageLocationHint', () => {
  it('accepts a well-formed bridge-store hint', () => {
    const hint = validateStorageLocationHint({
      kind: 'bridge-store',
      uri: 'https://bridge.example.com/blobs/abc',
      priority: 10,
      expiresAt: '2030-01-01T00:00:00Z'
    });
    expect(hint.kind).toBe('bridge-store');
    expect(hint.priority).toBe(10);
    expect(hint.expiresAt).toBe('2030-01-01T00:00:00Z');
  });

  it('accepts opaque local-cache identifiers', () => {
    const hint = validateStorageLocationHint({
      kind: 'local-cache',
      uri: 'cache:block-store:0xabcdef'
    });
    expect(hint.kind).toBe('local-cache');
  });

  it('rejects URL with embedded user:password', () => {
    expect(() =>
      validateStorageLocationHint({
        kind: 'bridge-store',
        uri: 'https://attacker:hunter2@bridge.example.com/blobs/abc'
      })
    ).toThrow(/CA_URL_CREDENTIALS_FORBIDDEN/);
  });

  it('rejects a URL with embedded user even for opaque local kinds', () => {
    expect(() =>
      validateStorageLocationHint({
        kind: 'local-cache',
        uri: 'cache://user:pass@local'
      })
    ).toThrow(/CA_URL_CREDENTIALS_FORBIDDEN/);
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      validateStorageLocationHint({ kind: 'unknown-kind', uri: 'https://x/' })
    ).toThrow(/CA_INVALID_LOCATION_KIND/);
  });

  it('rejects javascript: scheme via bridge-store', () => {
    expect(() =>
      validateStorageLocationHint({
        kind: 'bridge-store',
        uri: 'javascript:alert(1)'
      })
    ).toThrow(/CA_INVALID_URL/);
  });

  it('rejects an http URL for an https-only kind', () => {
    expect(() =>
      validateStorageLocationHint({
        kind: 'bridge-store',
        uri: 'http://bridge.example.com/blobs/abc'
      })
    ).toThrow(/CA_INVALID_URL/);
  });

  it('rejects negative or fractional priority', () => {
    expect(() =>
      validateStorageLocationHint({
        kind: 'bridge-store',
        uri: 'https://bridge.example.com/x',
        priority: -1
      })
    ).toThrow();
    expect(() =>
      validateStorageLocationHint({
        kind: 'bridge-store',
        uri: 'https://bridge.example.com/x',
        priority: 1.5
      })
    ).toThrow();
  });

  it('rejects malformed expiresAt', () => {
    expect(() =>
      validateStorageLocationHint({
        kind: 'bridge-store',
        uri: 'https://bridge.example.com/x',
        expiresAt: 'never'
      })
    ).toThrow(/CA_INVALID_EXPIRY/);
  });

  it('exposes the documented kind list', () => {
    expect(LOCATION_HINT_KINDS).toContain('bridge-store');
    expect(LOCATION_HINT_KINDS).toContain('https');
    expect(LOCATION_HINT_KINDS).toContain('relay-store');
    expect(LOCATION_HINT_KINDS).toContain('hypercore-compatible');
  });
});
