import type { BlockRef } from './block-ref.js';
import { validateBlockRef } from './block-ref.js';
import type { BundleRef } from './bundle-ref.js';
import { validateBundleRef } from './bundle-ref.js';
import type { DigestRef } from './digest.js';
import { validateDigestRef } from './digest.js';
import { caError } from './errors.js';
import {
  assertNonEmptyString,
  assertPlainObject,
  hasControlCharacters,
  parseSafeUrl
} from './validation.js';

export const OBJECT_REF_KINDS = [
  'event',
  'record',
  'media',
  'safety-label',
  'report',
  'policy-decision',
  'bundle',
  'url',
  'domain',
  'actor',
  'community',
  'infrastructure'
] as const;

export type ObjectRefKind = (typeof OBJECT_REF_KINDS)[number];

export type ContentBackedKind =
  | 'event'
  | 'record'
  | 'media'
  | 'safety-label'
  | 'report'
  | 'policy-decision';

const CONTENT_BACKED_KINDS: ReadonlySet<ContentBackedKind> = new Set([
  'event',
  'record',
  'media',
  'safety-label',
  'report',
  'policy-decision'
]);

const MAX_DOMAIN_LENGTH = 253;
const MAX_DOMAIN_LABEL_LENGTH = 63;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

const MAX_IDENTITY_REF_LENGTH = 1024;
const MAX_URL_LENGTH = 8192;

export type ContentBackedRef = Readonly<{
  type: 'object-ref';
  kind: ContentBackedKind;
  digest: DigestRef;
  schemaVersion?: number;
}>;

export type MediaObjectRef = Readonly<{
  type: 'object-ref';
  kind: 'media';
  block: BlockRef;
  schemaVersion?: number;
}>;

export type BundleObjectRef = Readonly<{
  type: 'object-ref';
  kind: 'bundle';
  bundle: BundleRef;
  schemaVersion?: number;
}>;

export type UrlObjectRef = Readonly<{
  type: 'object-ref';
  kind: 'url';
  url: string;
}>;

export type DomainObjectRef = Readonly<{
  type: 'object-ref';
  kind: 'domain';
  domain: string;
}>;

export type IdentityObjectRef = Readonly<{
  type: 'object-ref';
  kind: 'actor' | 'community' | 'infrastructure';
  identityRef: string;
}>;

export type ObjectRef =
  | ContentBackedRef
  | MediaObjectRef
  | BundleObjectRef
  | UrlObjectRef
  | DomainObjectRef
  | IdentityObjectRef;

export function isObjectRefKind(value: unknown): value is ObjectRefKind {
  return (
    typeof value === 'string' && OBJECT_REF_KINDS.includes(value as ObjectRefKind)
  );
}

function validateDomain(value: unknown): string {
  const raw = assertNonEmptyString(value, 'ObjectRef.domain');
  if (raw.length > MAX_DOMAIN_LENGTH) {
    throw caError(
      'CA_INVALID_OBJECT_REF',
      `ObjectRef.domain length ${raw.length} exceeds ${MAX_DOMAIN_LENGTH}`
    );
  }
  // Reject anything that looks URL-ish to prevent caller-side confusion.
  if (raw.includes('/') || raw.includes('@') || raw.includes(':')) {
    throw caError(
      'CA_INVALID_OBJECT_REF',
      'ObjectRef.domain must be a bare domain, not a URL or userinfo'
    );
  }
  const labels = raw.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_DOMAIN_LABEL_LENGTH) {
      throw caError(
        'CA_INVALID_OBJECT_REF',
        `ObjectRef.domain label "${label}" has invalid length`
      );
    }
    if (!DOMAIN_LABEL_PATTERN.test(label)) {
      throw caError(
        'CA_INVALID_OBJECT_REF',
        `ObjectRef.domain label "${label}" contains invalid characters`
      );
    }
  }
  return raw.toLowerCase();
}

function validateIdentityRef(value: unknown, kind: string): string {
  const raw = assertNonEmptyString(value, `ObjectRef(${kind}).identityRef`);
  if (raw.length > MAX_IDENTITY_REF_LENGTH) {
    throw caError(
      'CA_INVALID_OBJECT_REF',
      `ObjectRef(${kind}).identityRef length ${raw.length} exceeds ${MAX_IDENTITY_REF_LENGTH}`
    );
  }
  if (hasControlCharacters(raw)) {
    throw caError(
      'CA_INVALID_OBJECT_REF',
      `ObjectRef(${kind}).identityRef contains control characters`
    );
  }
  return raw;
}

function validateUrl(value: unknown): string {
  const raw = assertNonEmptyString(value, 'ObjectRef.url');
  if (raw.length > MAX_URL_LENGTH) {
    throw caError(
      'CA_INVALID_OBJECT_REF',
      `ObjectRef.url length ${raw.length} exceeds ${MAX_URL_LENGTH}`
    );
  }
  const url = parseSafeUrl(raw, ['http', 'https'], 'ObjectRef.url');
  return url.toString();
}

export function validateObjectRef(value: unknown): ObjectRef {
  const record = assertPlainObject(value, 'ObjectRef');
  if (record.type !== 'object-ref') {
    throw caError('CA_INVALID_OBJECT_REF', 'ObjectRef.type must equal "object-ref"');
  }
  const kind = record.kind;
  if (!isObjectRefKind(kind)) {
    throw caError(
      'CA_INVALID_OBJECT_REF',
      `ObjectRef.kind must be one of ${OBJECT_REF_KINDS.join(', ')}`
    );
  }

  if (kind === 'media') {
    const block = validateBlockRef(record.block);
    const out: MediaObjectRef = Object.freeze({
      type: 'object-ref',
      kind: 'media',
      block
    });
    return out;
  }

  if (kind === 'bundle') {
    const bundle = validateBundleRef(record.bundle);
    const out: BundleObjectRef = Object.freeze({
      type: 'object-ref',
      kind: 'bundle',
      bundle
    });
    return out;
  }

  if (kind === 'url') {
    const url = validateUrl(record.url);
    const out: UrlObjectRef = Object.freeze({
      type: 'object-ref',
      kind: 'url',
      url
    });
    return out;
  }

  if (kind === 'domain') {
    const domain = validateDomain(record.domain);
    const out: DomainObjectRef = Object.freeze({
      type: 'object-ref',
      kind: 'domain',
      domain
    });
    return out;
  }

  if (kind === 'actor' || kind === 'community' || kind === 'infrastructure') {
    const identityRef = validateIdentityRef(record.identityRef, kind);
    const out: IdentityObjectRef = Object.freeze({
      type: 'object-ref',
      kind,
      identityRef
    });
    return out;
  }

  if (CONTENT_BACKED_KINDS.has(kind as ContentBackedKind)) {
    const digest = validateDigestRef(record.digest);
    const out: { -readonly [K in keyof ContentBackedRef]: ContentBackedRef[K] } = {
      type: 'object-ref',
      kind: kind as ContentBackedKind,
      digest
    };
    if (record.schemaVersion !== undefined) {
      if (
        typeof record.schemaVersion !== 'number' ||
        !Number.isSafeInteger(record.schemaVersion) ||
        record.schemaVersion < 0
      ) {
        throw caError(
          'CA_INVALID_OBJECT_REF',
          'ObjectRef.schemaVersion must be a non-negative safe integer'
        );
      }
      out.schemaVersion = record.schemaVersion;
    }
    return Object.freeze(out);
  }

  // Exhaustiveness guard.
  throw caError('CA_INVALID_OBJECT_REF', `Unhandled ObjectRef kind: ${String(kind)}`);
}

export function createObjectRef(input: ObjectRef): ObjectRef {
  return validateObjectRef(input);
}
