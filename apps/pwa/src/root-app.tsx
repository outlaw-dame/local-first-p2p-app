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
  authorizeIdentityOperation,
  buildIdentityTrustSnapshot,
  DeviceIdentityManager,
  type IdentityOperationAuthorization,
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
import {
  compareIdentityCode,
  createContactCardDocument,
  createImportedContactProfileInput,
  parseContactCardDocument,
  signContactCardDocument,
  serializeContactCardDocument
} from './pwa-contact-card.js';
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
import { IdentityAudit } from './pwa-identity-audit.js';
import { TrustSafetySettings } from './pwa-trust-safety-settings.js';
import { emitContactCardPublishedEvent } from './pwa-identity-emit.js';

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
  knownContacts: StoredContactProfile[];
  trustSnapshot: IdentityTrustSnapshot;
  syncAuthorization: IdentityOperationAuthorization;
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
  const [knownContacts, setKnownContacts] = useState<StoredContactProfile[]>([]);
  const [trustSnapshot, setTrustSnapshot] = useState<IdentityTrustSnapshot | null>(null);
  const [syncAuthorization, setSyncAuthorization] = useState<IdentityOperationAuthorization | null>(null);
  const [petnameDraft, setPetnameDraft] = useState('');
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [avatarUrlDraft, setAvatarUrlDraft] = useState('');
  const [websiteUrlDraft, setWebsiteUrlDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [compareDraft, setCompareDraft] = useState('');
  const [compareStatus, setCompareStatus] = useState('Paste a fingerprint or controller key to compare.');
  const [importDraft, setImportDraft] = useState('');
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
    const knownContacts = await store.listContactProfiles();
    const syncAuthorization = authorizeIdentityOperation({
      projection,
      deviceId: session.identity.deviceId,
      scope: 'sync:outbox',
      verificationStatus: trust.verificationStatus
    });

    return {
      identity: session.identity,
      keypair: session.keypair,
      contactProfile,
      knownContacts,
      trustSnapshot: trust,
      syncAuthorization,
      events: eventSummaries,
      pendingOutboxCount: outbox.length
    };
  }, [identityManager, store]);

  const applyLocalStateSnapshot = useCallback((snapshot: LocalRefreshSnapshot, readyStatus: string): void => {
    setIdentity(snapshot.identity);
    setKeypair(snapshot.keypair);
    setContactProfile(snapshot.contactProfile);
    setKnownContacts(snapshot.knownContacts);
    setTrustSnapshot(snapshot.trustSnapshot);
    setSyncAuthorization(snapshot.syncAuthorization);
    setPetnameDraft(snapshot.contactProfile.petname ?? '');
    setDisplayNameDraft(snapshot.contactProfile.displayName ?? '');
    setAvatarUrlDraft(snapshot.contactProfile.avatarUrl ?? '');
    setWebsiteUrlDraft(snapshot.contactProfile.websiteUrl ?? '');
    setNoteDraft(snapshot.contactProfile.note ?? '');
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
        const beforeDelivery = await loadLocalState();
        const delivery = await runManualOutboxDelivery({
          store,
          batchSize: 1,
          authorization: beforeDelivery.syncAuthorization
        });
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

  async function saveContactProfile(): Promise<void> {
    if (identity === null || contactProfile === null) {
      setStatus('Identity profile is not ready yet.');
      return;
    }
    try {
      await store.putContactProfile({
        identityId: identity.identityId,
        petname: petnameDraft,
        displayName: displayNameDraft,
        avatarUrl: avatarUrlDraft,
        websiteUrl: websiteUrlDraft,
        note: noteDraft,
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
      applyLocalStateSnapshot(await loadLocalState(), 'Contact profile updated locally.');
    } catch (error: unknown) {
      setStatus(`Contact profile update failed: ${formatUiError(error)}`);
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

  async function exportContactCard(): Promise<void> {
    if (identity === null || keypair === null || contactProfile === null || trustSnapshot === null) {
      setStatus('Identity contact card is not ready yet.');
      return;
    }
    try {
      const card = await createContactCardDocument({
        identityId: identity.identityId,
        profile: contactProfile,
        trustSnapshot
      });
      const signed = signContactCardDocument(card, keypair);
      const serialized = serializeContactCardDocument(signed);
      setImportDraft(serialized);
      // Phase 2.2: record the publication in the identity-control
      // log so a downstream verifier (and the user's other devices,
      // once account-local sync ships) can audit when this digest
      // was published. We never put the card *bytes* on the log,
      // only the canonical digest reference.
      try {
        await emitContactCardPublishedEvent({
          store,
          identityId: identity.identityId,
          deviceId: identity.deviceId,
          controllerKeypair: keypair,
          serializedContactCard: serialized
        });
      } catch (publishError: unknown) {
        // Publication audit failure must not block the export UX.
        // The card is still exported; the user gets a status hint.
        setStatus(
          `Contact card exported, but the publication-audit event failed: ${formatUiError(publishError)}`
        );
      }
      if (typeof globalThis.navigator?.clipboard?.writeText === 'function') {
        await globalThis.navigator.clipboard.writeText(serialized);
        setStatus('Signed contact card copied to clipboard as JSON.');
      } else {
        setStatus('Signed contact card generated in the import/export field because clipboard is unavailable.');
      }
    } catch (error: unknown) {
      setStatus(`Contact card export failed: ${formatUiError(error)}`);
    }
  }

  async function importContactCard(): Promise<void> {
    try {
      const card = parseContactCardDocument(importDraft);
      const existing = await store.getContactProfile(card.identityId);
      const nextProfile = await createImportedContactProfileInput({
        card,
        ...(existing === undefined ? {} : { existingProfile: existing }),
        ...(existing?.controllerPublicKey === undefined ? {} : { trustedControllerPublicKey: existing.controllerPublicKey })
      });
      await store.putContactProfile(nextProfile);
      applyLocalStateSnapshot(await loadLocalState(), `Imported contact card for ${card.identityId}.`);
    } catch (error: unknown) {
      setStatus(`Contact card import failed: ${formatUiError(error)}`);
    }
  }

  async function runIdentityCompare(): Promise<void> {
    try {
      const result = await compareIdentityCode({
        ...(trustSnapshot?.shortFingerprint === undefined ? {} : { expectedFingerprint: trustSnapshot.shortFingerprint }),
        ...(trustSnapshot?.controllerPublicKey === undefined ? {} : { controllerPublicKey: trustSnapshot.controllerPublicKey }),
        candidate: compareDraft
      });
      setCompareStatus(
        result.matches
          ? 'Identity comparison matched the current trusted controller fingerprint.'
          : 'Identity comparison did not match the current trusted controller fingerprint.'
      );
      if (!result.matches) {
        setStatus('Identity comparison mismatch detected. Treat this identity as untrusted until re-verified.');
      }
    } catch (error: unknown) {
      setCompareStatus(`Identity comparison failed: ${formatUiError(error)}`);
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
    if (syncAuthorization?.authorized === false) {
      setManualDeliveryStatus(`Manual outbox delivery blocked: ${syncAuthorization.reason}`);
      return;
    }
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
        <label className="lfp2p-label" htmlFor="display-name-input">
          Display name
        </label>
        <input
          id="display-name-input"
          className="lfp2p-input"
          value={displayNameDraft}
          maxLength={96}
          autoComplete="off"
          onChange={(event) => setDisplayNameDraft(event.target.value)}
          placeholder="Set a human-friendly display name"
        />
        <label className="lfp2p-label" htmlFor="avatar-url-input">
          Avatar URL
        </label>
        <input
          id="avatar-url-input"
          className="lfp2p-input"
          value={avatarUrlDraft}
          maxLength={512}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setAvatarUrlDraft(event.target.value)}
          placeholder="https://example.test/avatar.png"
        />
        <label className="lfp2p-label" htmlFor="website-url-input">
          Website URL
        </label>
        <input
          id="website-url-input"
          className="lfp2p-input"
          value={websiteUrlDraft}
          maxLength={512}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setWebsiteUrlDraft(event.target.value)}
          placeholder="https://example.test"
        />
        <label className="lfp2p-label" htmlFor="note-input">
          Note
        </label>
        <textarea
          id="note-input"
          className="lfp2p-textarea"
          value={noteDraft}
          maxLength={280}
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="Add local notes about this identity"
        />
        <Button outline disabled={identity === null} onClick={() => void saveContactProfile()}>
          Save contact card
        </Button>
        <p className="lfp2p-muted-detail">Current petname: {contactProfile?.petname ?? 'not set'}</p>
      </Block>

      <BlockTitle>Contact card exchange</BlockTitle>
      <Block inset strong>
        <p className="lfp2p-muted-detail">Export your local contact card or paste a contact card JSON document to import it locally.</p>
        <Button
          outline
          disabled={identity === null || keypair === null || contactProfile === null || trustSnapshot === null}
          onClick={() => void exportContactCard()}
        >
          Export contact card
        </Button>
        <label className="lfp2p-label" htmlFor="contact-card-json">
          Contact card JSON
        </label>
        <textarea
          id="contact-card-json"
          className="lfp2p-textarea"
          value={importDraft}
          onChange={(event) => setImportDraft(event.target.value)}
          placeholder="Paste an lfp2p.contact-card.v1 JSON document"
        />
        <Button outline disabled={importDraft.trim().length === 0} onClick={() => void importContactCard()}>
          Import contact card
        </Button>
      </Block>

      <BlockTitle>Fingerprint compare</BlockTitle>
      <Block inset strong>
        <p className="lfp2p-muted-detail">Paste the fingerprint or controller public key you received out-of-band to compare it with the local trusted value.</p>
        <input
          className="lfp2p-input"
          value={compareDraft}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setCompareDraft(event.target.value)}
          placeholder="Paste a fingerprint or controller key"
        />
        <Button outline disabled={compareDraft.trim().length === 0 || trustSnapshot?.shortFingerprint === undefined} onClick={() => void runIdentityCompare()}>
          Compare identity code
        </Button>
        <p className="lfp2p-muted-detail">{compareStatus}</p>
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
        <p className="lfp2p-muted-detail">Sync authorization: {syncAuthorization?.reason ?? 'loading identity authorization'}</p>
        <Button
          outline
          disabled={!manualDeliveryEnabled || pendingCount === 0 || manualDeliveryRunning || syncAuthorization?.authorized === false}
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

      <BlockTitle>Known contact cards</BlockTitle>
      <List inset strong>
        {knownContacts.length === 0 ? (
          <ListItem title="No contact cards yet" subtitle="Import one or edit your local contact card above." />
        ) : (
          knownContacts.map((profile) => (
            <ListItem
              key={profile.identityId}
              title={profile.petname ?? profile.displayName ?? truncateMiddle(profile.identityId)}
              subtitle={profile.identityId}
              after={profile.verificationStatus}
            />
          ))
        )}
      </List>

      {identity && keypair ? (
        <IdentityAudit
          store={store}
          identityId={identity.identityId}
          controllerKeypair={keypair}
          controllerDeviceId={identity.deviceId}
        />
      ) : null}

      {identity ? (
        <TrustSafetySettings store={store} subscriberActorId={identity.identityId} />
      ) : null}
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
    ...(existing?.websiteUrl === undefined ? {} : { websiteUrl: existing.websiteUrl }),
    ...(existing?.note === undefined ? {} : { note: existing.note }),
    primaryDeviceId: nextPrimaryDeviceId,
    ...(nextControllerPublicKey === undefined ? {} : { controllerPublicKey: nextControllerPublicKey }),
    ...(nextShortFingerprint === undefined ? {} : { shortFingerprint: nextShortFingerprint }),
    verificationStatus: nextVerificationStatus,
    updatedAt: new Date().toISOString()
  });
}
