import type { JsonObject } from './index.js';

export const MLS_GROUP_CONTROL_PAYLOAD_VERSION = 'lfp2p.mls-group-control.v1' as const;
export const MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION =
  'lfp2p.mls-application-message.envelope.v1' as const;

export type MlsGroupControlPayloadVersion = typeof MLS_GROUP_CONTROL_PAYLOAD_VERSION;
export type MlsApplicationMessageEnvelopeVersion = typeof MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION;

export type MlsApplicationMessageEnvelopeV1 = Readonly<{
  version: MlsApplicationMessageEnvelopeVersion;
  groupId: string;
  epoch: number;
  senderDeviceId: string;
  ciphertext: string;
  messageRef: string;
  aadRef?: string;
  contentRefs?: readonly string[];
}>;

export function looksLikeMlsApplicationMessageEnvelope(value: JsonObject): boolean {
  return (
    typeof value.version === 'string' &&
    typeof value.groupId === 'string' &&
    typeof value.epoch === 'number' &&
    typeof value.senderDeviceId === 'string' &&
    typeof value.ciphertext === 'string' &&
    typeof value.messageRef === 'string'
  );
}

export function validateMlsApplicationMessageEnvelope(
  value: JsonObject,
  outerDeviceId: string
): MlsApplicationMessageEnvelopeV1 {
  const allowedKeys = new Set([
    'version',
    'groupId',
    'epoch',
    'senderDeviceId',
    'ciphertext',
    'messageRef',
    'aadRef',
    'contentRefs'
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`payload contains unsupported MLS application envelope field: ${key}`);
    }
  }

  const version = requireNonEmptyString(value.version, 'payload.version');
  if (version !== MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION) {
    throw new Error(`Unsupported MLS application envelope version: ${version}`);
  }

  const groupId = requireNonEmptyString(value.groupId, 'payload.groupId');
  const epoch = requireSafeNonNegativeInteger(value.epoch, 'payload.epoch');
  const senderDeviceId = requireNonEmptyString(value.senderDeviceId, 'payload.senderDeviceId');
  const expectedDeviceId = requireNonEmptyString(outerDeviceId, 'outerDeviceId');
  if (senderDeviceId !== expectedDeviceId) {
    throw new Error('payload.senderDeviceId must match outer envelope deviceId');
  }

  const ciphertext = requireNonEmptyString(value.ciphertext, 'payload.ciphertext');
  validateBase64Url(ciphertext, 'payload.ciphertext');
  const messageRef = requireNonEmptyString(value.messageRef, 'payload.messageRef');

  let aadRef: string | undefined;
  if (value.aadRef !== undefined) {
    aadRef = requireNonEmptyString(value.aadRef, 'payload.aadRef');
  }

  let contentRefs: readonly string[] | undefined;
  if (value.contentRefs !== undefined) {
    if (!Array.isArray(value.contentRefs)) {
      throw new Error('payload.contentRefs must be an array');
    }
    contentRefs = value.contentRefs.map((ref, index) =>
      requireNonEmptyString(ref, `payload.contentRefs[${index}]`)
    );
  }

  return {
    version: MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION,
    groupId,
    epoch,
    senderDeviceId,
    ciphertext,
    messageRef,
    ...(aadRef === undefined ? {} : { aadRef }),
    ...(contentRefs === undefined ? {} : { contentRefs })
  };
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireSafeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe non-negative integer`);
  }
  return value;
}

function validateBase64Url(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be base64url with no padding`);
  }
}
