import type { PrivateKeyPackage } from 'ts-mls';
import { mlsError } from './errors.js';

/**
 * Serialization for ts-mls `PrivateKeyPackage` (three raw private
 * keys). ts-mls provides no codec for it, so this package pins one:
 *
 * ```txt
 * u8 version (1) | 3 × ( u32-BE length | bytes )
 * ```
 *
 * field order: initPrivateKey, hpkePrivateKey, signaturePrivateKey.
 *
 * The output contains SECRET key material; storage rules are the
 * MlsStateStore contract's responsibility.
 */
const CODEC_VERSION = 1;
const MAX_KEY_BYTES = 4096;

function writeField(out: Uint8Array, offset: number, field: Uint8Array): number {
  new DataView(out.buffer, out.byteOffset).setUint32(offset, field.byteLength, false);
  out.set(field, offset + 4);
  return offset + 4 + field.byteLength;
}

function checkField(field: Uint8Array, label: string): Uint8Array {
  if (
    !(field instanceof Uint8Array) ||
    field.byteLength === 0 ||
    field.byteLength > MAX_KEY_BYTES
  ) {
    throw mlsError('MLS_STATE_CODEC', `${label} must be 1..${MAX_KEY_BYTES} bytes`);
  }
  return field;
}

export function encodePrivateKeyPackage(pkg: PrivateKeyPackage): Uint8Array {
  const init = checkField(pkg.initPrivateKey, 'initPrivateKey');
  const hpke = checkField(pkg.hpkePrivateKey, 'hpkePrivateKey');
  const sig = checkField(pkg.signaturePrivateKey, 'signaturePrivateKey');
  const out = new Uint8Array(1 + 3 * 4 + init.byteLength + hpke.byteLength + sig.byteLength);
  out[0] = CODEC_VERSION;
  let offset = 1;
  offset = writeField(out, offset, init);
  offset = writeField(out, offset, hpke);
  writeField(out, offset, sig);
  return out;
}

export function decodePrivateKeyPackage(bytes: Uint8Array): PrivateKeyPackage {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 + 3 * 4 + 3) {
    throw mlsError('MLS_STATE_CODEC', 'private key package bytes are truncated');
  }
  if (bytes[0] !== CODEC_VERSION) {
    throw mlsError('MLS_STATE_CODEC', 'unsupported private key package codec version');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 1;
  const fields: Uint8Array[] = [];
  for (let i = 0; i < 3; i += 1) {
    if (offset + 4 > bytes.byteLength) {
      throw mlsError('MLS_STATE_CODEC', 'private key package bytes are truncated');
    }
    const length = view.getUint32(offset, false);
    offset += 4;
    if (length === 0 || length > MAX_KEY_BYTES || offset + length > bytes.byteLength) {
      throw mlsError('MLS_STATE_CODEC', 'private key package field length is invalid');
    }
    fields.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  if (offset !== bytes.byteLength) {
    throw mlsError('MLS_STATE_CODEC', 'private key package has trailing bytes');
  }
  const [initPrivateKey, hpkePrivateKey, signaturePrivateKey] = fields as [
    Uint8Array,
    Uint8Array,
    Uint8Array
  ];
  return { initPrivateKey, hpkePrivateKey, signaturePrivateKey };
}
