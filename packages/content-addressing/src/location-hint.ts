import { caError } from './errors.js';
import {
  assertNonEmptyString,
  assertPlainObject,
  assertSafeNonNegativeInteger,
  parseSafeUrl
} from './validation.js';

export const LOCATION_HINT_KINDS = [
  'local-cache',
  'indexeddb-block-store',
  'opfs-block-store',
  'bridge-store',
  'relay-store',
  'super-peer-store',
  'https',
  's3-compatible',
  'filebase',
  'ipfs-compatible',
  'car-archive',
  'hypercore-compatible',
  'native-file-store'
] as const;

export type LocationHintKind = (typeof LOCATION_HINT_KINDS)[number];

/**
 * Schemes allowed for the `uri` field by location kind. Anything not
 * listed forces the kind down a non-URL path (e.g. a local opaque
 * identifier interpreted by the runtime).
 */
const URL_SCHEMES_BY_KIND: Readonly<Partial<Record<LocationHintKind, readonly string[]>>> = {
  https: ['https'],
  'bridge-store': ['https'],
  'relay-store': ['https', 'wss'],
  'super-peer-store': ['https', 'wss'],
  's3-compatible': ['https'],
  filebase: ['https'],
  'ipfs-compatible': ['https', 'ipfs'],
  'car-archive': ['https']
};

/**
 * Kinds whose `uri` is a runtime-local opaque identifier (e.g. an OPFS
 * path or IndexedDB key), not a URL. We require non-empty, but do not
 * impose URL grammar; we still ban embedded credentials by spec because
 * none of these surfaces should be transporting passwords.
 */
const NON_URL_KINDS: ReadonlySet<LocationHintKind> = new Set([
  'local-cache',
  'indexeddb-block-store',
  'opfs-block-store',
  'hypercore-compatible',
  'native-file-store'
]);

export type StorageLocationHint = Readonly<{
  kind: LocationHintKind;
  uri: string;
  priority?: number;
  expiresAt?: string;
}>;

export function isLocationHintKind(value: unknown): value is LocationHintKind {
  return typeof value === 'string' && LOCATION_HINT_KINDS.includes(value as LocationHintKind);
}

export function validateStorageLocationHint(value: unknown): StorageLocationHint {
  const record = assertPlainObject(value, 'StorageLocationHint');
  const { kind } = record;
  if (!isLocationHintKind(kind)) {
    throw caError(
      'CA_INVALID_LOCATION_KIND',
      `StorageLocationHint.kind must be one of ${LOCATION_HINT_KINDS.join(', ')}`
    );
  }
  const uri = assertNonEmptyString(record.uri, 'StorageLocationHint.uri');

  const allowedSchemes = URL_SCHEMES_BY_KIND[kind];
  if (allowedSchemes !== undefined) {
    parseSafeUrl(uri, allowedSchemes, `StorageLocationHint(${kind}).uri`);
  } else if (NON_URL_KINDS.has(kind)) {
    // Reject anything that looks like a URL with userinfo even for opaque local stores.
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(uri)) {
      throw caError(
        'CA_URL_CREDENTIALS_FORBIDDEN',
        `StorageLocationHint(${kind}).uri must not embed userinfo`
      );
    }
  }

  let priority: number | undefined;
  if (record.priority !== undefined) {
    priority = assertSafeNonNegativeInteger(record.priority, 'StorageLocationHint.priority');
  }

  let expiresAt: string | undefined;
  if (record.expiresAt !== undefined) {
    expiresAt = assertNonEmptyString(record.expiresAt, 'StorageLocationHint.expiresAt');
    const parsed = Date.parse(expiresAt);
    if (Number.isNaN(parsed)) {
      throw caError(
        'CA_INVALID_EXPIRY',
        'StorageLocationHint.expiresAt must be an ISO-8601 date-time'
      );
    }
  }

  const out: { -readonly [K in keyof StorageLocationHint]: StorageLocationHint[K] } = {
    kind,
    uri
  };
  if (priority !== undefined) out.priority = priority;
  if (expiresAt !== undefined) out.expiresAt = expiresAt;
  return Object.freeze(out);
}
