export const CONTENT_ADDRESSING_VERSION = 'lfp2p.content-addressing.v1' as const;
export type ContentAddressingVersion = typeof CONTENT_ADDRESSING_VERSION;

export {
  CA_ERROR_CODES,
  ContentAddressingError,
  caError
} from './errors.js';
export type { CAErrorCode } from './errors.js';

export {
  MAX_CANONICAL_DEPTH,
  MAX_SAFE_BYTE_LENGTH,
  assertBase64UrlNoPad,
  assertForbiddenKey,
  assertNonEmptyString,
  assertPlainObject,
  assertSafeNonNegativeInteger,
  hasControlCharacters,
  isPlainObject,
  parseSafeUrl
} from './validation.js';

export {
  SUPPORTED_HASH_ALGORITHMS,
  assertHashAlgorithm,
  canonicalizeJson,
  createDigest,
  isHashAlgorithm,
  validateDigestRef,
  verifyDigest
} from './digest.js';
export type {
  DigestRef,
  HashAlgorithm,
  JsonObject,
  JsonPrimitive,
  JsonValue
} from './digest.js';

export {
  LOCATION_HINT_KINDS,
  isLocationHintKind,
  validateStorageLocationHint
} from './location-hint.js';
export type { LocationHintKind, StorageLocationHint } from './location-hint.js';

export {
  CONTENT_LINK_CODECS,
  createContentLink,
  isContentLinkCodec,
  validateCidV1String,
  validateContentLink
} from './content-link.js';
export type { ContentLink, ContentLinkCodec } from './content-link.js';

export {
  COMPRESSION_ALGORITHMS,
  ENCRYPTION_SCHEMES,
  MAX_BLOCK_BYTE_LENGTH,
  MAX_COMPRESSION_RATIO,
  MAX_DECODED_BYTE_LENGTH,
  MAX_STORAGE_HINTS,
  createBlockRef,
  validateBlockRef
} from './block-ref.js';
export type {
  BlockRef,
  BlockSource,
  CompressionAlgorithm,
  CompressionDescriptor,
  EncryptionDescriptor,
  EncryptionScheme,
  Privacy
} from './block-ref.js';

export {
  BUNDLE_FORMATS,
  BUNDLE_PURPOSES,
  MAX_BUNDLE_BYTE_LENGTH,
  MAX_BUNDLE_ROOTS,
  createBundleRef,
  validateBundleRef
} from './bundle-ref.js';
export type {
  BundleFormat,
  BundlePurpose,
  BundleRef,
  BundleRoot
} from './bundle-ref.js';

export {
  OBJECT_REF_KINDS,
  createObjectRef,
  isObjectRefKind,
  validateObjectRef
} from './object-ref.js';
export type {
  BundleObjectRef,
  ContentBackedKind,
  ContentBackedRef,
  DomainObjectRef,
  IdentityObjectRef,
  MediaObjectRef,
  ObjectRef,
  ObjectRefKind,
  UrlObjectRef
} from './object-ref.js';

export {
  redactBlockRef,
  redactContentLink,
  redactDigestRef
} from './redaction.js';
