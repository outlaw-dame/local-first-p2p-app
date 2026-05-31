import type { DigestRef } from './digest.js';
import type { ContentLink } from './content-link.js';
import type { BlockRef } from './block-ref.js';

/**
 * Visible prefix length when redacting a digest body. Eight characters
 * of base64url is 6 bytes — enough for humans to differentiate in logs,
 * not enough to brute-force a full preimage given only the redaction.
 */
const REDACTED_PREFIX_LENGTH = 8;

function redactDigestBody(digest: string): string {
  if (digest.length <= REDACTED_PREFIX_LENGTH) {
    // Defensive: a string this short is not a valid digest body for our
    // algorithms, but we still avoid emitting it verbatim.
    return '…';
  }
  return `${digest.slice(0, REDACTED_PREFIX_LENGTH)}…`;
}

export function redactDigestRef(ref: DigestRef): string {
  return `${ref.algorithm}:${redactDigestBody(ref.digest)}`;
}

export function redactContentLink(link: ContentLink): string {
  // CIDs are not secret in the same sense as a private digest, but for
  // consistency in logs we still redact most of the body.
  const visible =
    link.cid.length <= REDACTED_PREFIX_LENGTH + 1
      ? link.cid
      : `${link.cid.slice(0, REDACTED_PREFIX_LENGTH + 1)}…`;
  return `cid:${link.codec}:${visible}`;
}

export function redactBlockRef(ref: BlockRef): string {
  const source =
    ref.source.kind === 'digest'
      ? redactDigestRef(ref.source.digest)
      : redactContentLink(ref.source.link);
  // Never reveal whether the encryption key ref is set in log surfaces;
  // privacy alone implies whether the block is encrypted.
  return `block(${ref.privacy}, ${source}, len=${ref.byteLength})`;
}
