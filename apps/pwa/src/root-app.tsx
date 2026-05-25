import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App as Framework7App,
  Badge,
  Block,
  BlockTitle,
  Button,
  List,
  ListItem,
  Navbar,
  Page,
  View
} from 'framework7-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { signEventEnvelope, type SigningKeypair } from '@lfp2p/crypto';
import { DeviceIdentityManager, type LocalDeviceIdentity } from '@lfp2p/identity';
import { createLocalFirstStore, type EventSummaryView } from '@lfp2p/local-store';
import { detectPlatformCapabilities } from '@lfp2p/platform';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { createIdempotencyKey } from '@lfp2p/sync-client';
import { LocalFirstStatusCard } from '@lfp2p/ui';
import { formatPwaBridgeConfigStatus, resolvePwaBridgeConfig } from './pwa-bridge-config.js';
import { manualOutboxDeliveryActionEnabled, runManualOutboxDelivery } from './pwa-outbox-manual-gate.js';
import { createPwaOutboxDeliveryPlan, formatPwaOutboxDeliveryPlan } from './pwa-outbox-delivery-plan.js';
import {
  attachPwaForegroundSyncTriggers,
  createPwaForegroundSyncController,
  formatPwaForegroundSyncResult,
  formatPwaSyncStatusText,
  requestPwaForegroundSync,
  type PwaForegroundSyncController
} from './pwa-sync-lifecycle.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2
    }
  }
});

type LocalRefreshSnapshot = Readonly<{
  identity: LocalDeviceIdentity;
  keypair: SigningKeypair;
  events: EventSummaryView[];
  pendingOutboxCount: number;
}>;

export function RootApp(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <Framework7App name="Local-First P2P" theme="ios">
        <View main>
          <HomePage />
        </View>
      </Framework7App>
    </QueryClientProvider>
  );
}

function HomePage(): JSX.Element {
  const capabilities = useMemo(() => detectPlatformCapabilities(), []);
  const bridgeConfig = useMemo(() => resolvePwaBridgeConfig(), []);
  const manualDeliveryEnabled = useMemo(() => manualOutboxDeliveryActionEnabled(), []);
  const store = useMemo(() => createLocalFirstStore('lfp2p-pwa-v1'), []);
  const identityManager = useMemo(() => new DeviceIdentityManager(store), [store]);
  const mountedRef = useRef(false);
  const syncControllerRef = useRef<PwaForegroundSyncController | null>(null);
  const manualDeliveryRunningRef = useRef(false);
  const [identity, setIdentity] = useState<LocalDeviceIdentity | null>(null);
  const [keypair, setKeypair] = useState<SigningKeypair | null>(null);
  const [events, setEvents] = useState<EventSummaryView[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState('Bootstrapping local device identity.');
  const [syncStatus, setSyncStatus] = useState('Foreground sync idle.');
  const [manualDeliveryStatus, setManualDeliveryStatus] = useState('Manual outbox delivery is disabled.');
  const [manualDeliveryRunning, setManualDeliveryRunning] = useState(false);
  const outboxDeliveryPlan = useMemo(
    () => createPwaOutboxDeliveryPlan({ pendingOutboxCount: pendingCount }),
    [pendingCount]
  );

  const loadLocalState = useCallback(async (): Promise<LocalRefreshSnapshot> => {
    const [session, eventSummaries, outbox] = await Promise.all([
      identityManager.getOrCreatePrimaryDeviceSession(),
      store.listEventSummaries(),
      store.listPendingOutbox()
    ]);
    return {
      identity: session.identity,
      keypair: session.keypair,
      events: eventSummaries,
      pendingOutboxCount: outbox.length
    };
  }, [identityManager, store]);

  const applyLocalStateSnapshot = useCallback((snapshot: LocalRefreshSnapshot, readyStatus: string): void => {
    setIdentity(snapshot.identity);
    setKeypair(snapshot.keypair);
    setEvents(snapshot.events);
    setPendingCount(snapshot.pendingOutboxCount);
    setStatus(readyStatus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    void loadLocalState().then(
      (snapshot) => {
        if (!cancelled) applyLocalStateSnapshot(snapshot, 'Ready for local-first writes.');
      },
      (error: unknown) => {
        if (!cancelled) setStatus(`Identity bootstrap failed: ${formatUiError(error)}`);
      }
    );

    return () => {
      cancelled = true;
      mountedRef.current = false;
      void store.close();
    };
  }, [applyLocalStateSnapshot, loadLocalState, store]);

  useEffect(() => {
    let cancelled = false;
    const controller = createPwaForegroundSyncController({
      async run() {
        const snapshot = await loadLocalState();
        if (!cancelled) applyLocalStateSnapshot(snapshot, 'Foreground sync refreshed local state.');
        return { eventCount: snapshot.events.length, pendingOutboxCount: snapshot.pendingOutboxCount };
      }
    });
    syncControllerRef.current = controller;

    const updateSyncStatus = (message: string): void => {
      if (!cancelled) setSyncStatus(message);
    };
    const dispose = attachPwaForegroundSyncTriggers({
      controller,
      onResult: (result) => updateSyncStatus(formatPwaForegroundSyncResult(result)),
      onUnexpectedError: (error) => updateSyncStatus(`Foreground sync failed: ${formatUiError(error)}.`)
    });
    void requestPwaForegroundSync(controller, 'startup', (result) => {
      updateSyncStatus(formatPwaForegroundSyncResult(result));
    }).catch((error: unknown) => updateSyncStatus(`Foreground sync failed: ${formatUiError(error)}.`));

    return () => {
      cancelled = true;
      if (syncControllerRef.current === controller) syncControllerRef.current = null;
      dispose();
    };
  }, [applyLocalStateSnapshot, loadLocalState]);

  async function createLocalEvent(): Promise<void> {
    if (!identity || !keypair) {
      setStatus('Local device identity is not ready yet.');
      return;
    }

    const now = new Date().toISOString();
    const eventId = `evt_${globalThis.crypto.randomUUID()}`;
    const unsigned = createUnsignedEvent({
      eventId,
      kind: 'outbox.test.created',
      author: identity.identityId,
      deviceId: identity.deviceId,
      createdAt: now,
      privacy: 'device-local',
      payload: {
        title: 'Local-first event',
        body: 'Created locally, signed locally, stored before sync.'
      }
    });
    const signed = signEventEnvelope(unsigned, keypair);
    await store.putSignedEvent(signed);
    await store.putEventSummary({
      eventId,
      title: 'Local-first event',
      subtitle: 'Signed, stored, and queued locally.',
      createdAt: now
    });
    await store.enqueueOutbox({
      idempotencyKey: createIdempotencyKey('local-event'),
      eventId,
      target: 'bridge:development',
      status: 'pending',
      retryCount: 0,
      nextRetryAt: now,
      createdAt: now,
      updatedAt: now
    });
    applyLocalStateSnapshot(await loadLocalState(), 'Local event created and queued without waiting for the network.');
  }

  async function runManualForegroundSync(): Promise<void> {
    const syncController = syncControllerRef.current;
    if (syncController === null) {
      setSyncStatus('Foreground sync controller is not ready yet.');
      return;
    }
    try {
      const result = await requestPwaForegroundSync(syncController, 'manual');
      if (mountedRef.current) setSyncStatus(formatPwaForegroundSyncResult(result));
    } catch (error: unknown) {
      if (mountedRef.current) setSyncStatus(`Foreground sync failed: ${formatUiError(error)}.`);
    }
  }

  async function runManualOutboxDeliveryOnce(): Promise<void> {
    if (manualDeliveryRunningRef.current) return;
    manualDeliveryRunningRef.current = true;
    setManualDeliveryRunning(true);
    setManualDeliveryStatus('Manual outbox delivery running.');
    try {
      const result = await runManualOutboxDelivery({ store, batchSize: 1 });
      const snapshot = await loadLocalState();
      if (mountedRef.current) {
        setManualDeliveryStatus(result.message);
        applyLocalStateSnapshot(snapshot, 'Manual outbox delivery action completed.');
      }
    } catch (error: unknown) {
      if (mountedRef.current) setManualDeliveryStatus(`Manual outbox delivery failed: ${formatUiError(error)}.`);
    } finally {
      manualDeliveryRunningRef.current = false;
      if (mountedRef.current) setManualDeliveryRunning(false);
    }
  }

  return (
    <Page name="home">
      <Navbar title="Local P2P" large transparent />
      <Block strong inset>
        <LocalFirstStatusCard>
          <h1>Local-first light peer</h1>
          <p>
            This PWA writes signed protocol events to local storage first, renders from local views,
            and syncs later through bridge infrastructure.
          </p>
          <Button fill large disabled={!identity || !keypair} onClick={() => void createLocalEvent()}>
            Create signed local event
          </Button>
        </LocalFirstStatusCard>
      </Block>

      <BlockTitle>Local device identity</BlockTitle>
      <List inset strong>
        <ListItem title="Identity" after={identity ? truncateMiddle(identity.identityId) : 'bootstrapping'} />
        <ListItem title="Device" after={identity ? truncateMiddle(identity.deviceId) : 'bootstrapping'} />
      </List>

      <BlockTitle>Runtime capability snapshot</BlockTitle>
      <List inset strong>
        <ListItem title="Runtime" after={capabilities.runtime} />
        <ListItem title="Platform" after={capabilities.platform} />
        <ListItem title="Web Push" after={capabilities.webPush ? 'available' : 'unavailable'} />
        <ListItem title="OPFS" after={capabilities.opfs ? 'available' : 'unavailable'} />
        <ListItem title="WebRTC" after={capabilities.webRtc ? 'available' : 'unavailable'} />
      </List>

      <BlockTitle>Bridge sync boundary</BlockTitle>
      <Block inset strong>
        <p>{formatPwaBridgeConfigStatus(bridgeConfig)}</p>
      </Block>

      <BlockTitle>Foreground sync lifecycle</BlockTitle>
      <Block inset strong>
        <p>{syncStatus}</p>
        <Button outline onClick={() => void runManualForegroundSync()}>
          Refresh foreground sync state
        </Button>
      </Block>

      <BlockTitle>Outbox delivery dry run</BlockTitle>
      <Block inset strong>
        <p>{formatPwaOutboxDeliveryPlan(outboxDeliveryPlan)}</p>
      </Block>

      <BlockTitle>Manual outbox delivery</BlockTitle>
      <Block inset strong>
        <p>{manualDeliveryStatus}</p>
        <Button
          outline
          disabled={!manualDeliveryEnabled || pendingCount === 0 || manualDeliveryRunning}
          onClick={() => void runManualOutboxDeliveryOnce()}
        >
          Deliver one outbox entry
        </Button>
      </Block>

      <BlockTitle>
        Local outbox <Badge color={pendingCount > 0 ? 'orange' : 'green'}>{pendingCount}</Badge>
      </BlockTitle>
      <Block inset strong>
        <p>{status}</p>
      </Block>

      <BlockTitle>Local materialized events</BlockTitle>
      <List inset strong>
        {events.length === 0 ? (
          <ListItem title="No local events yet" subtitle="Create one above to test the vertical slice." />
        ) : (
          events.map((event) => (
            <ListItem key={event.eventId} title={event.title} subtitle={event.subtitle} after="local" />
          ))
        )}
      </List>
    </Page>
  );
}

function truncateMiddle(value: string, maxLength = 28): string {
  if (value.length <= maxLength) return value;
  const edge = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
}

function formatUiError(error: unknown): string {
  return formatPwaSyncStatusText(error, 'Unknown error');
}
