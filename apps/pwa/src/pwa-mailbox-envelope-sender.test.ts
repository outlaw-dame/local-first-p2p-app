import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  generateX25519Keypair,
  signingKeypairFromSeed,
  type SigningKeypair,
} from "@lfp2p/crypto";
import {
  resolvePayloadKeyMaterialForDevice,
  type ResolvedRecipient,
} from "@lfp2p/envelope";
import { createLocalFirstStore } from "@lfp2p/local-store";
import type {
  PrivatePayloadEnvelopeV1,
  SignedEventEnvelope,
} from "@lfp2p/protocol";
import { buildMailboxInboxViewModel } from "./pwa-mailbox-state.js";
import { emitMailboxEnvelopeQueuedToRecipients } from "./pwa-mailbox-envelope-sender.js";

const ALICE = "identity:alice";
const BOB = "identity:bob";
const ALICE_DEVICE = "device:alice-1";
const BOB_DEVICE = "device:bob-1";
const BOB_DEVICE_2 = "device:bob-2";
const FUTURE = "2026-08-01T00:00:00.000Z";
const EXPIRED_NOW = "2026-08-02T00:00:00.000Z";
const NOW = "2026-07-04T12:00:00.000Z";
const KEYPAIR: SigningKeypair = signingKeypairFromSeed(
  new Uint8Array(32).fill(17),
);

let dbSeq = 0;

function store() {
  dbSeq += 1;
  return createLocalFirstStore(
    `pwa-mbx-sender-${dbSeq}-${globalThis.crypto.randomUUID()}`,
  );
}

describe("emitMailboxEnvelopeQueuedToRecipients", () => {
  it("wraps a fresh key to recipient and sender devices and projects both mailboxes", async () => {
    const senderStore = store();
    const recipientStore = store();
    const aliceWrap = generateX25519Keypair();
    const bobWrap = generateX25519Keypair();
    const recipient: ResolvedRecipient = {
      recipientIdentityId: BOB,
      recipientDeviceId: BOB_DEVICE,
      wrapPublicKey: bobWrap.publicKey,
      wrapKeyRef: "wrap:bob:1",
    };

    const result = await emitMailboxEnvelopeQueuedToRecipients({
      store: senderStore,
      identityId: ALICE,
      deviceId: ALICE_DEVICE,
      senderDeviceWrap: {
        wrapPublicKey: aliceWrap.publicKey,
        wrapKeyRef: "wrap:alice:1",
      },
      signingKeypair: KEYPAIR,
      privacy: "dm",
      eventId: "evt-mbx-sender-wrap-1",
      createdAt: NOW,
      keyId: "payload-key:test-1",
      envelope: {
        envelopeId: "env-1",
        recipientIdentityId: BOB,
        contentRef: "sha-256:message-1",
        expiresAt: FUTURE,
      },
      recipients: [recipient],
    });

    expect(result.append.status).toBe("applied");
    expect(result.keyId).toBe("payload-key:test-1");
    expect(result.recipientDeviceIds).toEqual([BOB_DEVICE]);
    expect(result.senderDeviceId).toBe(ALICE_DEVICE);
    expect(await senderStore.getMailboxOutbox(ALICE)).toHaveLength(1);

    const payload = result.event.payload as unknown as PrivatePayloadEnvelopeV1;
    expect(payload.keyId).toBe("payload-key:test-1");
    expect(payload.recipientWraps).toHaveLength(2);
    expect(
      payload.recipientWraps?.map((wrap) => wrap.recipientDeviceId).sort(),
    ).toEqual([ALICE_DEVICE, BOB_DEVICE].sort());
    expect(JSON.stringify(payload)).not.toContain("message-1");

    const senderResolvedKey = resolvePayloadKeyMaterialForDevice(payload, [
      {
        identityId: ALICE,
        deviceId: ALICE_DEVICE,
        wrapKeyRef: "wrap:alice:1",
        wrapPrivateKey: aliceWrap.privateKey,
      },
    ]);
    expect(senderResolvedKey).toEqual(expect.any(String));

    const recipientResolvedKey = resolvePayloadKeyMaterialForDevice(payload, [
      {
        identityId: BOB,
        deviceId: BOB_DEVICE,
        wrapKeyRef: "wrap:bob:1",
        wrapPrivateKey: bobWrap.privateKey,
      },
    ]);
    expect(recipientResolvedKey).toEqual(expect.any(String));
    expect(recipientResolvedKey).toBe(senderResolvedKey);

    const recipientAppend = await recipientStore.appendMailboxEvent(
      result.event,
      {
        ownerIdentityId: BOB,
        keyMaterial: recipientResolvedKey,
      },
    );
    expect(recipientAppend.status).toBe("applied");
    const [item] = await buildMailboxInboxViewModel(recipientStore, BOB, NOW);
    expect(item?.envelopeId).toBe("env-1");
    expect(item?.senderIdentityId).toBe(ALICE);
    expect(item?.addressing).toBe("visible");

    await senderStore.delete();
    await recipientStore.delete();
  });

  it("lets sender replay and sweep outbox events using only its local device wrap", async () => {
    const senderStore = store();
    const aliceWrap = generateX25519Keypair();
    const bobWrap = generateX25519Keypair();
    const recipient: ResolvedRecipient = {
      recipientIdentityId: BOB,
      recipientDeviceId: BOB_DEVICE,
      wrapPublicKey: bobWrap.publicKey,
      wrapKeyRef: "wrap:bob:1",
    };

    const result = await emitMailboxEnvelopeQueuedToRecipients({
      store: senderStore,
      identityId: ALICE,
      deviceId: ALICE_DEVICE,
      senderDeviceWrap: {
        wrapPublicKey: aliceWrap.publicKey,
        wrapKeyRef: "wrap:alice:1",
      },
      signingKeypair: KEYPAIR,
      privacy: "dm",
      eventId: "evt-mbx-sender-replay-1",
      createdAt: NOW,
      keyId: "payload-key:replay-1",
      envelope: {
        envelopeId: "env-replay-1",
        recipientIdentityId: BOB,
        contentRef: "sha-256:message-replay-1",
        expiresAt: FUTURE,
      },
      recipients: [recipient],
    });
    expect(result.append.status).toBe("applied");

    const resolveForSender = (event: SignedEventEnvelope): string | undefined =>
      resolvePayloadKeyMaterialForDevice(
        event.payload as unknown as PrivatePayloadEnvelopeV1,
        [
          {
            identityId: ALICE,
            deviceId: ALICE_DEVICE,
            wrapKeyRef: "wrap:alice:1",
            wrapPrivateKey: aliceWrap.privateKey,
          },
        ],
      );

    expect(resolveForSender(result.event)).toEqual(expect.any(String));
    await senderStore.loadMailboxInboxState(ALICE, resolveForSender);
    expect(await senderStore.getMailboxOutbox(ALICE)).toHaveLength(1);

    const sweep = await senderStore.sweepExpiredMailboxEnvelopes({
      ownerIdentityId: ALICE,
      deviceId: ALICE_DEVICE,
      signingKeypair: KEYPAIR,
      now: EXPIRED_NOW,
      resolveEnvelopeKey: () => {
        const keyMaterial = resolveForSender(result.event);
        return keyMaterial === undefined
          ? undefined
          : { keyMaterial, keyId: "payload-key:replay-1", privacy: "dm" };
      },
    });
    expect(sweep.expired).toEqual(["env-replay-1"]);
    expect(sweep.skipped).toEqual([]);
    const [outbox] = await senderStore.getMailboxOutbox(ALICE);
    expect(outbox?.status).toBe("expired");

    await senderStore.delete();
  });

  it("seals to the requested recipient device while preserving sender replay access", async () => {
    const senderStore = store();
    const aliceWrap = generateX25519Keypair();
    const primaryWrap = generateX25519Keypair();
    const secondaryWrap = generateX25519Keypair();
    const primary: ResolvedRecipient = {
      recipientIdentityId: BOB,
      recipientDeviceId: BOB_DEVICE,
      wrapPublicKey: primaryWrap.publicKey,
      wrapKeyRef: "wrap:bob:primary",
    };
    const secondary: ResolvedRecipient = {
      recipientIdentityId: BOB,
      recipientDeviceId: BOB_DEVICE_2,
      wrapPublicKey: secondaryWrap.publicKey,
      wrapKeyRef: "wrap:bob:secondary",
    };

    const result = await emitMailboxEnvelopeQueuedToRecipients({
      store: senderStore,
      identityId: ALICE,
      deviceId: ALICE_DEVICE,
      senderDeviceWrap: {
        wrapPublicKey: aliceWrap.publicKey,
        wrapKeyRef: "wrap:alice:1",
      },
      signingKeypair: KEYPAIR,
      privacy: "dm",
      eventId: "evt-mbx-sealed-wrap-1",
      createdAt: NOW,
      keyId: "payload-key:sealed-1",
      envelope: {
        envelopeId: "env-sealed-1",
        recipientIdentityId: BOB,
        recipientDeviceId: BOB_DEVICE_2,
        contentRef: "sha-256:sealed-message-1",
        expiresAt: FUTURE,
      },
      recipients: [primary, secondary],
    });

    expect(result.append.status).toBe("applied");
    expect(result.recipientDeviceIds).toEqual([BOB_DEVICE_2]);
    const payload = result.event.payload as unknown as PrivatePayloadEnvelopeV1;
    expect(
      payload.recipientWraps?.map((wrap) => wrap.recipientDeviceId).sort(),
    ).toEqual([ALICE_DEVICE, BOB_DEVICE_2].sort());
    expect(
      resolvePayloadKeyMaterialForDevice(payload, [
        {
          identityId: BOB,
          deviceId: BOB_DEVICE,
          wrapKeyRef: "wrap:bob:primary",
          wrapPrivateKey: primaryWrap.privateKey,
        },
      ]),
    ).toBeUndefined();
    expect(
      resolvePayloadKeyMaterialForDevice(payload, [
        {
          identityId: ALICE,
          deviceId: ALICE_DEVICE,
          wrapKeyRef: "wrap:alice:1",
          wrapPrivateKey: aliceWrap.privateKey,
        },
      ]),
    ).toEqual(expect.any(String));
    expect(
      resolvePayloadKeyMaterialForDevice(payload, [
        {
          identityId: BOB,
          deviceId: BOB_DEVICE_2,
          wrapKeyRef: "wrap:bob:secondary",
          wrapPrivateKey: secondaryWrap.privateKey,
        },
      ]),
    ).toEqual(expect.any(String));

    await senderStore.delete();
  });

  it("rejects recipient wraps for a different identity before encrypting", async () => {
    const senderStore = store();
    const aliceWrap = generateX25519Keypair();
    const bobWrap = generateX25519Keypair();
    await expect(
      emitMailboxEnvelopeQueuedToRecipients({
        store: senderStore,
        identityId: ALICE,
        deviceId: ALICE_DEVICE,
        senderDeviceWrap: {
          wrapPublicKey: aliceWrap.publicKey,
          wrapKeyRef: "wrap:alice:1",
        },
        signingKeypair: KEYPAIR,
        privacy: "dm",
        envelope: {
          envelopeId: "env-2",
          recipientIdentityId: BOB,
          contentRef: "sha-256:message-2",
          expiresAt: FUTURE,
        },
        recipients: [
          {
            recipientIdentityId: "identity:mallory",
            recipientDeviceId: BOB_DEVICE,
            wrapPublicKey: bobWrap.publicKey,
            wrapKeyRef: "wrap:bob:1",
          },
        ],
      }),
    ).rejects.toThrow(/recipient identity mismatch/);
    expect(await senderStore.getMailboxOutbox(ALICE)).toEqual([]);
    await senderStore.delete();
  });

  it("rejects duplicate recipient device ids", async () => {
    const senderStore = store();
    const aliceWrap = generateX25519Keypair();
    const bobWrap = generateX25519Keypair();
    const recipient: ResolvedRecipient = {
      recipientIdentityId: BOB,
      recipientDeviceId: BOB_DEVICE,
      wrapPublicKey: bobWrap.publicKey,
      wrapKeyRef: "wrap:bob:1",
    };

    await expect(
      emitMailboxEnvelopeQueuedToRecipients({
        store: senderStore,
        identityId: ALICE,
        deviceId: ALICE_DEVICE,
        senderDeviceWrap: {
          wrapPublicKey: aliceWrap.publicKey,
          wrapKeyRef: "wrap:alice:1",
        },
        signingKeypair: KEYPAIR,
        privacy: "dm",
        envelope: {
          envelopeId: "env-3",
          recipientIdentityId: BOB,
          contentRef: "sha-256:message-3",
          expiresAt: FUTURE,
        },
        recipients: [recipient, recipient],
      }),
    ).rejects.toThrow(/Duplicate recipient device id/);
    expect(await senderStore.getMailboxOutbox(ALICE)).toEqual([]);
    await senderStore.delete();
  });
});
