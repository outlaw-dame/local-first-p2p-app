import { describe, expect, it } from 'vitest';
import { ForegroundSyncController } from './foreground-sync.js';

describe('ForegroundSyncController', () => {
  it('runs a foreground sync request and resets failure state on success', async () => {
    let current = new Date('2026-05-25T00:00:00.000Z');
    const seen: string[] = [];
    const controller = new ForegroundSyncController({
      now: () => current,
      run: async (input) => {
        seen.push(`${input.trigger}:${input.startedAt}`);
        current = new Date('2026-05-25T00:00:01.000Z');
        return { outboxConfirmed: 1 };
      }
    });

    const result = await controller.requestSync('startup');

    expect(seen).toEqual(['startup:2026-05-25T00:00:00.000Z']);
    expect(result).toEqual({
      status: 'completed',
      trigger: 'startup',
      startedAt: '2026-05-25T00:00:00.000Z',
      finishedAt: '2026-05-25T00:00:01.000Z',
      consecutiveFailures: 0,
      result: { outboxConfirmed: 1 }
    });
    expect(controller.getState()).toEqual({
      status: 'idle',
      consecutiveFailures: 0,
      lastStartedAt: '2026-05-25T00:00:00.000Z',
      lastCompletedAt: '2026-05-25T00:00:01.000Z'
    });
  });

  it('validates jitter ratio at construction time', () => {
    expect(
      () =>
        new ForegroundSyncController({
          jitterRatio: 1.1,
          run: async () => undefined
        })
    ).toThrow('jitterRatio must be between 0 and 1');
    expect(
      () =>
        new ForegroundSyncController({
          jitterRatio: -0.1,
          run: async () => undefined
        })
    ).toThrow('jitterRatio must be between 0 and 1');
  });

  it('does not start overlapping foreground sync runs', async () => {
    let releaseRun!: () => void;
    const controller = new ForegroundSyncController({
      now: () => new Date('2026-05-25T00:00:00.000Z'),
      run: async () =>
        new Promise<void>((resolve) => {
          releaseRun = resolve;
        })
    });

    const first = controller.requestSync('manual');
    const second = await controller.requestSync('timer');
    releaseRun();
    const completed = await first;

    expect(second).toEqual({
      status: 'skipped',
      trigger: 'timer',
      skippedAt: '2026-05-25T00:00:00.000Z',
      reason: 'already-running'
    });
    expect(completed).toMatchObject({ status: 'completed', trigger: 'manual' });
  });

  it('skips foreground sync while offline without mutating state', async () => {
    const controller = new ForegroundSyncController({
      isOnline: () => false,
      now: () => new Date('2026-05-25T00:00:00.000Z'),
      run: async () => {
        throw new Error('unexpected sync run');
      }
    });

    await expect(controller.requestSync('online')).resolves.toEqual({
      status: 'skipped',
      trigger: 'online',
      skippedAt: '2026-05-25T00:00:00.000Z',
      reason: 'offline'
    });
    expect(controller.getState()).toEqual({ status: 'idle', consecutiveFailures: 0 });
  });

  it('backs off after failures and allows explicit manual bypass', async () => {
    let current = new Date('2026-05-25T00:00:00.000Z');
    let attempts = 0;
    const controller = new ForegroundSyncController({
      now: () => current,
      baseDelayMs: 1_000,
      maxDelayMs: 60_000,
      jitterRatio: 0,
      run: async () => {
        attempts += 1;
        if (attempts <= 2) throw new Error(`sync failure ${attempts}`);
        return { recovered: true };
      }
    });

    const failed = await controller.requestSync('startup');
    expect(failed).toEqual({
      status: 'failed',
      trigger: 'startup',
      startedAt: '2026-05-25T00:00:00.000Z',
      finishedAt: '2026-05-25T00:00:00.000Z',
      consecutiveFailures: 1,
      error: 'sync failure 1',
      errorName: 'Error',
      nextRetryAt: '2026-05-25T00:00:02.000Z'
    });

    current = new Date('2026-05-25T00:00:01.000Z');
    await expect(controller.requestSync('timer')).resolves.toEqual({
      status: 'skipped',
      trigger: 'timer',
      skippedAt: '2026-05-25T00:00:01.000Z',
      reason: 'backoff',
      nextRetryAt: '2026-05-25T00:00:02.000Z'
    });

    const forced = await controller.requestSync('manual', { bypassBackoff: true });
    expect(forced).toMatchObject({
      status: 'failed',
      trigger: 'manual',
      consecutiveFailures: 2,
      error: 'sync failure 2',
      nextRetryAt: '2026-05-25T00:00:05.000Z'
    });

    current = new Date('2026-05-25T00:00:05.000Z');
    await expect(controller.requestSync('timer')).resolves.toEqual({
      status: 'completed',
      trigger: 'timer',
      startedAt: '2026-05-25T00:00:05.000Z',
      finishedAt: '2026-05-25T00:00:05.000Z',
      consecutiveFailures: 0,
      result: { recovered: true }
    });
    expect(controller.getState()).toEqual({
      status: 'idle',
      consecutiveFailures: 0,
      lastStartedAt: '2026-05-25T00:00:05.000Z',
      lastCompletedAt: '2026-05-25T00:00:05.000Z'
    });
  });

  it('preserves the last successful completion timestamp after a later failed run', async () => {
    let current = new Date('2026-05-25T00:00:00.000Z');
    let failNext = false;
    const controller = new ForegroundSyncController({
      now: () => current,
      baseDelayMs: 1_000,
      jitterRatio: 0,
      run: async () => {
        if (failNext) throw new Error('transient sync error');
        current = new Date('2026-05-25T00:00:01.000Z');
        return undefined;
      }
    });

    await expect(controller.requestSync('startup')).resolves.toMatchObject({ status: 'completed' });
    failNext = true;
    current = new Date('2026-05-25T00:05:00.000Z');
    await expect(controller.requestSync('timer')).resolves.toMatchObject({
      status: 'failed',
      nextRetryAt: '2026-05-25T00:05:02.000Z'
    });

    expect(controller.getState()).toMatchObject({
      status: 'backing-off',
      consecutiveFailures: 1,
      lastCompletedAt: '2026-05-25T00:00:01.000Z',
      lastFailedAt: '2026-05-25T00:05:00.000Z',
      lastError: 'transient sync error'
    });
  });
});
