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
import {
  buildIdentityTrustSnapshot,
  DeviceIdentityManager,
  type IdentityTrustSnapshot,
  type LocalDeviceIdentity
} from '@lfp2p/identity';
import {
  createLocalFirstStore,
  type EventSummaryView,
  type StoredContactProfile
} from '@lfp2p/local-store';
import { detectPlatformCapabilities } from '@lfp2p/platform';
import { createUnsignedEvent } from '@lfp2p/protocol';
import { createIdempotencyKey } from '@lfp2p/sync-client';
import { LocalFirstStatusCard } from '@lfp2p/ui';
import { formatPwaBridgeConfigStatus, resolvePwaBridgeConfig } from './pwa-bridge-config.js';
import { formatIdentityVerificationStatus, identityVerificationBadgeColor } from './pwa-identity-tools.js';
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
  contactProfile: StoredContactProfile;
  trustSnapshot: IdentityTrustSnapshot;
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
  const controlledDeliveryControllerRef = useRef<PwaForegroundSyncController | null>(null);
  const [identity, setIdentity] = useState<LocalDeviceIdentity | null>(null);
  const [keypair, setKeypair] = useState<SigningKeypair | null>(null);
  const [contactProfile, setContactProfile] = useState<StoredContactProfile | null>(null);
  const [trustSnapshot, setTrustSnapshot] = useState<IdentityTrustSnapshot | null>(null);
  const [petnameDraft, setPetnameDraft] = useState('');
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
    const session = await identityManager.getOrCreatePrimaryDeviceSession();
    const [eventSummaries, outbox, projection, existingProfile] = await Promise.all([
      store.listEventSummaries(),
      store.listPendingOutbox(),
      store.getIdentityControlProjection(session.identity.identityId),
      store.getContactProfile(session.identity.identityId)
    ]);
    const trust = await buildIdentityTrustSnapshot({
      projection,
      ...(existingProfile?.controllerPublicKey === undefined
        ? {}
        : { expectedControllerPublicKey: existingProfile.controllerPublicKey })
    });
    const contactProfile = await upsertSelfContactProfile({
      store,
      identity: session.identity,
      trust,
      existingProfile
    });

    return {
      identity: session.identity,
      keypair: session.keypair,
      contactProfile,
      trustSnapshot: trust,
      events: eventSummaries,
      pendingOutboxCount: outbox.length
    };
  }, [identityManager, store]);

  const applyLocalStateSnapshot = useCallback((snapshot: LocalRefreshSnapshot, readyStatus: string): void => {
    setIdentity(snapshot.identity);
    setKeypair(snapshot.keypair);
    setContactProfile(snapshot.contactProfile);
    setTrustSnapshot(snapshot.trustSnapshot);
    setPetnameDraft(snapshot.contactProfile.petname ?? '');
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

  useEffect(() => {
    let cancelled = false;
    const controller = createPwaForegroundSyncController({
      async run() {
        const delivery = await runManualOutboxDelivery({ store, batchSize: 1 });
        const snapshot = await loadLocalState();
        if (!cancelled) {
          setManualDeliveryStatus(delivery.message);
          applyLocalStateSnapshot(snapshot, 'Manual outbox delivery action completed.');
        }
        return {
          deliveryStatus: delivery.status,
          eventCount: snapshot.events.length,
          pendingOutboxCount: snapshot.pendingOutboxCount
        };
      }
    });
    controlledDeliveryControllerRef.current = controller;

    return () => {
      cancelled = true;
      if (controlledDeliveryControllerRef.current === controller) controlledDeliveryControllerRef.current = null;
    };
  }, [applyLocalStateSnapshot, loadLocalState, store]);

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

  async function savePetname(): Promise<void> {
    if (identity === null || contactProfile === null) {
      setStatus('Identity profile is not ready yet.');
      return;
    }
    try {
      await store.putContactProfile({
        identityId: identity.identityId,
        petname: petnameDraft,
        ...(contactProfile.displayName === undefined ? {} : { displayName: contactProfile.displayName }),
        ...(contactProfile.avatarUrl === undefined ? {} : { avatarUrl: contactProfile.avatarUrl }),
        ...(contactProfile.note === undefined ? {} : { note: contactProfile.note }),
        ...(contactProfile.primaryDeviceId === undefined ? {} : { primaryDeviceId: contactProfile.primaryDeviceId }),
        ...(contactProfile.controllerPublicKey === undefined
          ? {}
          : { controllerPublicKey: contactProfile.controllerPublicKey }),
        ...(contactProfile.shortFingerprint === undefined
          ? {}
          : { shortFingerprint: contactProfile.shortFingerprint }),
        verificationStatus: trustSnapshot?.verificationStatus ?? contactProfile.verificationStatus,
        updatedAt: new Date().toISOString()
      });
      applyLocalStateSnapshot(await loadLocalState(), 'Petname updated locally.');
    } catch (error: unknown) {
      setStatus(`Petname update failed: ${formatUiError(error)}`);
    }
  }

  async function copyFingerprint(): Promise<void> {
    if (trustSnapshot?.shortFingerprint === undefined) {
      setStatus('No trusted controller fingerprint is available yet.');
      return;
    }
    const payload = `${trustSnapshot.shortFingerprint} ${trustSnapshot.controllerPublicKey ?? ''}`.trim();
    if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') {
      setStatus('Clipboard API is unavailable in this runtime.');
      return;
    }
    try {
      await globalThis.navigator.clipboard.writeText(payload);
      setStatus('Identity fingerprint copied to clipboard.');
    } catch (error: unknown) {
      setStatus(`Fingerprint copy failed: ${formatUiError(error)}`);
    }
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
    if (manualDeliveryRunning) return;
    const controller = controlledDeliveryControllerRef.current;
    if (controller === null) {
      setManualDeliveryStatus('Manual outbox delivery controller is not ready yet.');
      return;
    }

    setManualDeliveryRunning(true);
    setManualDeliveryStatus('Manual outbox delivery running.');
    try {
      const result = await requestPwaForegroundSync(controller, 'manual');
      if (mountedRef.current) {
        if (result.status === 'failed') {
          setManualDeliveryStatus(`Manual outbox delivery failed: ${formatPwaSyncStatusText(result.error)}.`);
        } else if (result.status === 'skipped') {
          setManualDeliveryStatus(`Manual outbox delivery skipped: ${result.reason}.`);
        }
      }
    } catch (error: unknown) {
      if (mountedRef.current) setManualDeliveryStatus(`Manual outbox delivery failed: ${formatUiError(error)}.`);
    } finally {
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

      <BlockTitle>
        Identity trust cues{' '}
        <Badge color={identityVerificationBadgeColor(trustSnapshot?.verificationStatus ?? 'unknown')}>
          {trustSnapshot?.verificationStatus ?? 'unknown'}
        </Badge>
      </BlockTitle>
      <Block inset strong>
        <p>{formatIdentityVerificationStatus(trustSnapshot?.verificationStatus ?? 'unknown')}</p>
        <p className="lfp2p-muted-detail">Controller key: {trustSnapshot?.controllerPublicKey ? truncateMiddle(trustSnapshot.controllerPublicKey, 42) : 'not available yet'}</p>
        <p className="lfp2p-muted-detail">Fingerprint: {trustSnapshot?.shortFingerprint ?? 'not available yet'}</p>
        <Button outline disabled={trustSnapshot?.shortFingerprint === undefined} onClick={() => void copyFingerprint()}>
          Copy fingerprint
        </Button>
      </Block>

      <BlockTitle>Petname book (local)</BlockTitle>
      <Block inset strong>
        <label className="lfp2p-label" htmlFor="petname-input">
          Petname
        </label>
        <input
          id="petname-input"
          className="lfp2p-input"
          value={petnameDraft}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setPetnameDraft(event.target.value)}
          placeholder="Set a local nickname"
        />
        <Button outline disabled={identity === null} onClick={() => void savePetname()}>
          Save petname
        </Button>
        <p className="lfp2p-muted-detail">Current petname: {contactProfile?.petname ?? 'not set'}</p>
      </Block>

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

async function upsertSelfContactProfile(input: Readonly<{
  store: ReturnType<typeof createLocalFirstStore>;
  identity: LocalDeviceIdentity;
  trust: IdentityTrustSnapshot;
  existingProfile: StoredContactProfile | undefined;
}>): Promise<StoredContactProfile> {
  const existing = input.existingProfile;
  const nextVerificationStatus = input.trust.verificationStatus;
  const nextPrimaryDeviceId = input.trust.primaryDeviceId ?? existing?.primaryDeviceId ?? input.identity.deviceId;
  const nextControllerPublicKey = input.trust.controllerPublicKey ?? existing?.controllerPublicKey;
  const nextShortFingerprint = input.trust.shortFingerprint ?? existing?.shortFingerprint;

  const requiresUpdate =
    existing === undefined ||
    existing.verificationStatus !== nextVerificationStatus ||
    existing.primaryDeviceId !== nextPrimaryDeviceId ||
    existing.controllerPublicKey !== nextControllerPublicKey ||
    existing.shortFingerprint !== nextShortFingerprint;

  if (!requiresUpdate && existing !== undefined) return existing;

  return input.store.putContactProfile({
    identityId: input.identity.identityId,
    ...(existing?.petname === undefined ? {} : { petname: existing.petname }),
    ...(existing?.displayName === undefined ? {} : { displayName: existing.displayName }),
    ...(existing?.avatarUrl === undefined ? {} : { avatarUrl: existing.avatarUrl }),
    ...(existing?.note === undefined ? {} : { note: existing.note }),
    primaryDeviceId: nextPrimaryDeviceId,
    ...(nextControllerPublicKey === undefined ? {} : { controllerPublicKey: nextControllerPublicKey }),
    ...(nextShortFingerprint === undefined ? {} : { shortFingerprint: nextShortFingerprint }),
    verificationStatus: nextVerificationStatus,
    updatedAt: new Date().toISOString()
  });
}
