/**
 * Phase 2.2 — locally-emitted identity event helpers.
 *
 * The PWA owns three identity-emission paths today:
 *  - `identity.controller.created` (handled by the existing identity
 *    bootstrap; not re-implemented here);
 *  - `identity.contact-card.published` (this module — emitted when the
 *    user exports a contact card so the publication is recorded in
 *    the identity-control log with an auditable digest);
 *  - device rotation (logic helper exposed for the future rotation
 *    UI; safe to call now from a CLI or admin surface).
 *
 * Discipline:
 *  - The store-side append (`appendLocalIdentityEvent`) is atomic;
 *    we hand it the canonical projection-update callback from this
 *    module.
 *  - The callback applies the protocol-shaped projection
 *    (`applyIdentityControlEvent`) and then re-shapes onto the
 *    persistence-layer snapshot. It does not own state; the store
 *    transaction does.
 *  - We never inline keys into payloads or logs. The digest of the
 *    contact card is a `sha-256:<base64url>` ref, never the bytes.
 */
import { sha256Base64Url, type SigningKeypair } from '@lfp2p/crypto';
import {
  applyIdentityControlEvent,
  createEmptyIdentityControlState,
  type LocalDeviceSession
} from '@lfp2p/identity';
import {
  type IdentityControlProjectionUpdate,
  type StoredIdentityControlProjection,
  type createLocalFirstStore
} from '@lfp2p/local-store';
import { createUnsignedEvent, type SignedEventEnvelope } from '@lfp2p/protocol';
import { signEventEnvelope } from '@lfp2p/crypto';

const MAX_ID_LENGTH = 256;
const MAX_PUBLIC_KEY_LENGTH = 2048;
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{1,2048}$/;

type Store = ReturnType<typeof createLocalFirstStore>;

/**
 * Canonical projection-update callback for locally-emitted identity
 * events. Bridges `@lfp2p/identity`'s frozen
 * `IdentityControlState` to the persistence-layer
 * `StoredIdentityControlProjection`. Identical in semantics to the
 * inbound-path callback in `@lfp2p/sync-client`.
 */
export const identityProjectionUpdate: IdentityControlProjectionUpdate = (
  current,
  event,
  updatedAt
) => {
  const state =
    current === undefined
      ? createEmptyIdentityControlState()
      : {
          epoch: current.epoch,
          devices: current.devices,
          capabilities: current.capabilities,
          ...(current.controllerPublicKey === undefined
            ? {}
            : { controllerPublicKey: current.controllerPublicKey }),
          ...(current.contactCardPublication === undefined
            ? {}
            : { contactCardPublication: current.contactCardPublication }),
          ...(current.lastEventId === undefined ? {} : { lastEventId: current.lastEventId })
        };
  const next = applyIdentityControlEvent(state, event);
  const stored: StoredIdentityControlProjection = {
    identityId: event.author,
    epoch: next.epoch,
    devices: next.devices,
    capabilities: next.capabilities,
    ...(next.controllerPublicKey === undefined
      ? {}
      : { controllerPublicKey: next.controllerPublicKey }),
    ...(next.contactCardPublication === undefined
      ? {}
      : { contactCardPublication: next.contactCardPublication }),
    ...(next.lastEventId === undefined ? {} : { lastEventId: next.lastEventId }),
    updatedAt
  };
  return stored;
};

/**
 * Compute the canonical digest reference for a serialized contact
 * card document. The wire format is `sha-256:<base64url>`, matching
 * the `DIGEST_REF_PATTERN` enforced by `validateIdentityEvent`.
 */
export async function contactCardDigestRef(serialized: string): Promise<string> {
  const digest = await sha256Base64Url(serialized);
  // sha256Base64Url returns the bare base64url body; we wrap into the
  // canonical algorithm-prefixed form expected by
  // validateIdentityEvent's DIGEST_REF_PATTERN.
  return `sha-256:${digest}`;
}

export type EmitContactCardPublishedInput = Readonly<{
  store: Store;
  identityId: string;
  deviceId: string;
  controllerKeypair: SigningKeypair;
  serializedContactCard: string;
  /** Defaults to a fresh `new Date().toISOString()`. */
  capturedAt?: string;
  /** Defaults to `globalThis.crypto.randomUUID()`-derived. */
  eventId?: string;
}>;

/**
 * Build, sign, and append an `identity.contact-card.published` event
 * recording the digest of the serialized contact card. The signed
 * event lands in `signedEvents` and the projection's
 * `contactCardPublication` snapshot updates atomically.
 *
 * Returns the updated projection snapshot. Idempotent on the
 * generated `eventId` via the store layer.
 */
export async function emitContactCardPublishedEvent(
  input: EmitContactCardPublishedInput
): Promise<StoredIdentityControlProjection> {
  if (input.serializedContactCard.length === 0) {
    throw new Error('emitContactCardPublishedEvent: serializedContactCard is empty');
  }
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const eventId = input.eventId ?? newEventId('cc_pub');
  const digestRef = await contactCardDigestRef(input.serializedContactCard);
  const signed = signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'identity.contact-card.published',
      author: input.identityId,
      deviceId: input.deviceId,
      createdAt: capturedAt,
      privacy: 'self',
      payload: {
        contactCardDigest: digestRef,
        capturedAt
      }
    }),
    input.controllerKeypair
  );
  return input.store.appendLocalIdentityEvent(signed, identityProjectionUpdate);
}

export type EmitDeviceAuthorizedInput = Readonly<{
  store: Store;
  identityId: string;
  authorizedDeviceId: string;
  authorizedPublicKey: string;
  /**
   * Optional Phase 5.12C sender-visible public wrap metadata. If one field is
   * supplied, the other must also be supplied. Private wrap keys never appear
   * in this event.
   */
  wrapPublicKey?: string;
  wrapKeyRef?: string;
  /** Caller must pass `currentEpoch + 1`. */
  epoch: number;
  controllerKeypair: SigningKeypair;
  signingDeviceId: string;
  eventId?: string;
  createdAt?: string;
}>;

/**
 * Build, sign, and append an `identity.device.authorized` event.
 *
 * Phase 5.12C uses this path to publish the local device session's public
 * wrap metadata (`wrapPublicKey` / `wrapKeyRef`) into the identity-control
 * projection so later sender-side mailbox/chat code can resolve real peer
 * recipient devices. The private wrap key remains local-only.
 */
export async function emitDeviceAuthorizedEvent(
  input: EmitDeviceAuthorizedInput
): Promise<StoredIdentityControlProjection> {
  const wrapPublicKey = optionalPublicKey(input.wrapPublicKey, 'wrapPublicKey');
  const wrapKeyRef = optionalId(input.wrapKeyRef, 'wrapKeyRef');
  if ((wrapPublicKey === undefined) !== (wrapKeyRef === undefined)) {
    throw new Error('wrapPublicKey and wrapKeyRef must be supplied together');
  }

  const eventId = input.eventId ?? newEventId('dev_auth');
  const createdAt = input.createdAt ?? new Date().toISOString();
  const signed: SignedEventEnvelope = signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'identity.device.authorized',
      author: input.identityId,
      deviceId: input.signingDeviceId,
      createdAt,
      privacy: 'self',
      payload: {
        authorizedDeviceId: requireId(input.authorizedDeviceId, 'authorizedDeviceId'),
        authorizedPublicKey: requirePublicKey(input.authorizedPublicKey, 'authorizedPublicKey'),
        epoch: input.epoch,
        ...(wrapPublicKey === undefined ? {} : { wrapPublicKey }),
        ...(wrapKeyRef === undefined ? {} : { wrapKeyRef })
      }
    }),
    input.controllerKeypair
  );
  return input.store.appendLocalIdentityEvent(signed, identityProjectionUpdate);
}

export type EnsureLocalDeviceWrapMetadataInput = Readonly<{
  store: Store;
  session: LocalDeviceSession;
  /** Defaults to the local session keypair; must match the projection controller. */
  controllerKeypair?: SigningKeypair;
  eventId?: string;
  createdAt?: string;
}>;

export type EnsureLocalDeviceWrapMetadataResult = Readonly<{
  status: 'already-published' | 'published';
  projection: StoredIdentityControlProjection;
}>;

/**
 * Publish or repair this local device's public wrap metadata in the identity
 * projection.
 *
 * This bridges Phase 5.12B device-session wrap keys and Phase 5.12C projection
 * publication. It is safe to call during app/bootstrap foreground paths: if the
 * current active device already advertises the session's wrap metadata, it is a
 * no-op. If the projection predates wrap metadata, it emits a fresh
 * controller-signed `identity.device.authorized` event at `epoch + 1`.
 */
export async function ensureLocalDeviceWrapMetadataPublished(
  input: EnsureLocalDeviceWrapMetadataInput
): Promise<EnsureLocalDeviceWrapMetadataResult> {
  const session = input.session;
  const identityId = requireId(session.identity.identityId, 'session.identity.identityId');
  const deviceId = requireId(session.identity.deviceId, 'session.identity.deviceId');
  const publicKey = requirePublicKey(session.identity.publicKey, 'session.identity.publicKey');
  const wrapPublicKey = requirePublicKey(
    session.wrap.keypair.publicKey,
    'session.wrap.keypair.publicKey'
  );
  const wrapKeyRef = requireId(session.wrap.keyRef, 'session.wrap.keyRef');
  const projection = await input.store.getIdentityControlProjection(identityId);

  if (projection === undefined || projection.controllerPublicKey === undefined) {
    throw new Error('identity control projection with controller is required before wrap publication');
  }
  const controllerKeypair = input.controllerKeypair ?? session.keypair;
  if (controllerKeypair.publicKey !== projection.controllerPublicKey) {
    throw new Error('controllerKeypair does not match identity controller public key');
  }

  const device = projection.devices[deviceId];
  if (device === undefined) {
    throw new Error('local device is missing from identity control projection');
  }
  if (device.status !== 'active') {
    throw new Error('local device is not active in identity control projection');
  }
  if (device.publicKey !== publicKey) {
    throw new Error('local device public key does not match identity control projection');
  }
  if (device.wrapPublicKey === wrapPublicKey && device.wrapKeyRef === wrapKeyRef) {
    return Object.freeze({ status: 'already-published', projection });
  }

  const updated = await emitDeviceAuthorizedEvent({
    store: input.store,
    identityId,
    authorizedDeviceId: deviceId,
    authorizedPublicKey: publicKey,
    wrapPublicKey,
    wrapKeyRef,
    epoch: projection.epoch + 1,
    controllerKeypair,
    signingDeviceId: deviceId,
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt })
  });
  return Object.freeze({ status: 'published', projection: updated });
}

export type EmitDeviceRotatedInput = Readonly<{
  store: Store;
  identityId: string;
  deviceIdToRotate: string;
  previousPublicKey: string;
  newPublicKey: string;
  /**
   * The next monotonic epoch. Caller must pass `currentEpoch + 1`
   * (the store-level projection update will throw on a stale value).
   */
  epoch: number;
  controllerKeypair: SigningKeypair;
  signingDeviceId: string;
  eventId?: string;
  createdAt?: string;
}>;

/**
 * Build, sign, and append an `identity.device.rotated` event.
 * Convenience for the future rotation UI; safe to call now from
 * a CLI or admin surface. Returns the updated projection snapshot.
 */
export async function emitDeviceRotatedEvent(
  input: EmitDeviceRotatedInput
): Promise<StoredIdentityControlProjection> {
  const eventId = input.eventId ?? newEventId('dev_rot');
  const createdAt = input.createdAt ?? new Date().toISOString();
  const signed: SignedEventEnvelope = signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'identity.device.rotated',
      author: input.identityId,
      deviceId: input.signingDeviceId,
      createdAt,
      privacy: 'self',
      payload: {
        deviceId: input.deviceIdToRotate,
        previousPublicKey: input.previousPublicKey,
        newPublicKey: input.newPublicKey,
        epoch: input.epoch
      }
    }),
    input.controllerKeypair
  );
  return input.store.appendLocalIdentityEvent(signed, identityProjectionUpdate);
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ID_LENGTH) {
    throw new Error(`${field} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
  }
  return trimmed;
}

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireId(value, field);
}

function requirePublicKey(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PUBLIC_KEY_LENGTH) {
    throw new Error(
      `${field} must be a non-empty base64url public key of at most ${MAX_PUBLIC_KEY_LENGTH} characters`
    );
  }
  if (!PUBLIC_KEY_PATTERN.test(trimmed)) {
    throw new Error(`${field} must be a base64url-encoded public key`);
  }
  return trimmed;
}

function optionalPublicKey(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requirePublicKey(value, field);
}

function newEventId(prefix: string): string {
  const rand = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `evt_${prefix}_${rand}`;
}
