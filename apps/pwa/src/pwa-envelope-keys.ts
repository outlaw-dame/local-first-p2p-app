/**
 * Phase 5.12 (Part E, recipient side) — device content-key resolver wiring.
 *
 * Bridges the device wrap keypair (5.12B, `LocalDeviceSession.wrap`) to the
 * recipient content-key resolver (5.12A, `@lfp2p/envelope`) to produce the
 * `resolveKeyMaterial(event)` that the mailbox inbound sync router and the
 * expiry-sweep consume — and that chat inbound decryption will reuse.
 *
 * Given a signed dm/group event, it reads the encrypted payload envelope,
 * finds the `recipientWraps` entry addressed to this device, and unwraps the
 * per-event content key with the device's wrap private key. It NEVER throws
 * into the caller: any non-resolvable event (self-scoped, not addressed to us,
 * key not yet available, malformed) yields `undefined`, so the sync router
 * stores the event durably and self-heals on a later pass.
 */
import { resolvePayloadKeyMaterialForDevice, type LocalDeviceWrapKey } from '@lfp2p/envelope';
import type { PrivatePayloadEnvelopeV1, SignedEventEnvelope } from '@lfp2p/protocol';

/** The subset of a device session this resolver needs (avoids an identity dep). */
export type DeviceWrapContext = Readonly<{
  identityId: string;
  deviceId: string;
  wrapKeyRef: string;
  wrapPrivateKey: string;
}>;

/**
 * Build the local device's wrap key set for the resolver. Identity is bound
 * (defence in depth): a wrap that borrows this device id under a different
 * identity is not honoured by the resolver.
 */
export function deviceWrapKeys(ctx: DeviceWrapContext): readonly LocalDeviceWrapKey[] {
  if (ctx === null || typeof ctx !== 'object') {
    throw new Error('DeviceWrapContext must be an object');
  }
  return Object.freeze([
    Object.freeze({
      deviceId: requireNonEmpty(ctx.deviceId, 'deviceId'),
      wrapKeyRef: requireNonEmpty(ctx.wrapKeyRef, 'wrapKeyRef'),
      wrapPrivateKey: requireNonEmpty(ctx.wrapPrivateKey, 'wrapPrivateKey'),
      identityId: requireNonEmpty(ctx.identityId, 'identityId')
    })
  ]);
}

/**
 * A `resolveKeyMaterial(event) => keyMaterial | undefined` bound to this
 * device's wrap key(s). Suitable directly as `mailboxRouting.resolveKeyMaterial`
 * (and, wrapped with the envelope row, the sweep's `resolveEnvelopeKey`).
 */
export function createDeviceEnvelopeKeyResolver(
  wrapKeys: readonly LocalDeviceWrapKey[]
): (event: SignedEventEnvelope) => string | undefined {
  if (!Array.isArray(wrapKeys) || wrapKeys.length === 0) {
    throw new Error('wrapKeys must be a non-empty array');
  }
  return (event: SignedEventEnvelope): string | undefined => {
    const envelope = asPayloadEnvelope(event);
    if (envelope === undefined) return undefined;
    try {
      return resolvePayloadKeyMaterialForDevice(envelope, wrapKeys);
    } catch {
      // The resolver only throws on programmer error (bad wrapKeys), which we
      // validated above; treat any unexpected throw as "not resolvable".
      return undefined;
    }
  };
}

/**
 * Extract the private-payload envelope from a signed event, or `undefined`
 * when the event carries no wrap-bearing envelope (e.g. a `self` event, a
 * cleartext payload, or a malformed one). Only a plain object carrying a
 * `recipientWraps` array is treated as a candidate.
 */
function asPayloadEnvelope(event: SignedEventEnvelope): PrivatePayloadEnvelopeV1 | undefined {
  const payload: unknown = event?.payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  if (!('recipientWraps' in (payload as Record<string, unknown>))) return undefined;
  return payload as PrivatePayloadEnvelopeV1;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}
