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

function requireText(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}
