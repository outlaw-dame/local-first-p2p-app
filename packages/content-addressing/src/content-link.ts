import { decodeMultibaseBody, parseCidBinary } from './cid.js';
import { caError } from './errors.js';
import {
  assertNonEmptyString,
  assertPlainObject,
  assertSafeNonNegativeInteger,
  hasControlCharacters
} from './validation.js';

/**
 * Codecs allowed for ContentLink emission. This list is the protocol allowlist.
 * Adding a codec is an explicit ADR-level decision.
 */
export const CONTENT_LINK_CODECS = [
  'raw',
  'dag-cbor',
  'dag-json',
  'dag-pb',
  'dcel-cbor',
  'drisl-cbor',
  'car-v1',
  'car-v2',
  'lfp2p-bundle-v1'
] as const;

export type ContentLinkCodec = (typeof CONTENT_LINK_CODECS)[number];

export function isContentLinkCodec(value: unknown): value is ContentLinkCodec {
  return (
    typeof value === 'string' &&
    CONTENT_LINK_CODECS.includes(value as ContentLinkCodec)
  );
}

export type ContentLink = Readonly<{
  type: 'content-link';
  cid: string;
  codec: ContentLinkCodec;
  mediaType?: string;
  size?: number;
}>;

/**
 * Multibase prefixes we accept for CIDv1 strings. Per multibase spec each
 * prefix selects a base encoding. We constrain the alphabet per prefix and
 * forbid prefixes that would only ever appear in CIDv0 / non-self-describing
 * encodings.
 */
const MULTIBASE_ALPHABETS: Readonly<Record<string, RegExp>> = {
  // base32 RFC 4648 lowercase, no padding (most common for CIDv1)
  b: /^[a-z2-7]+$/,
  // base32 RFC 4648 uppercase, no padding
  B: /^[A-Z2-7]+$/,
  // base32hex lowercase
  v: /^[0-9a-v]+$/,
  // base32hex uppercase
  V: /^[0-9A-V]+$/,
  // base36 lowercase
  k: /^[0-9a-z]+$/,
  // base36 uppercase
  K: /^[0-9A-Z]+$/,
  // base58btc (bitcoin alphabet) — also the CIDv0 alphabet
  z: /^[1-9A-HJ-NP-Za-km-z]+$/,
  // base64url no-pad
  u: /^[A-Za-z0-9_-]+$/,
  // base16 lowercase
  f: /^[0-9a-f]+$/,
  // base16 uppercase
  F: /^[0-9A-F]+$/
};

const CID_MIN_BODY_LENGTH = 16;
const CID_MAX_BODY_LENGTH = 1024;

/**
 * Validate a CIDv1 string shape without resolving the inner multihash.
 *
 * Rules:
 *  - reject CIDv0 (starts with "Qm" and is exactly 46 chars, base58btc)
 *  - reject anything that looks like a URL or path
 *  - require a known multibase prefix
 *  - require the body to use only the alphabet for that prefix
 *  - require a reasonable length envelope
 */
export function validateCidV1String(value: unknown, label: string): string {
  const raw = assertNonEmptyString(value, label);
  if (raw.includes('://') || raw.includes('/') || raw.includes(' ')) {
    throw caError('CA_CID_IS_URL', `${label} must be a bare CID, not a URL or path`);
  }
  // CIDv0: base58btc, exactly 46 chars, starts with "Qm". Forbidden for new objects.
  if (raw.length === 46 && raw.startsWith('Qm')) {
    throw caError(
      'CA_UNSUPPORTED_CID_VERSION',
      `${label}: CIDv0 ("Qm...") is not allowed for new objects; emit CIDv1`
    );
  }
  const prefix = raw[0]!;
  const body = raw.slice(1);
  const alphabet = MULTIBASE_ALPHABETS[prefix];
  if (alphabet === undefined) {
    throw caError(
      'CA_INVALID_CID',
      `${label}: unknown multibase prefix "${prefix}"`
    );
  }
  if (body.length < CID_MIN_BODY_LENGTH || body.length > CID_MAX_BODY_LENGTH) {
    throw caError(
      'CA_INVALID_CID',
      `${label}: CID body length ${body.length} out of bounds [${CID_MIN_BODY_LENGTH}, ${CID_MAX_BODY_LENGTH}]`
    );
  }
  if (!alphabet.test(body)) {
    throw caError(
      'CA_INVALID_CID',
      `${label}: body contains characters outside the alphabet for multibase "${prefix}"`
    );
  }

  // For multibase prefixes we can fully decode, parse the binary form and
  // validate the multicodec + multihash structure. Other prefixes pass
  // the alphabet check above and are accepted; their binary structure
  // will be re-validated when the corresponding multibase decoder is
  // added in a follow-up change.
  const decoded = decodeMultibaseBody(prefix, body);
  if (decoded !== undefined) {
    parseCidBinary(decoded, label);
  }

  return raw;
}

export function validateContentLink(value: unknown): ContentLink {
  const record = assertPlainObject(value, 'ContentLink');
  if (record.type !== 'content-link') {
    throw caError('CA_INVALID_INPUT', 'ContentLink.type must equal "content-link"');
  }
  const cid = validateCidV1String(record.cid, 'ContentLink.cid');
  if (!isContentLinkCodec(record.codec)) {
    throw caError(
      'CA_UNSUPPORTED_CODEC',
      `ContentLink.codec must be one of ${CONTENT_LINK_CODECS.join(', ')}`
    );
  }
  const codec: ContentLinkCodec = record.codec;
  let mediaType: string | undefined;
  if (record.mediaType !== undefined) {
    mediaType = assertNonEmptyString(record.mediaType, 'ContentLink.mediaType');
    // Reject CR/LF and control chars to prevent header injection downstream.
    if (hasControlCharacters(mediaType)) {
      throw caError('CA_INVALID_INPUT', 'ContentLink.mediaType contains control characters');
    }
  }
  let size: number | undefined;
  if (record.size !== undefined) {
    size = assertSafeNonNegativeInteger(record.size, 'ContentLink.size');
  }

  const out: { -readonly [K in keyof ContentLink]: ContentLink[K] } = {
    type: 'content-link',
    cid,
    codec
  };
  if (mediaType !== undefined) out.mediaType = mediaType;
  if (size !== undefined) out.size = size;
  return Object.freeze(out);
}

export function createContentLink(input: {
  cid: string;
  codec: ContentLinkCodec;
  mediaType?: string;
  size?: number;
}): ContentLink {
  return validateContentLink({ type: 'content-link', ...input });
}
