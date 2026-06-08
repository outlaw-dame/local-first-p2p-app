import { canonicalizeJson, type EventKind, type JsonObject, type JsonValue, type PrivacyScope, type SourceRef } from '@lfp2p/protocol';

export const PRIVATE_PAYLOAD_AAD_VERSION = 'lfp2p.private-payload.aad.v1' as const;

export type EnvelopeScope = 'self' | 'dm' | 'group';
export type RecipientDeviceStatus = 'active' | 'revoked';

export type RecipientDevice = Readonly<{
  deviceId: string;
  status: RecipientDeviceStatus;
  wrapPublicKey?: string;
  wrapKeyRef?: string;
}>;

export type RecipientIdentity = Readonly<{
  identityId: string;
  devices: Readonly<Record<string, RecipientDevice>>;
}>;

export type ResolvedRecipient = Readonly<{
  recipientIdentityId: string;
  recipientDeviceId: string;
  wrapPublicKey: string;
  wrapKeyRef: string;
}>;

export type PrivatePayloadAadInput = Readonly<{
  eventId: string;
  kind: EventKind;
  author: string;
  deviceId: string;
  createdAt: string;
  privacy: PrivacyScope;
  lamport?: number;
  schemaVersion?: number;
  refs?: readonly SourceRef[];
}>;

export function resolveRecipients(identities: readonly RecipientIdentity[]): readonly ResolvedRecipient[] {
  const out: ResolvedRecipient[] = [];
  const seen = new Set<string>();
  for (const identity of identities) {
    const identityId = requireText(identity.identityId, 'identityId');
    for (const device of Object.values(identity.devices)) {
      if (device.status === 'revoked') continue;
      if (device.status !== 'active') throw new Error('Unsupported recipient device status');
      const deviceId = requireText(device.deviceId, 'deviceId');
      if (seen.has(deviceId)) throw new Error(`Duplicate recipient device id: ${deviceId}`);
      seen.add(deviceId);
      out.push(Object.freeze({
        recipientIdentityId: identityId,
        recipientDeviceId: deviceId,
        wrapPublicKey: requireText(device.wrapPublicKey, 'wrapPublicKey'),
        wrapKeyRef: requireText(device.wrapKeyRef, 'wrapKeyRef')
      }));
    }
  }
  if (out.length === 0) throw new Error('No active recipient devices resolved');
  return Object.freeze(out.sort((left, right) => {
    const identityOrder = left.recipientIdentityId.localeCompare(right.recipientIdentityId);
    if (identityOrder !== 0) return identityOrder;
    return left.recipientDeviceId.localeCompare(right.recipientDeviceId);
  }));
}

export function buildPrivatePayloadAad(input: PrivatePayloadAadInput): string {
  const privacy = requireEnvelopeScope(input.privacy);
  const lamport = input.lamport ?? 0;
  const schemaVersion = input.schemaVersion ?? 1;
  requireSafeNonNegativeInteger(lamport, 'lamport');
  requireSafePositiveInteger(schemaVersion, 'schemaVersion');

  return canonicalizeJson({
    aadVersion: PRIVATE_PAYLOAD_AAD_VERSION,
    eventVersion: 'lfp2p.event.v1',
    eventId: requireText(input.eventId, 'eventId'),
    kind: input.kind,
    author: requireText(input.author, 'author'),
    deviceId: requireText(input.deviceId, 'deviceId'),
    createdAt: requireIsoDate(input.createdAt, 'createdAt'),
    lamport,
    privacy,
    schemaVersion,
    refs: normalizeRefs(input.refs)
  });
}

function requireEnvelopeScope(value: PrivacyScope): EnvelopeScope {
  if (value !== 'self' && value !== 'dm' && value !== 'group') {
    throw new Error(`Envelope payload builder requires self, dm, or group privacy; got ${String(value)}`);
  }
  return value;
}

function normalizeRefs(refs: readonly SourceRef[] | undefined): readonly JsonObject[] {
  if (refs === undefined) return Object.freeze([]);
  return Object.freeze(refs.map((ref, index) => {
    const normalized: Record<string, JsonValue> = {
      sourceId: requireText(ref.sourceId, `refs[${index}].sourceId`)
    };
    if (ref.sequence !== undefined) {
      normalized.sequence = requireSafeNonNegativeInteger(ref.sequence, `refs[${index}].sequence`);
    }
    if (ref.hash !== undefined) {
      normalized.hash = requireText(ref.hash, `refs[${index}].hash`);
    }
    return Object.freeze(normalized) as JsonObject;
  }));
}

function requireText(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireIsoDate(value: string, label: string): string {
  requireText(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date string`);
  return value;
}

function requireSafeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a safe non-negative integer`);
  return value;
}

function requireSafePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a safe positive integer`);
  return value;
}
