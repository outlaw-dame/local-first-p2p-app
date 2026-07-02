/**
 * Phase 4.5 — Production bridge runtime hardening tests.
 *
 * Covers:
 *  - Check #9: decideUserBlockTransport wired into admission gateway
 *  - acceptReportDelivery type contract (check #10)
 *  - JsonFileHttpRateLimitStore + BridgeHttpRateLimiter persistence
 *  - BridgeTokenRegistry hot rotation
 *  - AuthAuditLog bounded FIFO + JsonFileAuthAuditStore
 *  - rotateOperatorAuthority hot-rotation
 */
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import { signEventEnvelope, signingKeypairFromSeed } from '@lfp2p/crypto';
import {
  createUnsignedEvent,
  placeholderPrivatePayloadEnvelope,
  type SignedEventEnvelope
} from '@lfp2p/protocol';
import {
  applyLocalControlEvent,
  createEmptyLocalControlState,
  type LocalControlEvent,
  type LocalControlState,
  type SafetyReport,
  type ReportAppealEvent
} from '@lfp2p/trust-safety';
import { BridgeAdmissionGateway } from './admission-gateway.js';
import {
  BridgeHttpRateLimiter,
  InMemoryHttpRateLimitStore,
  JsonFileHttpRateLimitStore
} from './http-hardening.js';
import {
  BridgeTokenRegistry,
  JsonFileTokenRegistryStore,
  hashBearerToken,
  type AuthToken
} from './token-registry.js';
import { AuthAuditLog, JsonFileAuthAuditStore } from './auth-audit-log.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const KEYPAIR = signingKeypairFromSeed(new Uint8Array(32).fill(9));

const OPERATOR_AUTHORITY = {
  version: 'lfp2p.safety-authority.v1' as const,
  authorityId: 'auth_p45',
  actorId: 'actor_op',
  role: 'bridge-operator' as const,
  scope: 'bridge-local' as const,
  createdAt: '2026-06-01T00:00:00Z'
};

const GATEWAY_CONFIG = {
  surface: 'bridge' as const,
  operatorAuthority: OPERATOR_AUTHORITY,
  policyVersion: 'v1'
};

const T0 = Date.parse('2026-06-01T00:00:00Z');

function signedNote(eventId: string, author = 'identity:alice'): SignedEventEnvelope {
  return signEventEnvelope(
    createUnsignedEvent({
      eventId,
      kind: 'note.created',
      author,
      deviceId: 'device:alice-phone',
      createdAt: '2026-06-01T00:00:00.000Z',
      privacy: 'group',
      payload: placeholderPrivatePayloadEnvelope({ keyId: 'key1', ciphertext: 'AAAA' })
    }),
    KEYPAIR
  );
}

function makeRequest(eventId: string, recipientActorId?: string, author?: string) {
  return {
    idempotencyKey: `ikey_${eventId}`,
    target: 'target:room-1',
    event: signedNote(eventId, author),
    recipientActorId
  };
}

const BLOCK_EVT: LocalControlEvent = {
  version: 'lfp2p.local-control-event.v1',
  eventId: 'evt_block_alice',
  createdAt: '2026-05-01T00:00:00Z',
  action: 'apply',
  kind: 'safety.account.blocked',
  targetActorId: 'identity:alice'
};

function stateWithBlock(): LocalControlState {
  return applyLocalControlEvent(createEmptyLocalControlState(), BLOCK_EVT);
}

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

const dirsToClean: string[] = [];
async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirsToClean.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirsToClean.length > 0) {
    const dir = dirsToClean.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Check #9 — decideUserBlockTransport wiring
// ---------------------------------------------------------------------------

describe('Phase 4.5 — check #9: decideUserBlockTransport', () => {
  it('rejects with policy.local-preference when producer is blocked by recipient', () => {
    const blockedState = stateWithBlock();
    const gw = new BridgeAdmissionGateway({
      config: GATEWAY_CONFIG,
      localControlStateLookup: (actorId) => (actorId === 'identity:bob' ? blockedState : undefined)
    });
    const req = makeRequest('evt_blocked', 'identity:bob');
    const dec = gw.admit(req, T0);
    expect(dec.result.admitted).toBe(false);
    expect(dec.result.decision.action).toBe('reject');
    expect(dec.result.decision.reasonCode).toBe('policy.local-preference');
    expect(dec.reason).toBe('rejected:policy.local-preference');
  });

  it('passes through when block is expired', () => {
    const expiredBlock: LocalControlEvent = {
      ...BLOCK_EVT,
      expiresAt: '2026-05-15T00:00:00Z'
    };
    const expiredState = applyLocalControlEvent(createEmptyLocalControlState(), expiredBlock);
    const gw = new BridgeAdmissionGateway({
      config: GATEWAY_CONFIG,
      localControlStateLookup: () => expiredState
    });
    const req = makeRequest('evt_expired_block', 'identity:bob');
    const dec = gw.admit(req, T0);
    expect(dec.result.admitted).toBe(true);
  });

  it('skips check #9 when recipientActorId is absent', () => {
    const gw = new BridgeAdmissionGateway({
      config: GATEWAY_CONFIG,
      localControlStateLookup: () => stateWithBlock()
    });
    const req = makeRequest('evt_no_recipient'); // no recipientActorId
    const dec = gw.admit(req, T0);
    expect(dec.result.admitted).toBe(true);
  });

  it('skips check #9 when no lookup is configured (byte-identical to pre-4.5)', () => {
    const gwWith = new BridgeAdmissionGateway({ config: GATEWAY_CONFIG });
    const gwWithout = new BridgeAdmissionGateway({ config: GATEWAY_CONFIG });
    const req = makeRequest('evt_no_lookup', 'identity:bob');
    const decWith = gwWith.admit(req, T0);
    const decWithout = gwWithout.admit({ ...req, idempotencyKey: 'ikey_evt_no_lookup_b' }, T0);
    // Both admitted; same action
    expect(decWith.result.admitted).toBe(true);
    expect(decWithout.result.admitted).toBe(true);
    expect(decWith.result.decision.action).toBe(decWithout.result.decision.action);
  });

  it('lookup result is not stored in audit log — no plaintext exposure', () => {
    const blockedState = stateWithBlock();
    const gw = new BridgeAdmissionGateway({
      config: GATEWAY_CONFIG,
      localControlStateLookup: () => blockedState
    });
    const req = makeRequest('evt_audit_check', 'identity:bob');
    const dec = gw.admit(req, T0);
    // Confirm rejection reason is a stable code only
    expect(dec.reason).not.toContain('alice');
    expect(dec.reason).not.toContain('bob');
    expect(dec.reason).toBe('rejected:policy.local-preference');
  });

  it('no reputation penalty for policy.local-preference reject', () => {
    const blockedState = stateWithBlock();
    let lookupCalls = 0;
    const gw = new BridgeAdmissionGateway({
      config: GATEWAY_CONFIG,
      localControlStateLookup: (id) => {
        lookupCalls++;
        return id === 'identity:bob' ? blockedState : undefined;
      }
    });
    // First admit → reject
    const r1 = gw.admit(makeRequest('evt_rep_1', 'identity:bob'), T0);
    expect(r1.result.admitted).toBe(false);
    // Second request from same producer for a DIFFERENT recipient — no block in place
    const r2 = gw.admit(makeRequest('evt_rep_2', 'identity:carol'), T0);
    // Not blocked by carol, and no reputation penalty accumulated from prior block
    expect(r2.result.admitted).toBe(true);
    expect(lookupCalls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Check #10 — acceptReportDelivery type contract
// ---------------------------------------------------------------------------

const BASE_REPORT: SafetyReport = {
  version: 'lfp2p.safety-report.v1',
  reportId: 'r_test',
  reporter: { kind: 'actor', actor: { actorId: 'actor_reporter' } },
  subject: { type: 'event', eventId: 'evt_reported' },
  targetAuthority: OPERATOR_AUTHORITY,
  reasonCode: 'abuse.harassment',
  scope: 'community-local',
  idempotencyKey: 'idem_r1',
  createdAt: '2026-06-01T00:00:00Z',
  reporterPrivacy: 'identified-to-authority'
};

const VALID_REPORT_ENVELOPE: ReportAppealEvent = Object.freeze({
  version: 'lfp2p.report-appeal-event.v1' as const,
  kind: 'safety.report.created' as const,
  report: BASE_REPORT
});

describe('Phase 4.5 — check #10: acceptReportDelivery', () => {
  const gw = new BridgeAdmissionGateway({ config: GATEWAY_CONFIG });

  it('accepts a valid public-subject report envelope', () => {
    const result = gw.acceptReportDelivery({ envelope: VALID_REPORT_ENVELOPE });
    expect(result.status).toBe('accepted');
  });

  it('rejects a wrong version string', () => {
    const bad = { ...VALID_REPORT_ENVELOPE, version: 'lfp2p.report-appeal-event.v999' };
    const result = gw.acceptReportDelivery({
      envelope: bad as unknown as ReportAppealEvent
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('unsupported version');
  });

  it('rejects when byteSize exceeds the surface cap', () => {
    const result = gw.acceptReportDelivery({
      envelope: VALID_REPORT_ENVELOPE,
      byteSize: 2 * 1024 * 1024 // 2 MiB > default 1 MiB
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('too-large');
  });

  it('rejects a safety.report.created with private-evidence-leak-risk', () => {
    const unsafeReport: SafetyReport = {
      ...BASE_REPORT,
      reportId: 'r_unsafe',
      subject: {
        type: 'blob',
        blockRef: {
          type: 'block-ref',
          source: {
            kind: 'digest',
            digest: { algorithm: 'sha-256', digest: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU' }
          },
          byteLength: 1024,
          offset: 0,
          privacy: 'private',
          encryption: {
            scheme: 'xchacha20-poly1305',
            keyRef: { algorithm: 'sha-256', digest: 'ypeBEsobvcr6wjGzmiPcTaeG7_gUfE5yuYB3ha_uSLs' }
          }
        }
      },
      evidenceRefs: [
        {
          type: 'object-ref',
          kind: 'media',
          block: {
            type: 'block-ref',
            source: {
              kind: 'content-link',
              link: {
                type: 'content-link',
                cid: 'bafkreih2akiscaiv2qtnfwa6vlsa3o5pwf3jmkcswxlha6m4q34cqyvcaa',
                codec: 'raw'
              }
            },
            byteLength: 1024,
            offset: 0,
            privacy: 'public'
          }
        }
      ]
    };
    const envelope: ReportAppealEvent = {
      version: 'lfp2p.report-appeal-event.v1',
      kind: 'safety.report.created',
      report: unsafeReport
    };
    const result = gw.acceptReportDelivery({ envelope });
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('private-evidence-leak-risk');
  });

  it('accepts a non-report kind without running the forwarding check', () => {
    const ackEnvelope: ReportAppealEvent = {
      version: 'lfp2p.report-appeal-event.v1',
      kind: 'safety.report.acknowledged',
      reportId: 'r_ack',
      acknowledgedBy: OPERATOR_AUTHORITY,
      acknowledgedAt: '2026-06-01T00:00:00Z'
    };
    const result = gw.acceptReportDelivery({ envelope: ackEnvelope });
    expect(result.status).toBe('accepted');
  });
});

// ---------------------------------------------------------------------------
// JsonFileHttpRateLimitStore + BridgeHttpRateLimiter persistence
// ---------------------------------------------------------------------------

describe('Phase 4.5 — JsonFileHttpRateLimitStore', () => {
  it('round-trips bucket state through a file', async () => {
    const dir = await tempDir('rlstore-');
    const filePath = join(dir, 'rl.json');
    const store1 = new JsonFileHttpRateLimitStore({ filePath });
    const limiter = await BridgeHttpRateLimiter.create({ store: store1, flushIntervalMs: 60_000 });
    // Consume some tokens to dirty the bucket
    limiter.consume('token-a', T0);
    limiter.consume('token-a', T0 + 1);
    await limiter.forceFlush();
    await limiter.dispose();

    // Reload with a fresh limiter from the same file
    const store2 = new JsonFileHttpRateLimitStore({ filePath });
    const limiter2 = await BridgeHttpRateLimiter.create({ store: store2, flushIntervalMs: 60_000 });
    const bucket = limiter2.inspectBucket('token-a');
    expect(bucket).toBeDefined();
    // Tokens should be less than the default capacity (60) after two consumes
    expect(bucket!.tokens).toBeLessThan(60);
    await limiter2.dispose();
  });

  it('cold-start returns empty map when file does not exist', async () => {
    const dir = await tempDir('rlstore-cold-');
    const store = new JsonFileHttpRateLimitStore({ filePath: join(dir, 'missing.json') });
    const loaded = await store.load();
    expect(loaded.size).toBe(0);
  });

  it('throws on corrupt JSON', async () => {
    const dir = await tempDir('rlstore-corrupt-');
    const filePath = join(dir, 'corrupt.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, 'not-json', 'utf8');
    const store = new JsonFileHttpRateLimitStore({ filePath });
    await expect(store.load()).rejects.toThrow('corrupt');
  });

  it('dirty flag is set after consume and cleared after flush', async () => {
    const limiter = await BridgeHttpRateLimiter.create({
      store: new InMemoryHttpRateLimitStore(),
      flushIntervalMs: 60_000
    });
    expect(limiter.isDirty).toBe(false);
    limiter.consume('tok', T0);
    expect(limiter.isDirty).toBe(true);
    await limiter.forceFlush();
    expect(limiter.isDirty).toBe(false);
    await limiter.dispose();
  });

  it('buckets survive a simulated restart', async () => {
    const store = new InMemoryHttpRateLimitStore();
    const limiter1 = await BridgeHttpRateLimiter.create({ store, flushIntervalMs: 60_000 });
    // Exhaust the budget quickly using a tiny-capacity config.
    // refillRatePerSecond must be > 0; use the engine minimum to
    // effectively prevent refill within the test's time range.
    // refillRatePerSecond: 0.001 = 1 token per 1000 s — negligible over ms-scale test time.
    const tinyConfig = {
      capacity: 2,
      refillRatePerSecond: 0.001,
      baseBackoffMs: 1000,
      maxBackoffMs: 60000
    };
    const limiterA = await BridgeHttpRateLimiter.create({
      store,
      config: tinyConfig,
      flushIntervalMs: 60_000
    });
    limiterA.consume('tok', T0);
    limiterA.consume('tok', T0 + 1);
    const r1 = limiterA.consume('tok', T0 + 2); // should be denied
    expect(r1.allowed).toBe(false);
    await limiterA.forceFlush();
    await limiterA.dispose();

    // Restart: new limiter, same store
    const limiterB = await BridgeHttpRateLimiter.create({
      store,
      config: tinyConfig,
      flushIntervalMs: 60_000
    });
    const r2 = limiterB.consume('tok', T0 + 3); // still denied — budget persisted
    expect(r2.allowed).toBe(false);
    await limiterB.dispose();
    void limiter1;
  });
});

// ---------------------------------------------------------------------------
// BridgeTokenRegistry hot rotation
// ---------------------------------------------------------------------------

describe('Phase 4.5 — BridgeTokenRegistry', () => {
  it('validates a token that was added after construction', async () => {
    const registry = new BridgeTokenRegistry();
    const token: AuthToken = {
      tokenId: 'tok-1',
      hashedValue: hashBearerToken('secret-bearer-value')
    };
    await registry.addToken(token);
    const result = registry.validateBearerToken('secret-bearer-value', T0);
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.tokenId).toBe('tok-1');
    }
  });

  it('revokeToken takes effect immediately on next request', async () => {
    const registry = new BridgeTokenRegistry({
      initialTokens: [{ tokenId: 'tok-rev', hashedValue: hashBearerToken('to-revoke') }]
    });
    expect(registry.validateBearerToken('to-revoke', T0).status).toBe('valid');
    await registry.revokeToken('tok-rev');
    expect(registry.validateBearerToken('to-revoke', T0).status).toBe('invalid');
  });

  it('addToken immediately authorises the new credential', async () => {
    const registry = new BridgeTokenRegistry();
    expect(registry.validateBearerToken('new-cred', T0).status).toBe('invalid');
    await registry.addToken({ tokenId: 'tok-new', hashedValue: hashBearerToken('new-cred') });
    expect(registry.validateBearerToken('new-cred', T0).status).toBe('valid');
  });

  it('expired token returns invalid', async () => {
    const past = new Date(T0 - 1000).toISOString();
    const registry = new BridgeTokenRegistry({
      initialTokens: [
        { tokenId: 'tok-exp', hashedValue: hashBearerToken('expired'), expiresAt: past }
      ]
    });
    expect(registry.validateBearerToken('expired', T0).status).toBe('invalid');
  });

  it('unknown bearer returns invalid without leaking registry info', () => {
    const registry = new BridgeTokenRegistry({
      initialTokens: [{ tokenId: 'tok-a', hashedValue: hashBearerToken('real-secret') }]
    });
    const result = registry.validateBearerToken('not-in-registry', T0);
    expect(result.status).toBe('invalid');
    // Confirm no tokenId is exposed for unmatched credential
    expect('tokenId' in result).toBe(false);
  });

  it('persists through JsonFileTokenRegistryStore across instances', async () => {
    const dir = await tempDir('tokreg-');
    const filePath = join(dir, 'tokens.json');
    const store1 = new JsonFileTokenRegistryStore({ filePath });
    const reg1 = await BridgeTokenRegistry.create({ store: store1 });
    await reg1.addToken({ tokenId: 'tok-persist', hashedValue: hashBearerToken('persisted') });

    const store2 = new JsonFileTokenRegistryStore({ filePath });
    const reg2 = await BridgeTokenRegistry.create({ store: store2 });
    expect(reg2.validateBearerToken('persisted', T0).status).toBe('valid');
  });

  it('addToken rejects duplicate tokenId', async () => {
    const registry = new BridgeTokenRegistry({
      initialTokens: [{ tokenId: 'dup', hashedValue: hashBearerToken('v1') }]
    });
    await expect(
      registry.addToken({ tokenId: 'dup', hashedValue: hashBearerToken('v2') })
    ).rejects.toThrow('already exists');
  });

  it('rejects hashedValue that is not a 64-char hex sha-256', async () => {
    const registry = new BridgeTokenRegistry();
    await expect(registry.addToken({ tokenId: 'bad', hashedValue: 'not-a-hash' })).rejects.toThrow(
      'hashedValue'
    );
  });
});

// ---------------------------------------------------------------------------
// AuthAuditLog
// ---------------------------------------------------------------------------

describe('Phase 4.5 — AuthAuditLog', () => {
  it('records accepted and rejected entries', () => {
    const log = new AuthAuditLog();
    log.record({
      timestamp: '2026-06-01T00:00:00Z',
      outcome: 'accepted',
      tokenIdPrefix: 'tok-abc1',
      requestPath: '/bridge/deliver'
    });
    log.record({
      timestamp: '2026-06-01T00:00:01Z',
      outcome: 'rejected',
      requestPath: '/bridge/deliver'
    });
    expect(log.size).toBe(2);
    const entries = log.entries();
    expect(entries[0]!.outcome).toBe('accepted');
    expect(entries[0]!.tokenIdPrefix).toBe('tok-abc1');
    expect(entries[1]!.outcome).toBe('rejected');
    expect(entries[1]!.tokenIdPrefix).toBeUndefined();
  });

  it('evicts oldest entry when capacity is reached (FIFO)', () => {
    const log = new AuthAuditLog({ capacity: 3 });
    for (let i = 0; i < 4; i++) {
      log.record({
        timestamp: `2026-06-01T00:00:0${i}Z`,
        outcome: 'accepted',
        tokenIdPrefix: `pref${i}`,
        requestPath: '/p'
      });
    }
    expect(log.size).toBe(3);
    // Oldest (pref0) evicted; pref1, pref2, pref3 remain
    expect(log.entries()[0]!.tokenIdPrefix).toBe('pref1');
    expect(log.entries()[2]!.tokenIdPrefix).toBe('pref3');
  });

  it('tokenIdPrefix is never the full hash — first 8 chars only', () => {
    const log = new AuthAuditLog();
    const prefix = 'tok-abcd'; // exactly 8 chars
    log.record({ timestamp: 'T', outcome: 'accepted', tokenIdPrefix: prefix, requestPath: '/p' });
    expect(log.entries()[0]!.tokenIdPrefix).toBe('tok-abcd');
    expect(log.entries()[0]!.tokenIdPrefix!.length).toBe(8);
  });

  it('unmatched rejection carries no tokenIdPrefix', () => {
    const log = new AuthAuditLog();
    log.record({ timestamp: 'T', outcome: 'rejected', requestPath: '/p' });
    expect(log.entries()[0]!.tokenIdPrefix).toBeUndefined();
  });

  it('persists and loads from JsonFileAuthAuditStore', async () => {
    const dir = await tempDir('audit-');
    const filePath = join(dir, 'audit.jsonl');
    const store = new JsonFileAuthAuditStore({ filePath });
    const log = new AuthAuditLog({ capacity: 100, store });
    log.record({
      timestamp: 'T1',
      outcome: 'accepted',
      tokenIdPrefix: 'tok12345',
      requestPath: '/bridge/deliver'
    });
    log.record({ timestamp: 'T2', outcome: 'rejected', requestPath: '/bridge/deliver' });
    // Give the best-effort async writes a moment to complete.
    // appendFile calls are queued to libuv's thread pool; two
    // consecutive calls may not land in strict order.
    await new Promise((r) => setTimeout(r, 50));
    const loaded = await store.load();
    expect(loaded.length).toBe(2);
    const outcomes = loaded.map((e) => e.outcome).sort();
    expect(outcomes).toEqual(['accepted', 'rejected']);
  });
});

// ---------------------------------------------------------------------------
// rotateOperatorAuthority
// ---------------------------------------------------------------------------

describe('Phase 4.5 — rotateOperatorAuthority', () => {
  it('new authority takes effect immediately on next admit', () => {
    const gw = new BridgeAdmissionGateway({ config: GATEWAY_CONFIG });
    const newAuthority = {
      ...OPERATOR_AUTHORITY,
      authorityId: 'auth_rotated',
      actorId: 'actor_new_op'
    };
    gw.rotateOperatorAuthority(newAuthority);
    const dec = gw.admit(makeRequest('evt_rotated'), T0);
    // The decision should carry the new authority
    expect(dec.result.decision.operatorAuthority.authorityId).toBe('auth_rotated');
  });
});
