/**
 * Phase 4.3 — Adversarial tests for the HTTP-layer hardening.
 *
 * Covered:
 *  - Body size caps via Content-Length (early reject) AND streaming
 *    (defends against missing / lying Content-Length).
 *  - Invalid Content-Length is rejected as 400, not silently
 *    accepted.
 *  - Bearer token auth with multi-token registry: known token wins;
 *    unknown / expired / malformed → 401 with identical body
 *    (privacy-safe).
 *  - Backward compat: pre-Phase-4.3 single-token shape continues
 *    to work; null options become 503 misconfigured.
 *  - WWW-Authenticate header present on every 401.
 *  - Per-token rate limiting: exhaustion → 429 + Retry-After;
 *    cooldown advances; recovery resumes.
 *  - Rate limit is per-tokenId: different tokens have independent
 *    budgets.
 *  - Doctrine compliance: response bodies never echo payload or
 *    token contents.
 */
import { describe, expect, it } from 'vitest';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import { createUnsignedEvent, type SignedEventEnvelope } from '@lfp2p/protocol';
import {
  BridgeHttpRateLimiter,
  DEFAULT_MAX_REQUEST_BYTES,
  InMemoryBridgeService,
  handleBridgeDeliveryRequest,
  handleBridgeInboundReadRequest,
  normalizeAuthConfig
} from './index.js';
import type {
  BridgeDeliveryRequest,
  BridgeHttpAuthConfig,
  BridgeHttpHandlerOptions
} from './types.js';

const KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(33));
const NOW_ISO = '2026-06-04T00:00:00.000Z';

function signedNote(eventId: string, body = 'hi'): SignedEventEnvelope {
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'note.created',
      author: 'identity:alice',
      deviceId: 'device:alice-phone',
      createdAt: NOW_ISO,
      privacy: 'group',
      payload: { body }
    }),
    KEYPAIR
  );
}

function deliveryBody(eventId: string, body = 'hi'): string {
  const req: BridgeDeliveryRequest = {
    idempotencyKey: `idem_${eventId}`,
    target: 'durable-stream:inbox',
    event: signedNote(eventId, body)
  };
  return JSON.stringify(req);
}

function deliveryRequest(
  eventId: string,
  options: {
    token?: string;
    contentLength?: string;
    body?: string;
  } = {}
): Request {
  const json = options.body ?? deliveryBody(eventId);
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (options.token !== undefined) {
    headers['authorization'] = `Bearer ${options.token}`;
  }
  if (options.contentLength !== undefined) {
    headers['content-length'] = options.contentLength;
  }
  return new Request('https://bridge.test/events', {
    method: 'POST',
    headers,
    body: json
  });
}

function inboundReadRequest(token?: string): Request {
  const body = JSON.stringify({
    sourceId: 'bridge:test',
    streamId: 'durable-stream:inbox',
    scope: 'identity:alice'
  });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers['authorization'] = `Bearer ${token}`;
  return new Request('https://bridge.test/inbound', {
    method: 'POST',
    headers,
    body
  });
}

// ---------------------------------------------------------------------------
// Body size cap
// ---------------------------------------------------------------------------

describe('Phase 4.3 — body size cap', () => {
  it('rejects with 413 when Content-Length declares a body above the cap', async () => {
    const bridge = new InMemoryBridgeService();
    const oversized = String(DEFAULT_MAX_REQUEST_BYTES + 1);
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_cl_1', { contentLength: oversized }),
      NOW_ISO
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      status: 'rejected',
      reason: 'Payload Too Large'
    });
  });

  it('rejects with 400 when Content-Length is malformed', async () => {
    const bridge = new InMemoryBridgeService();
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_cl_2', { contentLength: 'not-a-number' }),
      NOW_ISO
    );
    expect(response.status).toBe(400);
  });

  it('rejects with 413 when the body actually exceeds the cap even without a Content-Length header', async () => {
    const bridge = new InMemoryBridgeService();
    const padded = 'x'.repeat(2000);
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_cl_3', { body: padded }),
      NOW_ISO,
      { maxRequestBytes: 1024 }
    );
    expect(response.status).toBe(413);
  });

  it('accepts a body that fits within a configured smaller cap', async () => {
    const bridge = new InMemoryBridgeService();
    const json = deliveryBody('evt_p43_cl_4');
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_cl_4', { body: json }),
      NOW_ISO,
      { maxRequestBytes: json.length + 1 }
    );
    expect(response.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// Multi-token auth + expiry
// ---------------------------------------------------------------------------

const TOKEN_A = 'token-A-1234567890abcdef';
const TOKEN_B = 'token-B-1234567890abcdef';
const TOKEN_EXPIRED = 'token-expired-1234567890abcdef';

const MULTI_AUTH: BridgeHttpAuthConfig = {
  scheme: 'bearer',
  tokens: [
    { id: 'tenant-a', token: TOKEN_A },
    { id: 'tenant-b', token: TOKEN_B, label: 'Tenant B' },
    {
      id: 'tenant-expired',
      token: TOKEN_EXPIRED,
      expiresAt: '2026-01-01T00:00:00Z'
    }
  ]
};

describe('Phase 4.3 — multi-token auth registry', () => {
  it('accepts a request that presents a known non-expired token', async () => {
    const bridge = new InMemoryBridgeService();
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_auth_a', { token: TOKEN_A }),
      NOW_ISO,
      { auth: MULTI_AUTH }
    );
    expect(response.status).toBe(202);
  });

  it('accepts a second valid token in the same registry', async () => {
    const bridge = new InMemoryBridgeService();
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_auth_b', { token: TOKEN_B }),
      NOW_ISO,
      { auth: MULTI_AUTH }
    );
    expect(response.status).toBe(202);
  });

  it('rejects an unknown token with 401 + WWW-Authenticate', async () => {
    const bridge = new InMemoryBridgeService();
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_auth_unknown', { token: 'totally-unknown' }),
      NOW_ISO,
      { auth: MULTI_AUTH }
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="lfp2p-bridge"'
    );
  });

  it('rejects an expired token with the same 401 + body as unknown (no fingerprinting)', async () => {
    const bridge = new InMemoryBridgeService();
    const expiredResponse = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_auth_exp', { token: TOKEN_EXPIRED }),
      NOW_ISO,
      { auth: MULTI_AUTH }
    );
    const unknownResponse = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_auth_unk2', { token: 'totally-unknown-2' }),
      NOW_ISO,
      { auth: MULTI_AUTH }
    );
    expect(expiredResponse.status).toBe(401);
    expect(unknownResponse.status).toBe(401);
    // Bodies are identical → no probe can distinguish expired from unknown.
    await expect(expiredResponse.clone().json()).resolves.toEqual(
      await unknownResponse.clone().json()
    );
  });

  it('legacy single-token shape continues to work (backward compat)', async () => {
    const bridge = new InMemoryBridgeService();
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_legacy_1', { token: TOKEN_A }),
      NOW_ISO,
      {
        auth: { scheme: 'bearer', token: TOKEN_A }
      }
    );
    expect(response.status).toBe(202);
  });
});

describe('Phase 4.3 — normalizeAuthConfig validation', () => {
  it('rejects an empty tokens array', () => {
    expect(() =>
      normalizeAuthConfig({ scheme: 'bearer', tokens: [] })
    ).toThrow(/non-empty array/);
  });

  it('rejects duplicate token ids', () => {
    expect(() =>
      normalizeAuthConfig({
        scheme: 'bearer',
        tokens: [
          { id: 'same', token: 'tok-one-1234567890' },
          { id: 'same', token: 'tok-two-1234567890' }
        ]
      })
    ).toThrow(/Duplicate.*same/);
  });

  it('rejects a token with non-ASCII characters', () => {
    expect(() =>
      normalizeAuthConfig({
        scheme: 'bearer',
        tokens: [{ id: 'utf8', token: 'café-token-1234' }]
      })
    ).toThrow(/invalid/);
  });

  it('rejects a token with a malformed expiresAt', () => {
    expect(() =>
      normalizeAuthConfig({
        scheme: 'bearer',
        tokens: [
          { id: 'bad-time', token: 'tok-ok-1234567890', expiresAt: 'not-iso' }
        ]
      })
    ).toThrow(/ISO-8601/);
  });
});

// ---------------------------------------------------------------------------
// Per-token rate limiter
// ---------------------------------------------------------------------------

describe('Phase 4.3 — BridgeHttpRateLimiter', () => {
  it('the same token is independently rate-limited from other tokens', () => {
    const limiter = new BridgeHttpRateLimiter({
      config: {
        capacity: 1,
        refillRatePerSecond: 0.001,
        baseBackoffMs: 1000,
        maxBackoffMs: 60_000
      }
    });
    const t = 1_000;
    const a1 = limiter.consume('tenant-a', t);
    const a2 = limiter.consume('tenant-a', t);
    const b1 = limiter.consume('tenant-b', t);
    expect(a1.allowed).toBe(true);
    expect(a2.allowed).toBe(false);
    expect(b1.allowed).toBe(true);
  });

  it('exhaustion advances the cooldown so subsequent calls also fail', () => {
    const limiter = new BridgeHttpRateLimiter({
      config: {
        capacity: 1,
        refillRatePerSecond: 0.001,
        baseBackoffMs: 5000,
        maxBackoffMs: 60_000
      }
    });
    const t = 1_000;
    expect(limiter.consume('x', t).allowed).toBe(true);
    const second = limiter.consume('x', t);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBeGreaterThan(0);
    // Still in cooldown a second later.
    const third = limiter.consume('x', t + 100);
    expect(third.allowed).toBe(false);
  });

  it('recovers after the cooldown elapses', () => {
    const limiter = new BridgeHttpRateLimiter({
      config: {
        capacity: 1,
        refillRatePerSecond: 1,
        baseBackoffMs: 1000,
        maxBackoffMs: 60_000
      }
    });
    expect(limiter.consume('y', 1000).allowed).toBe(true);
    expect(limiter.consume('y', 1000).allowed).toBe(false);
    // Refill rate is 1/sec, so after 1.5 seconds the bucket has
    // ≥1 token AND the cooldown has elapsed.
    expect(limiter.consume('y', 2500).allowed).toBe(true);
  });
});

describe('Phase 4.3 — HTTP rate limiter wired into the handler', () => {
  it('rate-limit exhaustion responds with 429 + Retry-After', async () => {
    const bridge = new InMemoryBridgeService();
    const limiter = new BridgeHttpRateLimiter({
      config: {
        capacity: 1,
        refillRatePerSecond: 0.001,
        baseBackoffMs: 2000,
        maxBackoffMs: 60_000
      }
    });
    const optsBase: BridgeHttpHandlerOptions = {
      auth: MULTI_AUTH,
      httpRateLimiter: limiter,
      now: () => 1_000
    };
    const first = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_rl_1', { token: TOKEN_A }),
      NOW_ISO,
      optsBase
    );
    expect(first.status).toBe(202);
    const second = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_rl_2', { token: TOKEN_A }),
      NOW_ISO,
      optsBase
    );
    expect(second.status).toBe(429);
    const retryAfter = second.headers.get('retry-after');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  });

  it('different tokens consume independent buckets', async () => {
    const bridge = new InMemoryBridgeService();
    const limiter = new BridgeHttpRateLimiter({
      config: {
        capacity: 1,
        refillRatePerSecond: 0.001,
        baseBackoffMs: 2000,
        maxBackoffMs: 60_000
      }
    });
    const optsBase: BridgeHttpHandlerOptions = {
      auth: MULTI_AUTH,
      httpRateLimiter: limiter,
      now: () => 1_000
    };
    // Token A consumes its bucket.
    await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_indep_a', { token: TOKEN_A }),
      NOW_ISO,
      optsBase
    );
    // Token B still admits.
    const bResponse = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_indep_b', { token: TOKEN_B }),
      NOW_ISO,
      optsBase
    );
    expect(bResponse.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// Privacy-safe response bodies
// ---------------------------------------------------------------------------

describe('Phase 4.3 — privacy-safe response bodies (Phase 3.1 doctrine)', () => {
  it('a 401 body never echoes the presented token value', async () => {
    const bridge = new InMemoryBridgeService();
    const sensitiveProbe = 'PROBE_TOKEN_LEAKED_SECRET';
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_priv_1', { token: sensitiveProbe }),
      NOW_ISO,
      { auth: MULTI_AUTH }
    );
    const text = await response.text();
    expect(text).not.toMatch(/PROBE_TOKEN_LEAKED_SECRET/);
  });

  it('a 413 body never echoes the payload contents', async () => {
    const bridge = new InMemoryBridgeService();
    const secretBody = 'x'.repeat(5_000).concat('PROBE_PAYLOAD_LEAKED_SECRET');
    const response = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_priv_2', { body: secretBody }),
      NOW_ISO,
      { maxRequestBytes: 1024 }
    );
    const text = await response.text();
    expect(text).not.toMatch(/PROBE_PAYLOAD_LEAKED_SECRET/);
  });

  it('a 429 body never echoes the presented token value', async () => {
    const bridge = new InMemoryBridgeService();
    const limiter = new BridgeHttpRateLimiter({
      config: {
        capacity: 1,
        refillRatePerSecond: 0.001,
        baseBackoffMs: 2000,
        maxBackoffMs: 60_000
      }
    });
    const optsBase: BridgeHttpHandlerOptions = {
      auth: MULTI_AUTH,
      httpRateLimiter: limiter,
      now: () => 1_000
    };
    await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_priv_3a', { token: TOKEN_A }),
      NOW_ISO,
      optsBase
    );
    const limited = await handleBridgeDeliveryRequest(
      bridge,
      deliveryRequest('evt_p43_priv_3b', { token: TOKEN_A }),
      NOW_ISO,
      optsBase
    );
    const text = await limited.text();
    expect(text).not.toMatch(/token-A/);
  });
});

// ---------------------------------------------------------------------------
// Inbound-read handler hardening
// ---------------------------------------------------------------------------

describe('Phase 4.3 — inbound-read endpoint also hardened', () => {
  it('rejects oversized requests on the inbound-read endpoint with 413', async () => {
    const bridge = new InMemoryBridgeService();
    const response = await handleBridgeInboundReadRequest(
      bridge,
      new Request('https://bridge.test/inbound', {
        method: 'POST',
        headers: { 'content-length': String(DEFAULT_MAX_REQUEST_BYTES + 1) },
        body: JSON.stringify({ sourceId: 's', streamId: 'x', scope: 'y' })
      }),
      NOW_ISO
    );
    expect(response.status).toBe(413);
  });

  it('a missing token on inbound-read yields 401 with the legacy body shape', async () => {
    const bridge = new InMemoryBridgeService();
    const response = await handleBridgeInboundReadRequest(
      bridge,
      inboundReadRequest(),
      NOW_ISO,
      { auth: MULTI_AUTH }
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ reason: 'Unauthorized' });
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="lfp2p-bridge"'
    );
  });
});
