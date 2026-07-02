import { describe, expect, it, vi } from 'vitest';
import {
  createPwaOutboxDeliveryPlan,
  formatPwaOutboxDeliveryPlan
} from './pwa-outbox-delivery-plan.js';

const ENABLED_CONFIG_ENV = {
  VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'true',
  VITE_LFP2P_BRIDGE_ENDPOINT: 'https://bridge.example.test/events'
} as const;

describe('createPwaOutboxDeliveryPlan', () => {
  it('reports disabled bridge config without creating a transport', () => {
    let createTransportCalls = 0;
    const plan = createPwaOutboxDeliveryPlan({
      pendingOutboxCount: 2,
      env: {},
      createTransport: () => {
        createTransportCalls += 1;
        throw new Error('transport should not be created for disabled config');
      }
    });

    expect(plan).toMatchObject({
      status: 'delivery-disabled',
      deliveryEnabled: false,
      pendingOutboxCount: 2,
      bridgeTransportStatus: 'disabled'
    });
    expect(plan.message).toBe(
      '2 pending outbox entries; bridge transport is disabled; delivery remains disabled.'
    );
    expect(createTransportCalls).toBe(0);
  });

  it('reports invalid bridge config without creating a transport', () => {
    let createTransportCalls = 0;
    const plan = createPwaOutboxDeliveryPlan({
      pendingOutboxCount: 1,
      env: { VITE_LFP2P_BRIDGE_SYNC_ENABLED: 'true' },
      createTransport: () => {
        createTransportCalls += 1;
        throw new Error('transport should not be created for invalid config');
      }
    });

    expect(plan.bridgeTransportStatus).toBe('invalid');
    expect(plan.message).toBe(
      '1 pending outbox entry; bridge transport config is invalid; delivery remains disabled.'
    );
    expect(createTransportCalls).toBe(0);
  });

  it('reports missing fetch without throwing or sending network requests', () => {
    const plan = createPwaOutboxDeliveryPlan({
      pendingOutboxCount: 0,
      env: ENABLED_CONFIG_ENV,
      fetch: null
    });

    expect(plan.bridgeTransportStatus).toBe('fetch-unavailable');
    expect(plan.message).toBe(
      '0 pending outbox entries; bridge transport is unavailable because fetch is missing; delivery remains disabled.'
    );
  });

  it('reports prepared transport without invoking fetch', () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ status: 'confirmed' })));

    const plan = createPwaOutboxDeliveryPlan({
      pendingOutboxCount: 3,
      env: ENABLED_CONFIG_ENV,
      fetch: fetchSpy
    });

    expect(plan).toMatchObject({
      status: 'delivery-disabled',
      deliveryEnabled: false,
      pendingOutboxCount: 3,
      bridgeTransportStatus: 'prepared'
    });
    expect(formatPwaOutboxDeliveryPlan(plan)).toBe(
      '3 pending outbox entries; bridge transport is prepared; delivery remains disabled.'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect('transport' in plan).toBe(false);
  });

  it('rejects unsafe pending outbox counts', () => {
    expect(() => createPwaOutboxDeliveryPlan({ pendingOutboxCount: -1, env: {} })).toThrow(
      'pendingOutboxCount must be a non-negative safe integer.'
    );
    expect(() => createPwaOutboxDeliveryPlan({ pendingOutboxCount: 0.5, env: {} })).toThrow(
      'pendingOutboxCount must be a non-negative safe integer.'
    );
    expect(() =>
      createPwaOutboxDeliveryPlan({ pendingOutboxCount: Number.MAX_SAFE_INTEGER + 1, env: {} })
    ).toThrow('pendingOutboxCount must be a non-negative safe integer.');
  });
});
