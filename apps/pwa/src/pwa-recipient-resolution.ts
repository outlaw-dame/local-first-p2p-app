import {
  resolveRecipients,
  type RecipientDevice,
  type RecipientIdentity,
  type ResolvedRecipient
} from '@lfp2p/envelope';
import type { StoredIdentityControlProjection } from '@lfp2p/local-store';

/**
 * Phase 5.12D sender-side recipient resolution.
 *
 * The local store's current projection type predates wrap-key publication, so
 * this module accepts projections whose device rows may carry the Phase 5.12C
 * public wrap metadata (`wrapPublicKey`, `wrapKeyRef`). It deliberately keeps
 * that adapter at the PWA boundary instead of widening the lower-level envelope
 * builder: `@lfp2p/envelope` stays a pure crypto/protocol helper, while the app
 * decides which local identity records are trustworthy enough to use.
 */
export type RecipientDeviceProjection = Readonly<{
  deviceId: string;
  publicKey: string;
  status: 'active' | 'revoked';
  authorizedAt: string;
  revokedAt?: string;
  wrapPublicKey?: string;
  wrapKeyRef?: string;
}>;

export type RecipientIdentityProjection = Omit<StoredIdentityControlProjection, 'devices'> &
  Readonly<{
    devices: Readonly<Record<string, RecipientDeviceProjection>>;
  }>;

export type ResolveRecipientsFromProjectionsInput = Readonly<{
  /** Local identity projections for the peers the sender intends to address. */
  projections: readonly RecipientIdentityProjection[];
  /** Optional allow-list of recipient identity ids selected by the caller/UI. */
  recipientIdentityIds?: readonly string[];
  /**
   * Defaults to true. When true, a projection without controller authority is
   * ignored so a half-seen identity cannot receive encrypted material.
   */
  requireControllerKnown?: boolean;
}>;

/**
 * Resolve deterministic recipient wraps from local identity projections.
 *
 * Safety properties:
 * - revoked devices are skipped;
 * - active devices without a published wrap key are skipped rather than guessed;
 * - duplicate identity projections are rejected;
 * - optional identity allow-list is exact-match only;
 * - final validation/sorting is delegated to `@lfp2p/envelope.resolveRecipients`.
 */
export function resolveEnvelopeRecipientsFromIdentityProjections(
  input: ResolveRecipientsFromProjectionsInput
): readonly ResolvedRecipient[] {
  if (!Array.isArray(input.projections)) {
    throw new Error('projections must be an array');
  }
  const requireControllerKnown = input.requireControllerKnown ?? true;
  const allowed = normalizeRecipientAllowList(input.recipientIdentityIds);
  const seenIdentities = new Set<string>();
  const identities: RecipientIdentity[] = [];

  for (const projection of input.projections) {
    const identityId = requireNonEmpty(projection.identityId, 'projection.identityId');
    if (seenIdentities.has(identityId)) {
      throw new Error(`Duplicate recipient identity projection: ${identityId}`);
    }
    seenIdentities.add(identityId);

    if (allowed !== undefined && !allowed.has(identityId)) continue;
    if (requireControllerKnown && projection.controllerPublicKey === undefined) continue;

    const devices: Record<string, RecipientDevice> = {};
    for (const device of Object.values(projection.devices)) {
      if (device.status !== 'active') continue;
      if (device.wrapPublicKey === undefined || device.wrapKeyRef === undefined) continue;
      devices[device.deviceId] = {
        deviceId: device.deviceId,
        status: device.status,
        wrapPublicKey: device.wrapPublicKey,
        wrapKeyRef: device.wrapKeyRef
      };
    }

    if (Object.keys(devices).length > 0) {
      identities.push({ identityId, devices });
    }
  }

  return resolveRecipients(identities);
}

function normalizeRecipientAllowList(
  values: readonly string[] | undefined
): ReadonlySet<string> | undefined {
  if (values === undefined) return undefined;
  const out = new Set<string>();
  for (const value of values) out.add(requireNonEmpty(value, 'recipientIdentityId'));
  return out;
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}
