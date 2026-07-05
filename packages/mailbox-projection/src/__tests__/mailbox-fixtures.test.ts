/**
 * Phase 5.11 Step 2 — mailbox payload schema fixtures.
 *
 * A dedicated, data-driven conformance suite for the seven `mailbox.*`
 * decrypted payload schemas. Each fixture is a small scenario applied
 * through the real `applyMailboxEvent` state machine — valid fixtures
 * must project the asserted entry; invalid fixtures must be rejected
 * with a stable `MAILBOX_*` code (never with payload content). No
 * runtime changes: this pins the schema surface so a later drift is
 * caught here rather than downstream in persistence or the PWA.
 *
 * Fixtures live in `fixtures/{valid,invalid}` and are enumerated from
 * disk (mirroring the Phase 2.1 identity fixtures), so adding a fixture
 * file is enough to extend coverage.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@lfp2p/protocol';
import {
  MAILBOX_ERROR_CODES,
  MailboxProjectionError,
  applyMailboxEvent,
  createEmptyMailboxState,
  isMailboxEventKind,
  type MailboxEventKind,
  type MailboxState
} from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(HERE, '..', '..', 'fixtures');

type LogEntry = Readonly<{
  kind: string;
  eventId: string;
  createdAt: string;
  payload: JsonValue;
}>;

type EnvelopeAssert = Readonly<{
  recipientDeviceId?: string;
  recipientDeviceIdAbsent?: boolean;
  forwardedFrom?: string;
  forwardedFromAbsent?: boolean;
}>;

type SideAssert = Readonly<{
  key: string;
  status?: string;
  deliveredAt?: string;
  fetchedAt?: string;
  expiredAt?: string;
  expiredReason?: string;
  providerId?: string;
  ackKind?: string;
  receiptCount?: number;
  envelope?: EnvelopeAssert;
}>;

type ValidFixture = Readonly<{
  name: string;
  identityId: string;
  log: readonly LogEntry[];
  assert: Readonly<{
    inbox?: SideAssert;
    outbox?: SideAssert;
    checkpoint?: Readonly<{ key: string; cursor: string; checkpointId: string }>;
  }>;
}>;

type InvalidFixture = Readonly<{
  name: string;
  identityId: string;
  setup?: readonly LogEntry[];
  event: LogEntry;
  errorCode: string;
}>;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function listFixtures(subdir: 'valid' | 'invalid'): string[] {
  const dir = join(FIXTURES_ROOT, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort();
}

/** Apply a fixture log in declared order; every kind must be a mailbox kind. */
function foldLog(identityId: string, log: readonly LogEntry[]): MailboxState {
  let state = createEmptyMailboxState(identityId);
  for (const entry of log) {
    expect(isMailboxEventKind(entry.kind)).toBe(true);
    state = applyMailboxEvent(state, entry.payload, {
      kind: entry.kind as MailboxEventKind,
      eventId: entry.eventId,
      createdAt: entry.createdAt
    });
  }
  return state;
}

function checkEnvelope(
  actual: { readonly recipientDeviceId?: string; readonly forwardedFrom?: string },
  expected: EnvelopeAssert
): void {
  if (expected.recipientDeviceId !== undefined) {
    expect(actual.recipientDeviceId).toBe(expected.recipientDeviceId);
  }
  if (expected.recipientDeviceIdAbsent === true) {
    expect(actual.recipientDeviceId).toBeUndefined();
  }
  if (expected.forwardedFrom !== undefined) {
    expect(actual.forwardedFrom).toBe(expected.forwardedFrom);
  }
  if (expected.forwardedFromAbsent === true) {
    expect(actual.forwardedFrom).toBeUndefined();
  }
}

const valid = listFixtures('valid');
const invalid = listFixtures('invalid');

describe('mailbox payload fixtures — suite completeness', () => {
  it('has exactly 10 valid and 8 invalid fixtures (per Phase 5.11 Step 2)', () => {
    expect(valid).toHaveLength(10);
    expect(invalid).toHaveLength(8);
  });

  it('valid fixtures cover every one of the seven mailbox kinds', () => {
    const covered = new Set<string>();
    for (const name of valid) {
      const fx = readJson<ValidFixture>(join(FIXTURES_ROOT, 'valid', name));
      for (const entry of fx.log) covered.add(entry.kind);
    }
    const MAILBOX_KINDS: readonly MailboxEventKind[] = [
      'mailbox.envelope.queued',
      'mailbox.envelope.delivered',
      'mailbox.envelope.expired',
      'mailbox.envelope.fetched',
      'mailbox.receipt.issued',
      'mailbox.ack.sent',
      'mailbox.checkpoint.advanced'
    ];
    for (const kind of MAILBOX_KINDS) expect(covered.has(kind)).toBe(true);
  });
});

describe('mailbox payload fixtures — valid', () => {
  it.each(valid)('valid: %s projects the asserted entry', (name) => {
    const fx = readJson<ValidFixture>(join(FIXTURES_ROOT, 'valid', name));
    const state = foldLog(fx.identityId, fx.log);

    if (fx.assert.inbox !== undefined) {
      const a = fx.assert.inbox;
      const entry = state.inbox.get(a.key);
      expect(entry, `inbox[${a.key}] should exist`).toBeDefined();
      if (a.status !== undefined) expect(entry?.status).toBe(a.status);
      if (a.deliveredAt !== undefined) expect(entry?.deliveredAt).toBe(a.deliveredAt);
      if (a.fetchedAt !== undefined) expect(entry?.fetchedAt).toBe(a.fetchedAt);
      if (a.expiredAt !== undefined) expect(entry?.expiredAt).toBe(a.expiredAt);
      if (a.expiredReason !== undefined) expect(entry?.expiredReason).toBe(a.expiredReason);
      if (a.receiptCount !== undefined) expect(entry?.receipts).toHaveLength(a.receiptCount);
      if (a.envelope !== undefined && entry !== undefined)
        checkEnvelope(entry.envelope, a.envelope);
    }

    if (fx.assert.outbox !== undefined) {
      const a = fx.assert.outbox;
      const entry = state.outbox.get(a.key);
      expect(entry, `outbox[${a.key}] should exist`).toBeDefined();
      if (a.status !== undefined) expect(entry?.status).toBe(a.status);
      if (a.deliveredAt !== undefined) expect(entry?.deliveredAt).toBe(a.deliveredAt);
      if (a.providerId !== undefined) expect(entry?.providerId).toBe(a.providerId);
      if (a.expiredReason !== undefined) expect(entry?.expiredReason).toBe(a.expiredReason);
      if (a.ackKind !== undefined) expect(entry?.ack?.ackKind).toBe(a.ackKind);
      if (a.envelope !== undefined && entry !== undefined)
        checkEnvelope(entry.envelope, a.envelope);
    }

    if (fx.assert.checkpoint !== undefined) {
      const a = fx.assert.checkpoint;
      const checkpoint = state.checkpoints.get(a.key);
      expect(checkpoint, `checkpoint[${a.key}] should exist`).toBeDefined();
      expect(checkpoint?.cursor).toBe(a.cursor);
      expect(checkpoint?.checkpointId).toBe(a.checkpointId);
    }
  });
});

describe('mailbox payload fixtures — invalid', () => {
  it.each(invalid)('invalid: %s is rejected with the declared code', (name) => {
    const fx = readJson<InvalidFixture>(join(FIXTURES_ROOT, 'invalid', name));
    expect((MAILBOX_ERROR_CODES as readonly string[]).includes(fx.errorCode)).toBe(true);

    // Setup (if any) must itself be valid — the rejection is caused by
    // the fixture's `event`, not by a malformed precondition.
    const state = foldLog(fx.identityId, fx.setup ?? []);

    let thrown: unknown;
    try {
      applyMailboxEvent(state, fx.event.payload, {
        kind: fx.event.kind as MailboxEventKind,
        eventId: fx.event.eventId,
        createdAt: fx.event.createdAt
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown, `${name} should have thrown`).toBeInstanceOf(MailboxProjectionError);
    expect((thrown as MailboxProjectionError).code).toBe(fx.errorCode);
    // Privacy-safe: the error message must not echo payload content.
    expect((thrown as MailboxProjectionError).message).not.toContain('sha-256:');
  });

  it('a rejected event never mutates the input state', () => {
    const fx = readJson<InvalidFixture>(
      join(FIXTURES_ROOT, 'invalid', 'delivered-missing-deliveredAt.json')
    );
    const state = foldLog(fx.identityId, fx.setup ?? []);
    const before = state.inbox.get('e1')?.status;
    expect(() =>
      applyMailboxEvent(state, fx.event.payload, {
        kind: fx.event.kind as MailboxEventKind,
        eventId: fx.event.eventId,
        createdAt: fx.event.createdAt
      })
    ).toThrow(MailboxProjectionError);
    expect(state.inbox.get('e1')?.status).toBe(before);
  });
});
