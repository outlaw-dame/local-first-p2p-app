import { describe, expect, it } from 'vitest';
import { signingKeypairFromSeed } from '@lfp2p/crypto';
import {
  compareIdentityCode,
  createContactCardDocument,
  createImportedContactProfileInput,
  parseContactCardDocument,
  signContactCardDocument,
  verifyContactCardDocumentSignature,
  serializeContactCardDocument
} from './pwa-contact-card.js';

describe('PWA contact card helpers', () => {
  const keypair = signingKeypairFromSeed(new Uint8Array(32).fill(23));

  it('serializes and parses a strict versioned contact card', async () => {
    const document = await createContactCardDocument({
      identityId: 'identity:alice',
      profile: {
        identityId: 'identity:alice',
        displayName: 'Alice Example',
        avatarUrl: 'https://alice.example.test/avatar.png',
        websiteUrl: 'https://alice.example.test',
        note: 'Local-first builder',
        verificationStatus: 'controller-known',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z'
      },
      trustSnapshot: {
        controllerPublicKey: 'controller-public-key',
        primaryDeviceId: 'device:alice-phone',
        shortFingerprint: 'abcd-efgh-ijkl-mnop',
        verificationStatus: 'controller-known'
      },
      exportedAt: '2026-05-22T00:01:00.000Z'
    });

    const signed = signContactCardDocument(document, keypair);
    expect(verifyContactCardDocumentSignature(signed)).toBe(true);

    const serialized = serializeContactCardDocument(signed);
    const parsed = parseContactCardDocument(serialized);

    expect(parsed).toMatchObject({
      version: 'lfp2p.contact-card.v1',
      identityId: 'identity:alice',
      websiteUrl: 'https://alice.example.test',
      controllerPublicKey: 'controller-public-key'
    });
    expect(parsed.signature).toBeDefined();
  });

  it('rejects malformed cards and imported controller mismatches', async () => {
    expect(() => parseContactCardDocument('{"version":"wrong"}')).toThrow(/unsupported contact card version/i);
    expect(() =>
      parseContactCardDocument(
        JSON.stringify({
          version: 'lfp2p.contact-card.v1',
          exportedAt: '2026-05-22T00:00:00.000Z',
          identityId: 'identity:alice',
          websiteUrl: 'javascript:alert(1)'
        })
      )
    ).toThrow(/websiteUrl must use http or https/i);

    await expect(
      createImportedContactProfileInput({
        card: {
          version: 'lfp2p.contact-card.v1',
          exportedAt: '2026-05-22T00:00:00.000Z',
          identityId: 'identity:alice',
          controllerPublicKey: 'controller-public-key',
          shortFingerprint: 'abcd-efgh-ijkl-mnop'
        },
        trustedControllerPublicKey: 'different-controller-key',
        requireSignature: false
      })
    ).rejects.toThrow(/does not match the trusted controller key/i);

    const unsigned = {
      version: 'lfp2p.contact-card.v1' as const,
      exportedAt: '2026-05-22T00:00:00.000Z',
      identityId: 'identity:bob'
    };
    await expect(createImportedContactProfileInput({ card: unsigned })).rejects.toThrow(/must include a detached signature/i);

    const signed = signContactCardDocument(unsigned, keypair);
    const tampered = {
      ...signed,
      displayName: 'Mallory'
    };
    await expect(createImportedContactProfileInput({ card: tampered })).rejects.toThrow(/signature verification failed/i);

    const unsignedBase = {
      version: 'lfp2p.contact-card.v1' as const,
      exportedAt: '2026-05-22T00:00:00.000Z',
      identityId: 'identity:carol',
      controllerPublicKey: 'controller-public-key-carol'
    };
    const signedWithoutFingerprint = signContactCardDocument(unsignedBase, keypair);
    const imported = await createImportedContactProfileInput({ card: signedWithoutFingerprint });
    expect(imported.shortFingerprint).toBeDefined();
  });

  it('compares identity codes by fingerprint or controller key input', async () => {
    const byFingerprint = await compareIdentityCode({
      expectedFingerprint: 'abcd-efgh-ijkl-mnop',
      candidate: 'ABCD EFGH IJKL MNOP'
    });
    expect(byFingerprint.matches).toBe(true);

    const byControllerKey = await compareIdentityCode({
      expectedFingerprint: 'iKPX-gm4R-CgNL-DT85',
      controllerPublicKey: 'controller-public-key',
      candidate: 'controller-public-key'
    });
    expect(byControllerKey.matches).toBe(true);
  });
});