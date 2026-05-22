import { useEffect, useMemo, useState } from 'react';
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
import { generateSigningKeypair, signEventEnvelope } from '@lfp2p/crypto';
import { createLocalFirstStore, type EventSummaryView } from '@lfp2p/local-store';
import { detectPlatformCapabilities } from '@lfp2p/platform';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { createIdempotencyKey } from '@lfp2p/sync-client';
import { LocalFirstStatusCard } from '@lfp2p/ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2
    }
  }
});

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
  const store = useMemo(() => createLocalFirstStore('lfp2p-pwa-v1'), []);
  const keypair = useMemo(() => generateSigningKeypair(), []);
  const [events, setEvents] = useState<EventSummaryView[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [status, setStatus] = useState('Ready for local-first writes.');

  useEffect(() => {
    async function refreshLocalState(): Promise<void> {
      setEvents(await store.listEventSummaries());
      setPendingCount((await store.listPendingOutbox()).length);
    }

    void refreshLocalState();
    return () => {
      void store.close();
    };
  }, [store]);

  async function createLocalEvent(): Promise<void> {
    const now = new Date().toISOString();
    const eventId = `evt_${globalThis.crypto.randomUUID()}`;
    const unsigned = createUnsignedEvent({
      eventId,
      kind: 'outbox.test.created',
      author: `identity:${keypair.publicKey}`,
      deviceId: `device:${keypair.publicKey.slice(0, 16)}`,
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
    setEvents(await store.listEventSummaries());
    setPendingCount((await store.listPendingOutbox()).length);
    setStatus('Local event created and queued without waiting for the network.');
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
          <Button fill large onClick={() => void createLocalEvent()}>
            Create signed local event
          </Button>
        </LocalFirstStatusCard>
      </Block>

      <BlockTitle>Runtime capability snapshot</BlockTitle>
      <List inset strong>
        <ListItem title="Runtime" after={capabilities.runtime} />
        <ListItem title="Platform" after={capabilities.platform} />
        <ListItem title="Web Push" after={capabilities.webPush ? 'available' : 'unavailable'} />
        <ListItem title="OPFS" after={capabilities.opfs ? 'available' : 'unavailable'} />
        <ListItem title="WebRTC" after={capabilities.webRtc ? 'available' : 'unavailable'} />
      </List>

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
