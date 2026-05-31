import type { ContentLink } from './content-link.js';
import { validateContentLink } from './content-link.js';
import type { DigestRef } from './digest.js';
import { validateDigestRef } from './digest.js';
import { caError } from './errors.js';
import { assertPlainObject, assertSafeNonNegativeInteger } from './validation.js';

export const BUNDLE_FORMATS = ['car-v1', 'car-v2', 'lfp2p-bundle-v1'] as const;
export type BundleFormat = (typeof BUNDLE_FORMATS)[number];

export const BUNDLE_PURPOSES = [
  'report-evidence',
  'media-package',
  'replication-snapshot',
  'archive',
  'transparency-log'
] as const;
export type BundlePurpose = (typeof BUNDLE_PURPOSES)[number];

/** Hard bound on declared bundle size — keeps validators sane. 64 GiB. */
export const MAX_BUNDLE_BYTE_LENGTH = 64 * 1024 * 1024 * 1024;

/** Max declared roots per bundle. */
export const MAX_BUNDLE_ROOTS = 1024;

export type BundleRoot =
  | Readonly<{ kind: 'digest'; digest: DigestRef }>
  | Readonly<{ kind: 'content-link'; link: ContentLink }>;

export type BundleRef = Readonly<{
  type: 'bundle-ref';
  format: BundleFormat;
  purpose: BundlePurpose;
  roots: ReadonlyArray<BundleRoot>;
  byteLength: number;
  encrypted: boolean;
}>;

function validateRoot(value: unknown, index: number): BundleRoot {
  const record = assertPlainObject(value, `BundleRef.roots[${index}]`);
  if (record.kind === 'digest') {
    const digest = validateDigestRef(record.digest);
    return Object.freeze({ kind: 'digest' as const, digest });
  }
  if (record.kind === 'content-link') {
    const link = validateContentLink(record.link);
    return Object.freeze({ kind: 'content-link' as const, link });
  }
  throw caError(
    'CA_INVALID_INPUT',
    `BundleRef.roots[${index}].kind must be "digest" or "content-link"`
  );
}

export function validateBundleRef(value: unknown): BundleRef {
  const record = assertPlainObject(value, 'BundleRef');
  if (record.type !== 'bundle-ref') {
    throw caError('CA_INVALID_INPUT', 'BundleRef.type must equal "bundle-ref"');
  }
  if (!BUNDLE_FORMATS.includes(record.format as BundleFormat)) {
    throw caError(
      'CA_INVALID_BUNDLE_REF',
      `BundleRef.format must be one of ${BUNDLE_FORMATS.join(', ')}`
    );
  }
  const format = record.format as BundleFormat;

  if (!BUNDLE_PURPOSES.includes(record.purpose as BundlePurpose)) {
    throw caError(
      'CA_INVALID_BUNDLE_REF',
      `BundleRef.purpose must be one of ${BUNDLE_PURPOSES.join(', ')}`
    );
  }
  const purpose = record.purpose as BundlePurpose;

  if (!Array.isArray(record.roots)) {
    throw caError('CA_INVALID_BUNDLE_REF', 'BundleRef.roots must be an array');
  }
  if (record.roots.length === 0) {
    throw caError('CA_EMPTY_ROOTS', 'BundleRef.roots must not be empty');
  }
  if (record.roots.length > MAX_BUNDLE_ROOTS) {
    throw caError(
      'CA_INVALID_BUNDLE_REF',
      `BundleRef.roots length ${record.roots.length} exceeds MAX_BUNDLE_ROOTS ${MAX_BUNDLE_ROOTS}`
    );
  }
  const roots: BundleRoot[] = [];
  for (let i = 0; i < record.roots.length; i += 1) {
    roots.push(validateRoot(record.roots[i], i));
  }

  const byteLength = assertSafeNonNegativeInteger(record.byteLength, 'BundleRef.byteLength');
  if (byteLength > MAX_BUNDLE_BYTE_LENGTH) {
    throw caError(
      'CA_INVALID_BYTE_LENGTH',
      `BundleRef.byteLength ${byteLength} exceeds MAX_BUNDLE_BYTE_LENGTH ${MAX_BUNDLE_BYTE_LENGTH}`
    );
  }

  if (typeof record.encrypted !== 'boolean') {
    throw caError('CA_INVALID_BUNDLE_REF', 'BundleRef.encrypted must be a boolean');
  }

  return Object.freeze({
    type: 'bundle-ref',
    format,
    purpose,
    roots: Object.freeze(roots),
    byteLength,
    encrypted: record.encrypted
  });
}

export function createBundleRef(input: {
  format: BundleFormat;
  purpose: BundlePurpose;
  roots: ReadonlyArray<BundleRoot>;
  byteLength: number;
  encrypted: boolean;
}): BundleRef {
  return validateBundleRef({ type: 'bundle-ref', ...input });
}
