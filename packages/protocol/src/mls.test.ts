import { describe, expect, it } from 'vitest';
import {
  MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION,
  validateMlsApplicationMessageEnvelope
} from './mls.js';

const validEnvelope = () => ({
  version: MLS_APPLICATION_MESSAGE_ENVELOPE_VERSION,
  groupId: 'group:alpha',
  epoch: 0,
  senderDeviceId: 'device:alice-phone',
  ciphertext: 'aGVsbG8',
  messageRef: 'msg:alpha:001'
});

describe('MLS application message envelope validation', () => {
  it('accepts a valid epoch 0 envelope whose sender matches the outer device', () => {
    expect(() =>
      validateMlsApplicationMessageEnvelope(validEnvelope(), 'device:alice-phone')
    ).not.toThrow();
  });

  it('rejects negative or unsafe epochs while allowing epoch 0', () => {
    expect(() =>
      validateMlsApplicationMessageEnvelope({ ...validEnvelope(), epoch: 0 }, 'device:alice-phone')
    ).not.toThrow();

    expect(() =>
      validateMlsApplicationMessageEnvelope({ ...validEnvelope(), epoch: -1 }, 'device:alice-phone')
    ).toThrow(/safe non-negative integer/);

    expect(() =>
      validateMlsApplicationMessageEnvelope(
        { ...validEnvelope(), epoch: Number.MAX_SAFE_INTEGER + 1 },
        'device:alice-phone'
      )
    ).toThrow(/safe non-negative integer/);
  });

  it('rejects sender device mismatch against the outer event device', () => {
    expect(() =>
      validateMlsApplicationMessageEnvelope(
        { ...validEnvelope(), senderDeviceId: 'device:other' },
        'device:alice-phone'
      )
    ).toThrow(/senderDeviceId/);
  });

  it('rejects wrong versions and unsupported fields', () => {
    expect(() =>
      validateMlsApplicationMessageEnvelope(
        { ...validEnvelope(), version: 'lfp2p.mls-application-message.envelope.v2' },
        'device:alice-phone'
      )
    ).toThrow(/Unsupported MLS application envelope version/);

    expect(() =>
      validateMlsApplicationMessageEnvelope(
        { ...validEnvelope(), extraField: 'hello' },
        'device:alice-phone'
      )
    ).toThrow(/unsupported MLS application envelope field/);
  });

  it('rejects malformed ciphertext', () => {
    expect(() =>
      validateMlsApplicationMessageEnvelope(
        { ...validEnvelope(), ciphertext: 'not base64url!' },
        'device:alice-phone'
      )
    ).toThrow(/base64url/);
  });

  it('accepts optional aad and content references when well-formed', () => {
    const envelope = validateMlsApplicationMessageEnvelope(
      {
        ...validEnvelope(),
        aadRef: 'aad:alpha:001',
        contentRefs: ['block:one', 'block:two']
      },
      'device:alice-phone'
    );

    expect(envelope.aadRef).toBe('aad:alpha:001');
    expect(envelope.contentRefs).toEqual(['block:one', 'block:two']);
  });
});
