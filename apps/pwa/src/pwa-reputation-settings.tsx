/**
 * Phase 1.8.7 — PWA reputation settings UI surface.
 *
 * Three sub-sections:
 *  - Spam-gate threshold sliders (Phase 1.8.3 surface integration).
 *  - Observation / attestation emit forms (Phase 1.8.7 emit
 *    helpers); the user can record an observation or attestation
 *    against an actor / bridge / domain subject, with the device-
 *    local privacy ladder surfaced explicitly.
 *  - Aggregator subscription list (Phase 1.8.4 stacking runtime),
 *    with the doctrine non-negotiable "local is always priority 0"
 *    enforced both visibly and at the view-model layer.
 *
 * Like Phase 1.70: controlled-by-store. Every emit goes through the
 * Phase 1.8.7 helpers and persists via the Dexie reputation event
 * log. No optimistic UI state.
 */
import { useCallback, useMemo, useState } from 'react';
import { Block, BlockTitle, Button, List, ListItem } from 'framework7-react';
import {
  ATTESTATION_CONTEXT_TAGS,
  ATTESTATION_VALENCES,
  DEFAULT_SPAM_GATE_CONFIG,
  OBSERVATION_KINDS,
  REPUTATION_ALGORITHMS,
  type AttestationContextTag,
  type AttestationValence,
  type ObservationKind,
  type ReputationAlgorithm
} from '@lfp2p/trust-safety';
import type { createLocalFirstStore } from '@lfp2p/local-store';
import {
  buildAggregatorSubscriptionList,
  clampSpamGateInput,
  DEVICE_LOCAL_PRIVACY_NOTICE,
  type AggregatorSubscriptionInput
} from './pwa-reputation-state.js';
import { emitAttestationPublished, emitObservationRecorded } from './pwa-reputation-emit.js';
import {
  DEFAULT_REPUTATION_SYNC_POLICY,
  REPUTATION_SYNC_SCOPES,
  REPUTATION_USER_EMIT_KINDS,
  loadReputationSyncPolicy,
  saveReputationSyncPolicy,
  type ReputationSyncPolicy,
  type ReputationSyncScope,
  type ReputationUserEmitKind
} from './pwa-reputation-sync-policy.js';

type Store = ReturnType<typeof createLocalFirstStore>;

export type PwaReputationSettingsProps = Readonly<{ store: Store }>;

export function PwaReputationSettings({ store }: PwaReputationSettingsProps): JSX.Element {
  // ---- Phase 1.8.13 cross-device sync policy ---------------------------
  // Lazy initial state so SSR / Node test environments without
  // localStorage fall through to the documented default rather than
  // throwing at module load.
  const [syncPolicy, setSyncPolicy] = useState<ReputationSyncPolicy>(() =>
    loadReputationSyncPolicy()
  );
  const updateSyncScope = useCallback(
    (kind: ReputationUserEmitKind, next: ReputationSyncScope) => {
      const updated = saveReputationSyncPolicy({
        ...syncPolicy,
        [kind]: next
      });
      setSyncPolicy(updated);
    },
    [syncPolicy]
  );

  // ---- spam-gate thresholds --------------------------------------------
  const [spamThreshold, setSpamThreshold] = useState<number>(
    DEFAULT_SPAM_GATE_CONFIG.spamScoreThreshold
  );
  const [spamDistance, setSpamDistance] = useState<number>(
    DEFAULT_SPAM_GATE_CONFIG.spamSeedDistanceMax
  );
  const spamGate = useMemo(
    () =>
      clampSpamGateInput({
        spamScoreThreshold: spamThreshold,
        spamSeedDistanceMax: spamDistance
      }),
    [spamThreshold, spamDistance]
  );

  // ---- observation form -----------------------------------------------
  const [obsSubjectActor, setObsSubjectActor] = useState<string>('');
  const [obsKind, setObsKind] = useState<ObservationKind>('outbox.useful');
  const [obsSat, setObsSat] = useState<number>(1);
  const [obsUnsat, setObsUnsat] = useState<number>(0);
  const [obsWindowStart, setObsWindowStart] = useState<string>('');
  const [obsWindowEnd, setObsWindowEnd] = useState<string>('');
  const [obsStatus, setObsStatus] = useState<string>('');

  const handleEmitObservation = useCallback(async () => {
    try {
      await emitObservationRecorded({
        store,
        subject: { type: 'actor', actorId: obsSubjectActor },
        observationKind: obsKind,
        satCount: obsSat,
        unsatCount: obsUnsat,
        windowStart: obsWindowStart,
        windowEnd: obsWindowEnd
      });
      setObsStatus('Saved (device-local).');
    } catch (err) {
      setObsStatus(`Could not save: ${(err as Error).message}`);
    }
  }, [store, obsSubjectActor, obsKind, obsSat, obsUnsat, obsWindowStart, obsWindowEnd]);

  // ---- attestation form -----------------------------------------------
  const [attSubjectActor, setAttSubjectActor] = useState<string>('');
  const [attValence, setAttValence] = useState<AttestationValence>('positive');
  const [attContextTag, setAttContextTag] = useState<AttestationContextTag>(
    'contact.verified-in-person'
  );
  const [attStrength, setAttStrength] = useState<number>(0.8);
  const [attStatus, setAttStatus] = useState<string>('');

  const handleEmitAttestation = useCallback(async () => {
    try {
      await emitAttestationPublished({
        store,
        subject: { type: 'actor', actorId: attSubjectActor },
        valence: attValence,
        contextTag: attContextTag,
        strength: attStrength
      });
      setAttStatus('Saved (device-local).');
    } catch (err) {
      setAttStatus(`Could not save: ${(err as Error).message}`);
    }
  }, [store, attSubjectActor, attValence, attContextTag, attStrength]);

  // ---- aggregator subscriptions ---------------------------------------
  const [subs, setSubs] = useState<ReadonlyArray<AggregatorSubscriptionInput>>([]);
  const [subDraftLabelerId, setSubDraftLabelerId] = useState<string>('');
  const [subDraftPriority, setSubDraftPriority] = useState<number>(1);
  const [subDraftAlgo, setSubDraftAlgo] = useState<ReputationAlgorithm>('openrank.v1');
  const computedSubs = useMemo(() => buildAggregatorSubscriptionList(subs), [subs]);

  const handleAddSub = useCallback(() => {
    setSubs((prev) => [
      ...prev,
      Object.freeze({
        labelerId: subDraftLabelerId,
        priority: subDraftPriority,
        algorithm: subDraftAlgo
      })
    ]);
    setSubDraftLabelerId('');
  }, [subDraftLabelerId, subDraftPriority, subDraftAlgo]);

  const handleRemoveSub = useCallback((labelerId: string) => {
    setSubs((prev) => prev.filter((s) => s.labelerId !== labelerId));
  }, []);

  return (
    <>
      <BlockTitle>Cross-device sync policy (Phase 1.8.13)</BlockTitle>
      <Block strong>
        <p>
          <strong>Default:</strong> every reputation event stays on this device. You can elevate
          specific kinds to
          <em> account-local</em> so they sync across your own devices. The <em>account-local</em>{' '}
          flow itself ships when the Phase 5.0 private payload envelope lands — until then, every
          kind is treated as <em>device-local</em> regardless of what you choose here.
        </p>
        {REPUTATION_USER_EMIT_KINDS.map((kind) => (
          <p key={kind}>
            <strong>{kind}:</strong>{' '}
            <select
              value={syncPolicy[kind]}
              onChange={(e) => updateSyncScope(kind, e.target.value as ReputationSyncScope)}
            >
              {REPUTATION_SYNC_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope}
                </option>
              ))}
            </select>{' '}
            (default {DEFAULT_REPUTATION_SYNC_POLICY[kind]})
          </p>
        ))}
      </Block>

      <BlockTitle>Spam-gate thresholds (Phase 1.8.3)</BlockTitle>
      <Block>
        <p>
          Score threshold:{' '}
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={spamThreshold}
            onChange={(e) => setSpamThreshold(Number(e.target.value))}
          />
          (default {DEFAULT_SPAM_GATE_CONFIG.spamScoreThreshold})
        </p>
        <p>
          Seed-distance max:{' '}
          <input
            type="number"
            min={0}
            max={10}
            step={1}
            value={spamDistance}
            onChange={(e) => setSpamDistance(Number(e.target.value))}
          />
          (default {DEFAULT_SPAM_GATE_CONFIG.spamSeedDistanceMax})
        </p>
        <p>
          Effective: threshold = {spamGate.config.spamScoreThreshold}, distance ={' '}
          {spamGate.config.spamSeedDistanceMax}
        </p>
        {spamGate.warnings.length > 0 && (
          <ul>
            {spamGate.warnings.map((w, i) => (
              <li key={`w-${i}`}>{w}</li>
            ))}
          </ul>
        )}
      </Block>

      <BlockTitle>Record an observation (Phase 1.8.1)</BlockTitle>
      <Block strong>
        <p>
          <strong>{DEVICE_LOCAL_PRIVACY_NOTICE.title}.</strong> {DEVICE_LOCAL_PRIVACY_NOTICE.body}
        </p>
        <p>
          Subject actor id:{' '}
          <input
            type="text"
            value={obsSubjectActor}
            onChange={(e) => setObsSubjectActor(e.target.value)}
          />
        </p>
        <p>
          Kind:{' '}
          <select value={obsKind} onChange={(e) => setObsKind(e.target.value as ObservationKind)}>
            {OBSERVATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </p>
        <p>
          Sat count:{' '}
          <input
            type="number"
            min={0}
            value={obsSat}
            onChange={(e) => setObsSat(Number(e.target.value))}
          />{' '}
          Unsat count:{' '}
          <input
            type="number"
            min={0}
            value={obsUnsat}
            onChange={(e) => setObsUnsat(Number(e.target.value))}
          />
        </p>
        <p>
          Window start (ISO):{' '}
          <input
            type="text"
            value={obsWindowStart}
            onChange={(e) => setObsWindowStart(e.target.value)}
          />
        </p>
        <p>
          Window end (ISO):{' '}
          <input
            type="text"
            value={obsWindowEnd}
            onChange={(e) => setObsWindowEnd(e.target.value)}
          />
        </p>
        <Button onClick={handleEmitObservation}>Save observation</Button>
        {obsStatus && <p>{obsStatus}</p>}
      </Block>

      <BlockTitle>Publish an attestation (Phase 1.8.1)</BlockTitle>
      <Block strong>
        <p>
          <strong>{DEVICE_LOCAL_PRIVACY_NOTICE.title}.</strong> {DEVICE_LOCAL_PRIVACY_NOTICE.body}
        </p>
        <p>
          Subject actor id:{' '}
          <input
            type="text"
            value={attSubjectActor}
            onChange={(e) => setAttSubjectActor(e.target.value)}
          />
        </p>
        <p>
          Valence:{' '}
          <select
            value={attValence}
            onChange={(e) => setAttValence(e.target.value as AttestationValence)}
          >
            {ATTESTATION_VALENCES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </p>
        <p>
          Context tag:{' '}
          <select
            value={attContextTag}
            onChange={(e) => setAttContextTag(e.target.value as AttestationContextTag)}
          >
            {ATTESTATION_CONTEXT_TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </p>
        <p>
          Strength (0–1):{' '}
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={attStrength}
            onChange={(e) => setAttStrength(Number(e.target.value))}
          />
        </p>
        <Button onClick={handleEmitAttestation}>Save attestation</Button>
        {attStatus && <p>{attStatus}</p>}
      </Block>

      <BlockTitle>Aggregator subscriptions (Phase 1.8.4)</BlockTitle>
      <Block strong>
        <p>
          The local computer is always priority 0 — external aggregators stack below at the priority
          you choose. Lower numbers win higher rank.
        </p>
        <p>
          Labeler id:{' '}
          <input
            type="text"
            value={subDraftLabelerId}
            onChange={(e) => setSubDraftLabelerId(e.target.value)}
          />{' '}
          Priority:{' '}
          <input
            type="number"
            min={1}
            value={subDraftPriority}
            onChange={(e) => setSubDraftPriority(Number(e.target.value))}
          />{' '}
          Algorithm:{' '}
          <select
            value={subDraftAlgo}
            onChange={(e) => setSubDraftAlgo(e.target.value as ReputationAlgorithm)}
          >
            {REPUTATION_ALGORITHMS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button onClick={handleAddSub}>Add</Button>
        </p>
        {computedSubs.warnings.length > 0 && (
          <ul>
            {computedSubs.warnings.map((w, i) => (
              <li key={`sw-${i}`}>{w}</li>
            ))}
          </ul>
        )}
        <List>
          {computedSubs.list.map((s) => (
            <ListItem
              key={s.labelerId}
              title={`${s.labelerId} (priority ${s.priority}, ${s.algorithm})`}
            >
              <Button slot="after" onClick={() => handleRemoveSub(s.labelerId)}>
                Unsubscribe
              </Button>
            </ListItem>
          ))}
        </List>
      </Block>
    </>
  );
}
