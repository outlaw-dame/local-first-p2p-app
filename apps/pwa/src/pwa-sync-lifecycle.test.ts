import { describe, expect, it } from 'vitest';
import type { ForegroundSyncResult, ForegroundSyncTrigger } from '@lfp2p/sync-client/foreground-sync';
import {
  attachPwaForegroundSyncTriggers,
  browserIsOnline,
  createPwaForegroundSyncController,
  formatPwaForegroundSyncResult,
  formatPwaSyncStatusText,
  requestPwaForegroundSync,
  type EventSubscriptionTarget,
  type PwaForegroundSyncController,
  type VisibilitySubscriptionTarget
} from './pwa-sync-lifecycle.js';

describe('PWA foreground sync lifecycle helpers', () => {
  it('reads browser online state conservatively', () => {
    expect(browserIsOnline({})).toBe(true);
    expect(browserIsOnline({ navigator: { onLine: true } })).toBe(true);
    expect(browserIsOnline({ navigator: { onLine: false } })).toBe(false);
  });

  it('does not run sync when the browser reports offline', async () => {
    let runs = 0;
    const controller = createPwaForegroundSyncController({
      onlineSource: { navigator: { onLine: false } },
      now: () => new Date('2026-05-25T00:00:00.000Z'),
      async run() {
        runs += 1;
      }
    });

    const result = await controller.requestSync('startup');

    expect(result.status).toBe('skipped');
    expect(result).toMatchObject({ reason: 'offline' });
    expect(runs).toBe(0);
  });

  it('attaches foreground browser triggers and detaches them', async () => {
    const windowTarget = new FakeTarget();
    const documentTarget = new FakeVisibleTarget('hidden');
    const requests: ForegroundSyncTrigger[] = [];
    const controller: PwaForegroundSyncController = {
      getState: () => ({ status: 'idle', consecutiveFailures: 0 }),
      async requestSync(trigger) {
        requests.push(trigger);
        return completed(trigger);
      }
    };

    const dispose = attachPwaForegroundSyncTriggers({ controller, windowTarget, documentTarget });
    windowTarget.dispatch('online');
    documentTarget.dispatch('visibilitychange');
    documentTarget.visibilityState = 'visible';
    documentTarget.dispatch('visibilitychange');
    await Promise.resolve();

    expect(requests).toEqual(['online', 'visible']);

    dispose();
    windowTarget.dispatch('online');
    documentTarget.dispatch('visibilitychange');
    await Promise.resolve();

    expect(requests).toEqual(['online', 'visible']);
  });

  it('does not treat missing visibility state as a visible foreground transition', async () => {
    const documentTarget = new FakeTarget();
    const requests: ForegroundSyncTrigger[] = [];
    const controller: PwaForegroundSyncController = {
      getState: () => ({ status: 'idle', consecutiveFailures: 0 }),
      async requestSync(trigger) {
        requests.push(trigger);
        return completed(trigger);
      }
    };

    attachPwaForegroundSyncTriggers({ controller, windowTarget: null, documentTarget });
    documentTarget.dispatch('visibilitychange');
    await Promise.resolve();

    expect(requests).toEqual([]);
  });

  it('routes unexpected trigger rejections to the error callback', async () => {
    const windowTarget = new FakeTarget();
    const errors: { error: unknown; trigger: ForegroundSyncTrigger }[] = [];
    const controller: PwaForegroundSyncController = {
      getState: () => ({ status: 'idle', consecutiveFailures: 0 }),
      async requestSync() {
        throw new Error('unexpected listener failure');
      }
    };

    attachPwaForegroundSyncTriggers({
      controller,
      windowTarget,
      documentTarget: null,
      onUnexpectedError: (error, trigger) => errors.push({ error, trigger })
    });
    windowTarget.dispatch('online');
    await Promise.resolve();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.trigger).toBe('online');
    expect(errors[0]?.error).toBeInstanceOf(Error);
  });

  it('reports manual foreground sync results', async () => {
    const expected = completed('manual');
    const seen: ForegroundSyncResult[] = [];
    const controller: PwaForegroundSyncController = {
      getState: () => ({ status: 'idle', consecutiveFailures: 0 }),
      async requestSync() {
        return expected;
      }
    };

    await expect(requestPwaForegroundSync(controller, 'manual', (result) => seen.push(result))).resolves.toBe(expected);
    expect(seen).toEqual([expected]);
  });

  it('formats foreground sync status strings', () => {
    expect(formatPwaForegroundSyncResult(completed('startup'))).toBe('Foreground sync completed from startup.');
    expect(
      formatPwaForegroundSyncResult({
        status: 'failed',
        trigger: 'online',
        startedAt: '2026-05-25T00:00:00.000Z',
        finishedAt: '2026-05-25T00:00:01.000Z',
        consecutiveFailures: 1,
        error: 'temporary relay failed',
        nextRetryAt: '2026-05-25T00:00:02.000Z'
      })
    ).toBe('Foreground sync failed from online: temporary relay failed.');
    expect(
      formatPwaForegroundSyncResult({
        status: 'skipped',
        trigger: 'visible',
        skippedAt: '2026-05-25T00:00:00.000Z',
        reason: 'backoff',
        nextRetryAt: '2026-05-25T00:01:00.000Z'
      })
    ).toMatch(/^Foreground sync skipped from visible: backing off until .+\.$/u);
  });

  it('normalizes and truncates status text consistently', () => {
    expect(formatPwaSyncStatusText(new Error('temporary\nrelay\tfailed'))).toBe('temporary relay failed');
    expect(formatPwaSyncStatusText('')).toBe('Unknown foreground sync failure');
    expect(formatPwaSyncStatusText('a'.repeat(240))).toHaveLength(180);
  });
});

class FakeTarget implements EventSubscriptionTarget {
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener({ type } as Event);
      else listener.handleEvent({ type } as Event);
    }
  }
}

class FakeVisibleTarget extends FakeTarget implements VisibilitySubscriptionTarget {
  constructor(public visibilityState: DocumentVisibilityState) {
    super();
  }
}

function completed(trigger: ForegroundSyncTrigger): Extract<ForegroundSyncResult, { status: 'completed' }> {
  return {
    status: 'completed',
    trigger,
    startedAt: '2026-05-25T00:00:00.000Z',
    finishedAt: '2026-05-25T00:00:01.000Z',
    consecutiveFailures: 0
  };
}
