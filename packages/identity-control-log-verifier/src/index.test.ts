/**
 * Adversarial test suite for `@lfp2p/identity-control-log-verifier`.
 *
 * Builds real Ed25519-signed identity-control event chains
 * (`identity.controller.created` → `identity.device.authorized`
 * → `identity.capability.granted`) so the verifier's full path —
 * signature verification + projection seeding + digest match +
 * grant-still-active + party-ref binding — gets exercised
 * end-to-end.
 *
 * Coverage:
 *   - Input guards / abstain dispatch
 *   - Structural soundness once scheme is claimed
 *   - Resolver fail-closed paths
 *   - Happy path (controller grants device a capability → verified)
 *   - Signature integrity (tampered event, foreign signer)
 *   - Projection-grant-still-active gates: revoked capability,
 *     revoked device, expired grant
 *   - Issuer/subject pinning: wrong issuer, wrong subject kind,
 *     subject ≠ delegateDeviceId
 *   - Digest match (tampered payload, wrong digest)
 *   - Custom matcher strategies
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import {
  createUnsignedEvent,
  type SignedEventEnvelope,
  type UnsignedEventEnvelope
} from '@lfp2p/protocol';
import { signEventEnvelope, toBase64Url } from '@lfp2p/crypto';
import type { CapabilityProofRecord } from '@lfp2p/capabilities';
import {
  createIdentityControlLogVerifier,
  deriveProofFromIdentityCapabilityGranted,
  identityControlLogProofDigest,
  registerIdentityCapabilityProof
} from './index.js';

/* -------------------------------------------------------------------------- */
/*                            keypair + signing helpers                       */
/* -------------------------------------------------------------------------- */

function kpFromSeed(seed: string): {
  publicKey: string;
  privateKey: string;
} {
  const bytes = new TextEncoder().encode(seed);
  if (bytes.byteLength !== 32) {
    throw new Error(`seed must be 32 bytes; got ${bytes.byteLength}`);
  }
  const pair = nacl.sign.keyPair.fromSeed(bytes);
  return {
    publicKey: toBase64Url(pair.publicKey),
    privateKey: toBase64Url(pair.secretKey)
  };
}

const CONTROLLER_KP = kpFromSeed('id-ctl-log-controller-32-byte-ab');
const STRANGER_KP = kpFromSeed('id-ctl-log-stranger-32-byte-aabc');

const CONTROLLER_PK = CONTROLLER_KP.publicKey;
const STRANGER_PK = STRANGER_KP.publicKey;
const DEVICE_ID = 'device:laptop';
const DEVICE_PK = 'device-laptop-public-key';
const CAPABILITY_ID = 'cap:sync:device:laptop';
const FAR_FUTURE = '2030-01-01T00:00:00.000Z';
const PAST = '2025-01-01T00:00:00.000Z';

function signWith(kp: { publicKey: string; privateKey: string }, unsigned: UnsignedEventEnvelope): SignedEventEnvelope {
  return signEventEnvelope(unsigned, kp);
}

function unsigned(
  eventId: string,
  kind: string,
  payload: Record<string, unknown>,
  lamport: number
): UnsignedEventEnvelope {
  return createUnsignedEvent({
    eventId,
    kind: kind as never,
    author: 'identity:test-account',
    deviceId: 'device:primary',
    createdAt: `2026-05-26T00:00:0${lamport}.000Z`,
    lamport,
    privacy: 'self',
    payload
  });
}

function buildHappyChain(opts: {
  expiresAt?: string;
  withDeviceRevoked?: boolean;
  withCapabilityRevoked?: boolean;
} = {}): { events: SignedEventEnvelope[]; grantedEvent: SignedEventEnvelope } {
  const expires = opts.expiresAt ?? FAR_FUTURE;
  const events: SignedEventEnvelope[] = [];

  events.push(
    signWith(
      CONTROLLER_KP,
      unsigned(
        'evt_controller_created',
        'identity.controller.created',
        {
          controllerPublicKey: CONTROLLER_PK,
          initialDeviceId: 'device:primary'
        },
        1
      )
    )
  );

  events.push(
    signWith(
      CONTROLLER_KP,
      unsigned(
        'evt_device_authorized',
        'identity.device.authorized',
        {
          authorizedDeviceId: DEVICE_ID,
          authorizedPublicKey: DEVICE_PK,
          epoch: 1
        },
        2
      )
    )
  );

  const grantedEvent = signWith(
    CONTROLLER_KP,
    unsigned(
      'evt_capability_granted',
      'identity.capability.granted',
      {
        capabilityId: CAPABILITY_ID,
        delegateDeviceId: DEVICE_ID,
        scope: 'sync:outbox',
        expiresAt: expires
      },
      3
    )
  );
  events.push(grantedEvent);

  if (opts.withDeviceRevoked === true) {
    events.push(
      signWith(
        CONTROLLER_KP,
        unsigned(
          'evt_device_revoked',
          'identity.device.revoked',
          { revokedDeviceId: DEVICE_ID, epoch: 2 },
          4
        )
      )
    );
  }

  if (opts.withCapabilityRevoked === true) {
    events.push(
      signWith(
        CONTROLLER_KP,
        unsigned(
          'evt_capability_revoked',
          'identity.capability.revoked',
          { capabilityId: CAPABILITY_ID, delegateDeviceId: DEVICE_ID, reason: 'user-request' },
          5
        )
      )
    );
  }

  return { events, grantedEvent };
}

function makeRecord(
  grantedEvent: SignedEventEnvelope,
  overrides: Partial<CapabilityProofRecord> = {}
): CapabilityProofRecord {
  return {
    proofId: grantedEvent.eventId,
    scheme: 'identity-control-log',
    issuer: { id: CONTROLLER_PK, kind: 'controller' },
    subject: { id: DEVICE_ID, kind: 'device' },
    issuedAt: '2026-05-01T00:00:00.000Z',
    expiresAt: FAR_FUTURE,
    digest: identityControlLogProofDigest(grantedEvent),
    verificationState: 'unverified',
    ...overrides
  } as CapabilityProofRecord;
}

const FIXED_NOW = Date.parse('2026-06-01T00:00:00.000Z');

function vfor(
  events: readonly SignedEventEnvelope[] | undefined | (() => readonly SignedEventEnvelope[] | undefined),
  options: { now?: number } = {}
) {
  const resolver =
    typeof events === 'function' ? events : () => events;
  return createIdentityControlLogVerifier({
    resolveIdentityControlLog: resolver,
    ...(options.now !== undefined ? { now: () => options.now as number } : {})
  });
}

/* -------------------------------------------------------------------------- */
/*                                input guards                                */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: input guards', () => {
  it('throws if options is not an object', () => {
    expect(() => createIdentityControlLogVerifier(null as never)).toThrow(TypeError);
  });
  it('throws if resolveIdentityControlLog is not a function', () => {
    expect(() =>
      createIdentityControlLogVerifier({ resolveIdentityControlLog: 'oops' as never })
    ).toThrow(TypeError);
  });
  it('throws if now / issuerMatches / subjectMatches are not functions', () => {
    expect(() =>
      createIdentityControlLogVerifier({
        resolveIdentityControlLog: () => undefined,
        now: 'soon' as never
      })
    ).toThrow(TypeError);
    expect(() =>
      createIdentityControlLogVerifier({
        resolveIdentityControlLog: () => undefined,
        issuerMatches: 'maybe' as never
      })
    ).toThrow(TypeError);
    expect(() =>
      createIdentityControlLogVerifier({
        resolveIdentityControlLog: () => undefined,
        subjectMatches: 'maybe' as never
      })
    ).toThrow(TypeError);
  });
});

/* -------------------------------------------------------------------------- */
/*                              scheme dispatch                               */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: scheme dispatch', () => {
  const { events, grantedEvent } = buildHappyChain();
  const v = vfor(events, { now: FIXED_NOW });

  it('abstains for null / non-object record', () => {
    expect(v(null as never)).toBeUndefined();
    expect(v(42 as never)).toBeUndefined();
  });

  it.each(['ucan', 'vc', 'zcap-ld', 'bearcap', 'native-signed-event'] as const)(
    'abstains for scheme === %s',
    (s) => {
      expect(v(makeRecord(grantedEvent, { scheme: s as never }))).toBeUndefined();
    }
  );

  it('owns the verdict for scheme === "identity-control-log"', () => {
    expect(v(makeRecord(grantedEvent))).toBe('verified');
  });
});

/* -------------------------------------------------------------------------- */
/*                  structural soundness once scheme claimed                  */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: structural soundness', () => {
  const { events, grantedEvent } = buildHappyChain();
  const v = vfor(events, { now: FIXED_NOW });

  it('invalid on empty proofId', () => {
    expect(v(makeRecord(grantedEvent, { proofId: '' }))).toBe('invalid');
  });
  it('invalid on missing issuer.id', () => {
    expect(v(makeRecord(grantedEvent, { issuer: { id: '', kind: 'controller' } as never }))).toBe('invalid');
  });
  it('invalid on missing subject.id', () => {
    expect(v(makeRecord(grantedEvent, { subject: { id: '', kind: 'device' } as never }))).toBe('invalid');
  });
  it('invalid on missing digest', () => {
    expect(v(makeRecord(grantedEvent, { digest: '' as never }))).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                                resolver paths                              */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: resolveIdentityControlLog', () => {
  const { grantedEvent } = buildHappyChain();

  it('invalid when resolver returns undefined', () => {
    expect(vfor(undefined, { now: FIXED_NOW })(makeRecord(grantedEvent))).toBe('invalid');
  });
  it('invalid when resolver returns an empty array', () => {
    expect(vfor([], { now: FIXED_NOW })(makeRecord(grantedEvent))).toBe('invalid');
  });
  it('invalid when resolver throws', () => {
    expect(
      vfor(() => {
        throw new Error('boom');
      }, { now: FIXED_NOW })(makeRecord(grantedEvent))
    ).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                                 happy path                                 */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: happy path', () => {
  it('returns "verified" for a controller-signed device capability grant', () => {
    const { events, grantedEvent } = buildHappyChain();
    expect(vfor(events, { now: FIXED_NOW })(makeRecord(grantedEvent))).toBe('verified');
  });

  it('returns "verified" when issuer publicKeyRef matches controllerPublicKey', () => {
    const { events, grantedEvent } = buildHappyChain();
    const record = makeRecord(grantedEvent, {
      issuer: { id: 'identity:test-account', publicKeyRef: CONTROLLER_PK, kind: 'controller' } as never
    });
    expect(vfor(events, { now: FIXED_NOW })(record)).toBe('verified');
  });
});

/* -------------------------------------------------------------------------- */
/*                            signature integrity                             */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: signature integrity', () => {
  it('invalid when one event in the log has a tampered payload', () => {
    const { events, grantedEvent } = buildHappyChain();
    const tampered = events.slice();
    // Mutate the granted-event payload after signing.
    const last = { ...tampered[tampered.length - 1] } as SignedEventEnvelope;
    last.payload = { ...(last.payload as Record<string, unknown>), scope: 'sync:HIJACKED' };
    tampered[tampered.length - 1] = last;
    expect(vfor(tampered, { now: FIXED_NOW })(makeRecord(grantedEvent))).toBe('invalid');
  });

  it('invalid when the granted event was signed by a stranger (not controller)', () => {
    // Build a parallel chain where the granted event is signed by a
    // foreign key. seedIdentityControlProjection will reject the
    // non-controller signer, so we expect 'invalid'.
    const events: SignedEventEnvelope[] = [];
    events.push(
      signWith(
        CONTROLLER_KP,
        unsigned(
          'evt_controller_created',
          'identity.controller.created',
          { controllerPublicKey: CONTROLLER_PK, initialDeviceId: 'device:primary' },
          1
        )
      )
    );
    events.push(
      signWith(
        CONTROLLER_KP,
        unsigned(
          'evt_device_authorized',
          'identity.device.authorized',
          { authorizedDeviceId: DEVICE_ID, authorizedPublicKey: DEVICE_PK, epoch: 1 },
          2
        )
      )
    );
    const foreignGrant = signWith(
      STRANGER_KP, // <-- not the controller
      unsigned(
        'evt_capability_granted',
        'identity.capability.granted',
        {
          capabilityId: CAPABILITY_ID,
          delegateDeviceId: DEVICE_ID,
          scope: 'sync:outbox',
          expiresAt: FAR_FUTURE
        },
        3
      )
    );
    events.push(foreignGrant);
    expect(vfor(events, { now: FIXED_NOW })(makeRecord(foreignGrant))).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                            grant-still-active                              */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: grant-still-active', () => {
  it('invalid when the capability was revoked after grant', () => {
    const { events, grantedEvent } = buildHappyChain({ withCapabilityRevoked: true });
    expect(vfor(events, { now: FIXED_NOW })(makeRecord(grantedEvent))).toBe('invalid');
  });

  it('invalid when the delegate device was revoked after grant', () => {
    const { events, grantedEvent } = buildHappyChain({ withDeviceRevoked: true });
    expect(vfor(events, { now: FIXED_NOW })(makeRecord(grantedEvent))).toBe('invalid');
  });

  it('invalid when the grant has expired (now >= payload.expiresAt)', () => {
    const { events, grantedEvent } = buildHappyChain({ expiresAt: PAST });
    expect(vfor(events, { now: FIXED_NOW })(makeRecord(grantedEvent))).toBe('invalid');
  });

  it('invalid when now === payload.expiresAt (boundary is fail-closed)', () => {
    const exp = '2026-06-01T00:00:00.000Z';
    const { events, grantedEvent } = buildHappyChain({ expiresAt: exp });
    expect(vfor(events, { now: Date.parse(exp) })(makeRecord(grantedEvent))).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                          issuer / subject pinning                          */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: issuer / subject pinning', () => {
  const { events, grantedEvent } = buildHappyChain();
  const v = vfor(events, { now: FIXED_NOW });

  it('invalid when issuer.kind !== "controller"', () => {
    expect(
      v(makeRecord(grantedEvent, {
        issuer: { id: CONTROLLER_PK, kind: 'device' } as never
      }))
    ).toBe('invalid');
  });

  it('invalid when issuer.id is a foreign public key', () => {
    expect(
      v(makeRecord(grantedEvent, {
        issuer: { id: STRANGER_PK, kind: 'controller' } as never
      }))
    ).toBe('invalid');
  });

  it('invalid when subject.kind !== "device"', () => {
    expect(
      v(makeRecord(grantedEvent, {
        subject: { id: DEVICE_ID, kind: 'controller' } as never
      }))
    ).toBe('invalid');
  });

  it('invalid when subject.id !== payload.delegateDeviceId', () => {
    expect(
      v(makeRecord(grantedEvent, {
        subject: { id: 'device:other', kind: 'device' } as never
      }))
    ).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                               digest match                                 */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: digest match', () => {
  const { events, grantedEvent } = buildHappyChain();
  const v = vfor(events, { now: FIXED_NOW });

  it('invalid when record.digest is a sha-256 of the wrong event', () => {
    const otherEvent = events[0] as SignedEventEnvelope;
    expect(
      v(makeRecord(grantedEvent, {
        digest: identityControlLogProofDigest(otherEvent)
      }))
    ).toBe('invalid');
  });

  it('invalid when record.digest uses a non-sha-256 prefix', () => {
    expect(
      v(makeRecord(grantedEvent, {
        digest: 'sha-512:' + identityControlLogProofDigest(grantedEvent).slice('sha-256:'.length)
      }))
    ).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                       proofId / event lookup                               */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: proofId → event lookup', () => {
  it('invalid when no event in the log has eventId === record.proofId', () => {
    const { events, grantedEvent } = buildHappyChain();
    const v = vfor(events, { now: FIXED_NOW });
    expect(v(makeRecord(grantedEvent, { proofId: 'evt_does_not_exist' }))).toBe('invalid');
  });

  it('invalid when the matched event is the wrong kind (not identity.capability.granted)', () => {
    const { events } = buildHappyChain();
    // Point the record at the controller-created event instead.
    const controllerCreated = events[0] as SignedEventEnvelope;
    const record = makeRecord(controllerCreated, {
      proofId: controllerCreated.eventId,
      digest: identityControlLogProofDigest(controllerCreated)
    });
    expect(vfor(events, { now: FIXED_NOW })(record)).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                          custom matcher strategies                         */
/* -------------------------------------------------------------------------- */

describe('createIdentityControlLogVerifier: custom matcher strategies', () => {
  it('invalid when a custom issuerMatches strategy returns false', () => {
    const { events, grantedEvent } = buildHappyChain();
    const verifier = createIdentityControlLogVerifier({
      resolveIdentityControlLog: () => events,
      now: () => FIXED_NOW,
      issuerMatches: () => false
    });
    expect(verifier(makeRecord(grantedEvent))).toBe('invalid');
  });

  it('invalid when a custom matcher throws (defused, not propagated)', () => {
    const { events, grantedEvent } = buildHappyChain();
    const verifier = createIdentityControlLogVerifier({
      resolveIdentityControlLog: () => events,
      now: () => FIXED_NOW,
      subjectMatches: () => {
        throw new Error('matcher exploded');
      }
    });
    expect(verifier(makeRecord(grantedEvent))).toBe('invalid');
  });
});

/* -------------------------------------------------------------------------- */
/*                deriveProofFromIdentityCapabilityGranted                    */
/* -------------------------------------------------------------------------- */

describe('deriveProofFromIdentityCapabilityGranted', () => {
  it('happy path: returns a fully-stamped record for a granted event', () => {
    const { grantedEvent } = buildHappyChain();
    const record = deriveProofFromIdentityCapabilityGranted(grantedEvent);
    expect(record).toBeDefined();
    expect(record?.proofId).toBe(grantedEvent.eventId);
    expect(record?.scheme).toBe('identity-control-log');
    expect(record?.issuer).toEqual({ kind: 'controller', id: CONTROLLER_PK });
    expect(record?.subject).toEqual({ kind: 'device', id: DEVICE_ID });
    expect(record?.issuedAt).toBe(grantedEvent.createdAt);
    expect(record?.expiresAt).toBe(FAR_FUTURE);
    expect(record?.digest).toBe(identityControlLogProofDigest(grantedEvent));
    expect(record?.verificationState).toBe('unverified');
  });

  it('returns undefined for non-object input', () => {
    expect(deriveProofFromIdentityCapabilityGranted(null as never)).toBeUndefined();
    expect(deriveProofFromIdentityCapabilityGranted(42 as never)).toBeUndefined();
    expect(deriveProofFromIdentityCapabilityGranted('event' as never)).toBeUndefined();
  });

  it('returns undefined for events of other kinds (clean dispatch)', () => {
    const { events } = buildHappyChain();
    // events[0] is identity.controller.created, events[1] is identity.device.authorized.
    expect(deriveProofFromIdentityCapabilityGranted(events[0] as SignedEventEnvelope)).toBeUndefined();
    expect(deriveProofFromIdentityCapabilityGranted(events[1] as SignedEventEnvelope)).toBeUndefined();
  });

  it.each(['capabilityId', 'delegateDeviceId', 'expiresAt'] as const)(
    'returns undefined when payload.%s is missing',
    (field) => {
      const { grantedEvent } = buildHappyChain();
      const mutated = {
        ...grantedEvent,
        payload: { ...(grantedEvent.payload as Record<string, unknown>) }
      };
      delete (mutated.payload as Record<string, unknown>)[field];
      expect(deriveProofFromIdentityCapabilityGranted(mutated as SignedEventEnvelope)).toBeUndefined();
    }
  );

  it.each(['capabilityId', 'delegateDeviceId', 'expiresAt'] as const)(
    'returns undefined when payload.%s is empty string',
    (field) => {
      const { grantedEvent } = buildHappyChain();
      const mutated = {
        ...grantedEvent,
        payload: { ...(grantedEvent.payload as Record<string, unknown>), [field]: '' }
      };
      expect(deriveProofFromIdentityCapabilityGranted(mutated as SignedEventEnvelope)).toBeUndefined();
    }
  );

  it('returns undefined when payload is missing entirely', () => {
    const { grantedEvent } = buildHappyChain();
    const mutated = { ...grantedEvent };
    delete (mutated as Record<string, unknown>).payload;
    expect(deriveProofFromIdentityCapabilityGranted(mutated as SignedEventEnvelope)).toBeUndefined();
  });

  it('returns undefined when payload is not an object (array)', () => {
    const { grantedEvent } = buildHappyChain();
    expect(
      deriveProofFromIdentityCapabilityGranted({
        ...grantedEvent,
        payload: [] as never
      } as SignedEventEnvelope)
    ).toBeUndefined();
  });

  it('returns undefined when eventId is missing or empty', () => {
    const { grantedEvent } = buildHappyChain();
    expect(
      deriveProofFromIdentityCapabilityGranted({ ...grantedEvent, eventId: '' } as SignedEventEnvelope)
    ).toBeUndefined();
  });

  it('returns undefined when createdAt is missing or empty', () => {
    const { grantedEvent } = buildHappyChain();
    expect(
      deriveProofFromIdentityCapabilityGranted({ ...grantedEvent, createdAt: '' } as SignedEventEnvelope)
    ).toBeUndefined();
  });

  it('returns undefined when signature.publicKey is missing', () => {
    const { grantedEvent } = buildHappyChain();
    const mutated = {
      ...grantedEvent,
      signature: { ...grantedEvent.signature }
    };
    delete (mutated.signature as Record<string, unknown>).publicKey;
    expect(deriveProofFromIdentityCapabilityGranted(mutated as SignedEventEnvelope)).toBeUndefined();
  });

  it('returns undefined when signature is null', () => {
    const { grantedEvent } = buildHappyChain();
    expect(
      deriveProofFromIdentityCapabilityGranted({
        ...grantedEvent,
        signature: null as never
      } as SignedEventEnvelope)
    ).toBeUndefined();
  });

  it('ROUND-TRIP: derived record verifies via createIdentityControlLogVerifier', () => {
    // The strongest test: take the derivation output and feed it
    // through the existing verifier against the actual event log.
    // If the derivation gets ANY field wrong (issuer party-ref,
    // subject device id, digest, scheme), the verifier rejects.
    const { events, grantedEvent } = buildHappyChain();
    const record = deriveProofFromIdentityCapabilityGranted(grantedEvent);
    expect(record).toBeDefined();
    const verifier = createIdentityControlLogVerifier({
      resolveIdentityControlLog: () => events,
      now: () => FIXED_NOW
    });
    expect(verifier(record as CapabilityProofRecord)).toBe('verified');
  });
});

/* -------------------------------------------------------------------------- */
/*                    registerIdentityCapabilityProof                         */
/* -------------------------------------------------------------------------- */

describe('registerIdentityCapabilityProof', () => {
  type Put = (record: CapabilityProofRecord) => Promise<void>;

  function mockStore(putImpl?: Put) {
    const calls: CapabilityProofRecord[] = [];
    return {
      calls,
      store: {
        putCapabilityProofRecord: async (r: CapabilityProofRecord) => {
          calls.push(r);
          if (putImpl) await putImpl(r);
        }
      }
    };
  }

  it('happy path: persists the derived record + returns true', async () => {
    const { grantedEvent } = buildHappyChain();
    const { store, calls } = mockStore();
    const result = await registerIdentityCapabilityProof(store, grantedEvent);
    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.proofId).toBe(grantedEvent.eventId);
    expect(calls[0]?.scheme).toBe('identity-control-log');
  });

  it('returns false (without calling store) for non-granted events', async () => {
    const { events } = buildHappyChain();
    const { store, calls } = mockStore();
    const result = await registerIdentityCapabilityProof(store, events[0] as SignedEventEnvelope);
    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('returns false (without calling store) for malformed payload', async () => {
    const { grantedEvent } = buildHappyChain();
    const mutated = {
      ...grantedEvent,
      payload: { ...(grantedEvent.payload as Record<string, unknown>) }
    };
    delete (mutated.payload as Record<string, unknown>).expiresAt;
    const { store, calls } = mockStore();
    const result = await registerIdentityCapabilityProof(store, mutated as SignedEventEnvelope);
    expect(result).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('throws if store does not expose putCapabilityProofRecord', async () => {
    const { grantedEvent } = buildHappyChain();
    await expect(
      registerIdentityCapabilityProof({} as never, grantedEvent)
    ).rejects.toThrow(TypeError);
    await expect(
      registerIdentityCapabilityProof(null as never, grantedEvent)
    ).rejects.toThrow(TypeError);
  });

  it('propagates store errors instead of swallowing them (fail-closed)', async () => {
    const { grantedEvent } = buildHappyChain();
    const { store } = mockStore(async () => {
      throw new Error('disk full');
    });
    await expect(registerIdentityCapabilityProof(store, grantedEvent)).rejects.toThrow('disk full');
  });

  it('END-TO-END: derived record verifies through the existing verifier', async () => {
    // Pull the persisted record back out of the store and confirm
    // it survives a full verification round.
    const { events, grantedEvent } = buildHappyChain();
    const { store, calls } = mockStore();
    await registerIdentityCapabilityProof(store, grantedEvent);
    const persisted = calls[0] as CapabilityProofRecord;

    const verifier = createIdentityControlLogVerifier({
      resolveIdentityControlLog: () => events,
      now: () => FIXED_NOW
    });
    expect(verifier(persisted)).toBe('verified');
  });
});
