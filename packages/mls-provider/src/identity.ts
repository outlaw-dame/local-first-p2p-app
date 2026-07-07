import { mlsError } from './errors.js';

/**
 * Pinned credential payload version. MLS credentials in this protocol
 * are minimal identity bindings (ADR-012, ADR-015): they carry the
 * controller/device binding and a signing-key reference, nothing else.
 * Authorization truth stays in the identity-control log; the credential
 * only lets the projection layer resolve an MLS leaf to a protocol
 * device.
 */
export const MLS_CREDENTIAL_VERSION = 'lfp2p.mls-credential.v1' as const;

/** Hard bound on encoded credential identity bytes. */
export const MAX_CREDENTIAL_BYTES = 1024;

const MAX_FIELD_LENGTH = 256;

export type MlsIdentityBinding = Readonly<{
  controllerId: string;
  deviceId: string;
  /** Reference to the device signing key (e.g. a digest string). */
  signingKeyRef: string;
}>;

function assertField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_FIELD_LENGTH) {
    throw mlsError(
      'MLS_CREDENTIAL_INVALID',
      `${label} must be a non-empty string of at most ${MAX_FIELD_LENGTH} characters`
    );
  }
  return value;
}

export function validateIdentityBinding(value: unknown): MlsIdentityBinding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw mlsError('MLS_CREDENTIAL_INVALID', 'identity binding must be a plain object');
  }
  const record = value as Record<string, unknown>;
  return Object.freeze({
    controllerId: assertField(record.controllerId, 'identity.controllerId'),
    deviceId: assertField(record.deviceId, 'identity.deviceId'),
    signingKeyRef: assertField(record.signingKeyRef, 'identity.signingKeyRef')
  });
}

/**
 * Deterministic encoding: fixed field order, no whitespace variance.
 * The shape is closed (exactly four fields), so explicit ordering is
 * sufficient for a canonical form.
 */
export function encodeIdentityBinding(binding: MlsIdentityBinding): Uint8Array {
  const validated = validateIdentityBinding(binding);
  const json = JSON.stringify({
    v: MLS_CREDENTIAL_VERSION,
    controllerId: validated.controllerId,
    deviceId: validated.deviceId,
    signingKeyRef: validated.signingKeyRef
  });
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > MAX_CREDENTIAL_BYTES) {
    throw mlsError(
      'MLS_CREDENTIAL_INVALID',
      `encoded credential exceeds ${MAX_CREDENTIAL_BYTES} bytes`
    );
  }
  return bytes;
}

/**
 * Strict decode: rejects oversized payloads, unknown versions, missing
 * or extra fields, and non-string values. Fail closed — a credential
 * this decoder rejects must never be treated as a valid member
 * binding.
 */
export function decodeIdentityBinding(bytes: Uint8Array): MlsIdentityBinding {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw mlsError('MLS_CREDENTIAL_INVALID', 'credential identity bytes are empty');
  }
  if (bytes.byteLength > MAX_CREDENTIAL_BYTES) {
    throw mlsError(
      'MLS_CREDENTIAL_INVALID',
      `credential identity exceeds ${MAX_CREDENTIAL_BYTES} bytes`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw mlsError('MLS_CREDENTIAL_INVALID', 'credential identity is not valid UTF-8 JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw mlsError('MLS_CREDENTIAL_INVALID', 'credential identity must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ['controllerId', 'deviceId', 'signingKeyRef', 'v'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw mlsError('MLS_CREDENTIAL_INVALID', 'credential identity has unexpected fields');
  }
  if (record.v !== MLS_CREDENTIAL_VERSION) {
    throw mlsError('MLS_CREDENTIAL_INVALID', 'unsupported credential version');
  }
  return validateIdentityBinding(record);
}

export function identityBindingsEqual(a: MlsIdentityBinding, b: MlsIdentityBinding): boolean {
  return (
    a.controllerId === b.controllerId &&
    a.deviceId === b.deviceId &&
    a.signingKeyRef === b.signingKeyRef
  );
}
