import { capabilityError } from './errors.js';

export const BEARCAP_REF_VERSION = 'lfp2p.capability.bearcap.v1' as const;

export const BEARCAP_PURPOSES = [
  'invite-bootstrap',
  'encrypted-bundle-pickup',
  'temporary-media-fetch',
  'bridge-pickup',
  'recovery-handoff-bootstrap'
] as const;

export type BearcapPurpose = (typeof BEARCAP_PURPOSES)[number];

export type BearcapRefV1 = Readonly<{
  version: typeof BEARCAP_REF_VERSION;
  bearcapId: string;
  purpose: BearcapPurpose;
  createdAt: string;
  expiresAt: string;
  singleUse: boolean;
  maxUses?: number;
  redactionDigest: string;
  audienceHint?: string;
}>;

const MAX_BEARCAP_ID_LENGTH = 256;
const MAX_AUDIENCE_HINT_LENGTH = 256;
const DIGEST_RE = /^(sha-256|sha-512|blake3):[A-Za-z0-9_-]{8,512}$/u;
const FORBIDDEN_SECRET_MARKERS = ['://', '?', '#', '&', '='] as const;

export function validateBearcapRef(value: unknown): BearcapRefV1 {
  const record = assertPlainObject(value, 'BearcapRefV1');
  if (record.version !== BEARCAP_REF_VERSION) {
    throw capabilityError('CAP_UNKNOWN_VERSION', 'BearcapRefV1.version is not supported');
  }
  const bearcapId = assertMetadataId(record.bearcapId, 'BearcapRefV1.bearcapId');
  const purpose = assertPurpose(record.purpose);
  const createdAt = assertTimestamp(record.createdAt, 'BearcapRefV1.createdAt');
  const expiresAt = assertTimestamp(record.expiresAt, 'BearcapRefV1.expiresAt');
  if (Date.parse(createdAt) >= Date.parse(expiresAt)) {
    throw capabilityError(
      'CAP_INVALID_TIMESTAMP',
      'BearcapRefV1.createdAt must be before expiresAt'
    );
  }
  if (typeof record.singleUse !== 'boolean') {
    throw capabilityError('CAP_INVALID_INPUT', 'BearcapRefV1.singleUse must be a boolean');
  }
  const maxUses = record.maxUses === undefined ? undefined : assertMaxUses(record.maxUses);
  const redactionDigest = assertDigest(record.redactionDigest, 'BearcapRefV1.redactionDigest');
  const audienceHint =
    record.audienceHint === undefined
      ? undefined
      : assertAudienceHint(record.audienceHint, 'BearcapRefV1.audienceHint');

  return Object.freeze({
    version: BEARCAP_REF_VERSION,
    bearcapId,
    purpose,
    createdAt,
    expiresAt,
    singleUse: record.singleUse,
    ...(maxUses === undefined ? {} : { maxUses }),
    redactionDigest,
    ...(audienceHint === undefined ? {} : { audienceHint })
  });
}

export function isBearcapExpired(ref: BearcapRefV1, now: string): boolean {
  const parsedNow = Date.parse(now);
  if (!Number.isFinite(parsedNow)) return true;
  return Date.parse(ref.expiresAt) <= parsedNow;
}

export function assertBearcapUsable(
  ref: BearcapRefV1,
  now: string,
  observedUses: number
): BearcapRefV1 {
  const validated = validateBearcapRef(ref);
  if (isBearcapExpired(validated, now)) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', 'BearcapRefV1 is expired');
  }
  if (!Number.isSafeInteger(observedUses) || observedUses < 0) {
    throw capabilityError('CAP_INVALID_NUMBER', 'observedUses must be a safe non-negative integer');
  }
  if (validated.singleUse && observedUses > 0) {
    throw capabilityError('CAP_INVALID_NUMBER', 'single-use bearcap has already been used');
  }
  if (validated.maxUses !== undefined && observedUses >= validated.maxUses) {
    throw capabilityError('CAP_INVALID_NUMBER', 'bearcap maxUses has been reached');
  }
  return validated;
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a plain object`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw capabilityError('CAP_INVALID_INPUT', `${label} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertMetadataId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw capabilityError('CAP_INVALID_ID', `${label} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_BEARCAP_ID_LENGTH) {
    throw capabilityError('CAP_INVALID_ID', `${label} is too long`);
  }
  if (FORBIDDEN_SECRET_MARKERS.some((marker) => trimmed.includes(marker))) {
    throw capabilityError(
      'CAP_PRIVATE_LEAK_RISK',
      `${label} appears to contain a secret-bearing URL or token`
    );
  }
  return trimmed;
}

function assertAudienceHint(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw capabilityError('CAP_INVALID_ID', `${label} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_AUDIENCE_HINT_LENGTH) {
    throw capabilityError('CAP_INVALID_ID', `${label} is too long`);
  }
  return trimmed;
}

function assertTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw capabilityError('CAP_INVALID_TIMESTAMP', `${label} must be a valid timestamp`);
  }
  return value;
}

function assertDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) {
    throw capabilityError('CAP_INVALID_DIGEST', `${label} must be a redacted digest ref`);
  }
  return value;
}

function assertPurpose(value: unknown): BearcapPurpose {
  if (typeof value !== 'string' || !(BEARCAP_PURPOSES as readonly string[]).includes(value)) {
    throw capabilityError('CAP_INVALID_ENUM', 'BearcapRefV1.purpose is not allowed');
  }
  return value as BearcapPurpose;
}

function assertMaxUses(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw capabilityError(
      'CAP_INVALID_NUMBER',
      'BearcapRefV1.maxUses must be a positive safe integer'
    );
  }
  return value as number;
}
