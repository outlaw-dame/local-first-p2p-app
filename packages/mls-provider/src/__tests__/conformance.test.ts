import { describe, expect, it } from 'vitest';
import { getCiphersuiteFromName, getCiphersuiteImpl } from 'ts-mls';
import { deriveSecret, deriveTreeSecret, expandWithLabel } from 'ts-mls/crypto/kdf.js';
import { refhash } from 'ts-mls/crypto/hash.js';
import { PINNED_CIPHERSUITE } from '../index.js';
import vector from './fixtures/rfc9420-crypto-basics-cs1.json' with { type: 'json' };

/**
 * RFC 9420 conformance gate (ADR-015). These are the official MLS
 * working-group interop test vectors (`crypto-basics.json`) for
 * cipher_suite 1 — the exact ciphersuite this provider pins — run
 * against the crypto primitives ts-mls actually uses.
 *
 * If a ts-mls upgrade ever changes the KDF/hash behavior away from the
 * RFC, this fails in CI before the provider can ship a divergent wire
 * format. The fixture is committed (CI is offline) and carries its
 * provenance in the `source` field.
 */

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('odd-length hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

describe('RFC 9420 crypto-basics conformance (cipher_suite 1)', () => {
  it('fixture targets the pinned ciphersuite', () => {
    expect(vector.cipher_suite).toBe(1);
    expect(vector.cipher_suite_name).toBe(PINNED_CIPHERSUITE);
  });

  it('deriveSecret matches the official vector', async () => {
    const cs = await getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
    const out = await deriveSecret(
      hexToBytes(vector.derive_secret.secret),
      vector.derive_secret.label,
      cs.kdf
    );
    expect(bytesToHex(out)).toBe(vector.derive_secret.out);
  });

  it('deriveTreeSecret matches the official vector', async () => {
    const cs = await getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
    const out = await deriveTreeSecret(
      hexToBytes(vector.derive_tree_secret.secret),
      vector.derive_tree_secret.label,
      vector.derive_tree_secret.generation,
      vector.derive_tree_secret.length,
      cs.kdf
    );
    expect(bytesToHex(out)).toBe(vector.derive_tree_secret.out);
  });

  it('expandWithLabel matches the official vector', async () => {
    const cs = await getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
    const out = await expandWithLabel(
      hexToBytes(vector.expand_with_label.secret),
      vector.expand_with_label.label,
      hexToBytes(vector.expand_with_label.context),
      vector.expand_with_label.length,
      cs.kdf
    );
    expect(bytesToHex(out)).toBe(vector.expand_with_label.out);
  });

  it('refhash matches the official vector', async () => {
    const cs = await getCiphersuiteImpl(getCiphersuiteFromName(PINNED_CIPHERSUITE));
    const out = await refhash(vector.ref_hash.label, hexToBytes(vector.ref_hash.value), cs.hash);
    expect(bytesToHex(out)).toBe(vector.ref_hash.out);
  });
});
