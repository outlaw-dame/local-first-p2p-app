/**
 * Phase 2.2 — identity-event persistence + dispatch fixes.
 *
 * Covers:
 *  - The locally-emitted append path (`appendLocalIdentityEvent`):
 *    atomic event + projection write, idempotency on eventId,
 *    rejection of mismatched identityId.
 *  - The replay path (`listLocalIdentityEvents`) returns identity
 *    events in stable order for caller-side reseed.
 *  - The Phase 2.1 contact-card publication field
 *    (`contactCardPublication`) propagates onto the persisted
 *    projection snapshot.
 *  - The Phase 2.1 regression fix: `identity.device.rotated` and
 *    `identity.contact-card.published` on the inbound sync path
 *    now actually update the projection (the previous
 *    `isIdentityControlEvent` dispatch silently dropped them).
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import {
  applyIdentityControlEvent,
  createEmptyIdentityControlState,
  seedIdentityControlProjection
} from '@lfp2p/identity';
import {
  createUnsignedEvent,
  placeholderPrivatePayloadEnvelope,
  type EventKind,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import {
  createLocalFirstStore,
  type IdentityControlProjectionUpdate,
  type StoredIdentityControlProjection
} from '@lfp2p/local-store';
import { processInboundSyncBatch, type InboundSyncRecord } from './index.js';

const CONTROLLER = signingKeypairFromSeed(new Uint8Array(32).fill(31));
const NEW_KEY = signingKeypairFromSeed(new Uint8Array(32).fill(32));
const ACTOR = 'identity:alice';
const INITIAL_DEVICE = 'device:alice-phone';

function signIdentity(
  eventId: string,
  kind: EventKind,
  payload: Record<string, unknown>,
  createdAt = '2026-06-03T00:00:00.000Z',
  keypair: typeof CONTROLLER = CONTROLLER
): SignedEventEnvelope {
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind,
      author: ACTOR,
      deviceId: INITIAL_DEVICE,
      createdAt,
      privacy: 'self',
      payload
    }),
    keypair
  );
}

/**
 * Identity projection update callback matching the canonical
 * sync-client pattern: bridges the package's frozen IdentityControlState
 * to the persistence-shaped StoredIdentityControlProjection. Phase 2.2
 * tests use this directly to exercise the store's atomic apply path.
 */
const projectionUpdate: IdentityControlProjectionUpdate = (current, event, updatedAt) => {
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

// ---------------------------------------------------------------------------
// appendLocalIdentityEvent
// ---------------------------------------------------------------------------

describe('Phase 2.2 — appendLocalIdentityEvent', () => {
  it('atomically persists the signed event and the projection snapshot', async () => {
    const store = createLocalFirstStore(`p22-append-${globalThis.crypto.randomUUID()}`);
    try {
      const ev = signIdentity('evt_p22_ctl_1', 'identity.controller.created', {
        controllerPublicKey: CONTROLLER.publicKey,
        initialDeviceId: INITIAL_DEVICE
      });
      const result = await store.appendLocalIdentityEvent(ev, projectionUpdate);

      expect(result.identityId).toBe(ACTOR);
      expect(result.controllerPublicKey).toBe(CONTROLLER.publicKey);
      expect(result.devices[INITIAL_DEVICE]?.status).toBe('active');

      await expect(store.getSignedEvent('evt_p22_ctl_1')).resolves.toEqual(ev);
      const projection = await store.getIdentityControlProjection(ACTOR);
      expect(projection?.controllerPublicKey).toBe(CONTROLLER.publicKey);
    } finally {
      await store.delete();
    }
  });

  it('is idempotent on eventId — a re-append returns the persisted projection', async () => {
    const store = createLocalFirstStore(`p22-idem-${globalThis.crypto.randomUUID()}`);
    try {
      const ev = signIdentity('evt_p22_idem', 'identity.controller.created', {
        controllerPublicKey: CONTROLLER.publicKey,
        initialDeviceId: INITIAL_DEVICE
      });
      const first = await store.appendLocalIdentityEvent(ev, projectionUpdate);
      const second = await store.appendLocalIdentityEvent(ev, projectionUpdate);
      expect(second).toEqual(first);
      // Only one signed event row exists for the eventId.
      const rows = await store.listLocalIdentityEvents(ACTOR);
      expect(rows.length).toBe(1);
    } finally {
      await store.delete();
    }
  });

  it('rejects an event whose author does not match the projection identityId', async () => {
    const store = createLocalFirstStore(`p22-mismatch-${globalThis.crypto.randomUUID()}`);
    try {
      const ev = signIdentity('evt_p22_mis', 'identity.controller.created', {
        controllerPublicKey: CONTROLLER.publicKey,
        initialDeviceId: INITIAL_DEVICE
      });
      const liarUpdate: IdentityControlProjectionUpdate = (_current, event, updatedAt) => ({
        identityId: 'identity:bob', // mismatched on purpose
        controllerPublicKey: CONTROLLER.publicKey,
        epoch: 0,
        devices: {
          [INITIAL_DEVICE]: {
            deviceId: INITIAL_DEVICE,
            publicKey: CONTROLLER.publicKey,
            status: 'active' as const,
            authorizedAt: event.createdAt
          }
        },
        capabilities: {},
        updatedAt
      });
      await expect(store.appendLocalIdentityEvent(ev, liarUpdate)).rejects.toThrow(
        /identityId must match event\.author/
      );
      await expect(store.getSignedEvent('evt_p22_mis')).resolves.toBeUndefined();
    } finally {
      await store.delete();
    }
  });
});

// ---------------------------------------------------------------------------
// listLocalIdentityEvents — replay-from-log
// ---------------------------------------------------------------------------

describe('Phase 2.2 — listLocalIdentityEvents replay path', () => {
  it('returns identity events sorted by createdAt and ignores non-identity rows', async () => {
    const store = createLocalFirstStore(`p22-list-${globalThis.crypto.randomUUID()}`);
    try {
      const ctl = signIdentity(
        'evt_p22_list_1',
        'identity.controller.created',
        { controllerPublicKey: CONTROLLER.publicKey, initialDeviceId: INITIAL_DEVICE },
        '2026-06-03T00:00:00.000Z'
      );
      const cc = signIdentity(
        'evt_p22_list_2',
        'identity.contact-card.published',
        {
          contactCardDigest:
            'sha-256:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666GGGG7777HHHH8888',
          capturedAt: '2026-06-03T00:01:00.000Z'
        },
        '2026-06-03T00:01:00.000Z'
      );
      const note = signEventEnvelope(
        createUnsignedEvent({
          eventId: 'evt_p22_list_note',
          kind: 'note.created',
          author: ACTOR,
          deviceId: INITIAL_DEVICE,
          createdAt: '2026-06-03T00:02:00.000Z',
          privacy: 'self',
          // Phase 5.0E follow-up: non-identity `self`-privacy events
          // require a PrivatePayloadEnvelopeV1.
          payload: placeholderPrivatePayloadEnvelope({ keyId: 'placeholder-note-hi' })
        }),
        CONTROLLER
      );

      await store.appendLocalIdentityEvent(ctl, projectionUpdate);
      await store.appendLocalIdentityEvent(cc, projectionUpdate);
      await store.putSignedEvent(note);

      const events = await store.listLocalIdentityEvents(ACTOR);
      expect(events.map((e) => e.eventId)).toEqual(['evt_p22_list_1', 'evt_p22_list_2']);

      // Caller-side reseed (the canonical replay path) reproduces the
      // snapshot exactly.
      const replayed = seedIdentityControlProjection(events);
      const snapshot = await store.getIdentityControlProjection(ACTOR);
      expect(replayed.controllerPublicKey).toBe(snapshot?.controllerPublicKey);
      expect(replayed.contactCardPublication?.contactCardDigest).toBe(
        snapshot?.contactCardPublication?.contactCardDigest
      );
    } finally {
      await store.delete();
    }
  });
});

// ---------------------------------------------------------------------------
// contactCardPublication propagation
// ---------------------------------------------------------------------------

describe('Phase 2.2 — contactCardPublication propagation onto the stored snapshot', () => {
  it('a contact-card.published event lands in StoredIdentityControlProjection.contactCardPublication', async () => {
    const store = createLocalFirstStore(`p22-cc-${globalThis.crypto.randomUUID()}`);
    try {
      const ctl = signIdentity(
        'evt_p22_cc_ctl',
        'identity.controller.created',
        { controllerPublicKey: CONTROLLER.publicKey, initialDeviceId: INITIAL_DEVICE },
        '2026-06-03T00:00:00.000Z'
      );
      await store.appendLocalIdentityEvent(ctl, projectionUpdate);
      const digest = 'sha-256:AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666GGGG7777HHHH8888';
      const cc = signIdentity(
        'evt_p22_cc_pub',
        'identity.contact-card.published',
        { contactCardDigest: digest, capturedAt: '2026-06-03T00:01:00.000Z' },
        '2026-06-03T00:01:00.000Z'
      );
      const result = await store.appendLocalIdentityEvent(cc, projectionUpdate);
      expect(result.contactCardPublication?.contactCardDigest).toBe(digest);
      expect(result.contactCardPublication?.capturedAt).toBe('2026-06-03T00:01:00.000Z');

      const reread = await store.getIdentityControlProjection(ACTOR);
      expect(reread?.contactCardPublication?.contactCardDigest).toBe(digest);
    } finally {
      await store.delete();
    }
  });
});

// ---------------------------------------------------------------------------
// Inbound sync dispatch regression fix
// ---------------------------------------------------------------------------

function inboundRecord(
  ev: SignedEventEnvelope,
  cursor: string,
  sequence: number
): InboundSyncRecord {
  return {
    sourceId: 'bridge:primary',
    streamId: 'durable-stream:inbox',
    scope: 'identity:alice',
    cursor,
    sequence,
    receivedAt: '2026-06-03T00:00:00.000Z',
    event: ev
  };
}

describe('Phase 2.2 — inbound dispatch regression: rotated + contact-card.published', () => {
  it('processInboundSyncBatch now updates the projection for identity.device.rotated', async () => {
    const store = createLocalFirstStore(`p22-in-rot-${globalThis.crypto.randomUUID()}`);
    try {
      // Land the controller.created baseline first.
      const ctl = signIdentity(
        'evt_p22_in_ctl',
        'identity.controller.created',
        { controllerPublicKey: CONTROLLER.publicKey, initialDeviceId: INITIAL_DEVICE },
        '2026-06-03T00:00:00.000Z'
      );
      const r1 = await processInboundSyncBatch({
        store,
        records: [inboundRecord(ctl, 'cursor-1', 1)]
      });
      expect(r1.applied).toBe(1);

      // Now an inbound rotate event. Phase 2.1 added the kind to
      // EVENT_KINDS; Phase 2.2's fix to isIdentityControlEvent in
      // sync-client makes the projection actually update.
      const rot = signIdentity(
        'evt_p22_in_rot',
        'identity.device.rotated',
        {
          deviceId: INITIAL_DEVICE,
          previousPublicKey: CONTROLLER.publicKey,
          newPublicKey: NEW_KEY.publicKey,
          epoch: 2
        },
        '2026-06-03T00:01:00.000Z'
      );
      const r2 = await processInboundSyncBatch({
        store,
        records: [inboundRecord(rot, 'cursor-2', 2)]
      });
      expect(r2.applied).toBe(1);

      const projection = await store.getIdentityControlProjection(ACTOR);
      // Before Phase 2.2, this assertion would fail: the event would
      // be stored but the projection wouldn't reflect the new key.
      expect(projection?.devices[INITIAL_DEVICE]?.publicKey).toBe(NEW_KEY.publicKey);
      expect(projection?.epoch).toBe(2);
    } finally {
      await store.delete();
    }
  });

  it('processInboundSyncBatch now updates the projection for identity.contact-card.published', async () => {
    const store = createLocalFirstStore(`p22-in-cc-${globalThis.crypto.randomUUID()}`);
    try {
      const ctl = signIdentity(
        'evt_p22_in_cc_ctl',
        'identity.controller.created',
        { controllerPublicKey: CONTROLLER.publicKey, initialDeviceId: INITIAL_DEVICE },
        '2026-06-03T00:00:00.000Z'
      );
      await processInboundSyncBatch({
        store,
        records: [inboundRecord(ctl, 'cursor-1', 1)]
      });

      const digest = 'sha-256:BBBB1111CCCC2222DDDD3333EEEE4444FFFF5555AAAA6666BBBB7777CCCC8888';
      const cc = signIdentity(
        'evt_p22_in_cc',
        'identity.contact-card.published',
        { contactCardDigest: digest, capturedAt: '2026-06-03T00:01:00.000Z' },
        '2026-06-03T00:01:00.000Z'
      );
      const r = await processInboundSyncBatch({
        store,
        records: [inboundRecord(cc, 'cursor-2', 2)]
      });
      expect(r.applied).toBe(1);

      const projection = await store.getIdentityControlProjection(ACTOR);
      expect(projection?.contactCardPublication?.contactCardDigest).toBe(digest);
    } finally {
      await store.delete();
    }
  });
});
