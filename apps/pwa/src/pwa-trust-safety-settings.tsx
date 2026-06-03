/**
 * Phase 1.70 PWA T&S settings UI.
 *
 * Composite of four sub-sections rendered into the home page:
 *  - Adult-content master gate (Phase 1.69)
 *  - Standard content-category preferences (Phase 1.69)
 *  - Keyword filters with the 4 ReDoS-safe match kinds (Phase 1.70.A)
 *  - Labeler subscriptions surface with the redundancy warning (Phase 1.69)
 *
 * The component is intentionally "controlled-by-store": every action
 * appends an event via `DexieLocalFirstStore`, then reloads the
 * projection. No optimistic UI state, no derived caches — the
 * projection is the source of truth.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Block, BlockTitle, Button, List, ListItem } from 'framework7-react';
import {
  type LabelPreferenceAction,
  type LabelersState,
  type LocalControlState,
  createEmptyLabelersState,
  createEmptyLocalControlState
} from '@lfp2p/trust-safety';
import { type createLocalFirstStore } from '@lfp2p/local-store';
import {
  KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI,
  type UiKeywordMatchKind,
  buildAdultContentGateEvent,
  buildContentCategoryPreferenceEvent,
  buildContentCategoryRows,
  buildKeywordFilterEvent,
  buildKeywordFilterRevertEvent,
  buildKeywordFilterRows,
  buildLabelerSubscriptionRows,
  buildLabelerUnsubscribeEvent,
  listExistingOverlaps
} from './pwa-trust-safety-state.js';

type Store = ReturnType<typeof createLocalFirstStore>;

export type TrustSafetySettingsProps = Readonly<{
  store: Store;
  subscriberActorId: string;
}>;

const CATEGORY_ACTION_CHOICES: ReadonlyArray<LabelPreferenceAction> = [
  'allow',
  'warn',
  'hide'
];

export function TrustSafetySettings({
  store,
  subscriberActorId
}: TrustSafetySettingsProps): JSX.Element {
  const [controlState, setControlState] = useState<LocalControlState>(() =>
    createEmptyLocalControlState()
  );
  const [labelersState, setLabelersState] = useState<LabelersState>(() =>
    createEmptyLabelersState()
  );
  const [keywordDraft, setKeywordDraft] = useState('');
  const [matchKindDraft, setMatchKindDraft] = useState<UiKeywordMatchKind>('hashtag');
  const [statusLine, setStatusLine] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [c, l] = await Promise.all([
        store.loadLocalControlState(),
        store.loadLabelersState()
      ]);
      setControlState(c);
      setLabelersState(l);
    } catch (err) {
      setStatusLine(`Failed to load trust & safety state: ${formatError(err)}`);
    }
  }, [store]);

  useEffect(() => {
    // The setState calls happen inside `refresh` AFTER an `await`, not
    // synchronously in the effect body. The rule below misfires here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const gateOn = controlState.adultContentGate?.enabled === true;

  const toggleGate = useCallback(async (): Promise<void> => {
    try {
      if (!gateOn) {
        // Explicit confirmation when turning the gate ON. We refuse to
        // enable adult content without an explicit user action — this
        // is the protocol-level child-safety / fresh-account default.
        const confirmed = globalThis.confirm(
          'Show adult content? You confirm you are 18 or older.'
        );
        if (!confirmed) return;
      }
      await store.appendTrustSafetyControlEvent(
        buildAdultContentGateEvent(!gateOn)
      );
      await refresh();
      setStatusLine(`Adult-content gate ${gateOn ? 'disabled' : 'enabled'}.`);
    } catch (err) {
      setStatusLine(`Failed to toggle gate: ${formatError(err)}`);
    }
  }, [gateOn, refresh, store]);

  const setCategoryPreference = useCallback(
    async (categoryKey: string, preference: LabelPreferenceAction): Promise<void> => {
      try {
        await store.appendTrustSafetyControlEvent(
          buildContentCategoryPreferenceEvent(categoryKey, preference)
        );
        await refresh();
      } catch (err) {
        setStatusLine(`Failed to set ${categoryKey} preference: ${formatError(err)}`);
      }
    },
    [refresh, store]
  );

  const addKeywordFilter = useCallback(async (): Promise<void> => {
    const trimmed = keywordDraft.trim();
    if (trimmed.length === 0) {
      setStatusLine('Keyword filter cannot be empty.');
      return;
    }
    try {
      await store.appendTrustSafetyControlEvent(
        buildKeywordFilterEvent({ keyword: trimmed, matchKind: matchKindDraft })
      );
      setKeywordDraft('');
      await refresh();
      setStatusLine(`Added ${matchKindDraft} filter for "${trimmed}".`);
    } catch (err) {
      setStatusLine(`Failed to add filter: ${formatError(err)}`);
    }
  }, [keywordDraft, matchKindDraft, refresh, store]);

  const removeKeywordFilter = useCallback(
    async (keyword: string, matchKind: string): Promise<void> => {
      try {
        // matchKind from the projection is constrained to the protocol
        // enum; narrow to the UI subset for the revert builder.
        const mk = matchKind as UiKeywordMatchKind;
        await store.appendTrustSafetyControlEvent(
          buildKeywordFilterRevertEvent({ keyword, matchKind: mk })
        );
        await refresh();
        setStatusLine(`Removed filter "${keyword}".`);
      } catch (err) {
        setStatusLine(`Failed to remove filter: ${formatError(err)}`);
      }
    },
    [refresh, store]
  );

  const categoryRows = useMemo(
    () => buildContentCategoryRows(controlState),
    [controlState]
  );
  const keywordRows = useMemo(
    () => buildKeywordFilterRows(controlState),
    [controlState]
  );
  const subscriptionRows = useMemo(
    () => buildLabelerSubscriptionRows(labelersState, subscriberActorId),
    [labelersState, subscriberActorId]
  );
  const overlaps = useMemo(
    () => listExistingOverlaps(labelersState, subscriberActorId),
    [labelersState, subscriberActorId]
  );

  const unsubscribe = useCallback(
    async (subscriptionId: string): Promise<void> => {
      try {
        await store.appendTrustSafetyLabelerEvent(
          buildLabelerUnsubscribeEvent(subscriptionId)
        );
        await refresh();
        setStatusLine(`Unsubscribed from ${subscriptionId}.`);
      } catch (err) {
        setStatusLine(`Failed to unsubscribe: ${formatError(err)}`);
      }
    },
    [refresh, store]
  );

  return (
    <>
      <BlockTitle>Trust &amp; Safety — Adult-content gate</BlockTitle>
      <Block inset strong>
        <p>
          When the gate is off, every adult content category is forced to{' '}
          <strong>hide</strong>, regardless of any per-category preference.
        </p>
        <Button outline onClick={() => void toggleGate()}>
          {gateOn ? 'Disable adult content' : 'Enable adult content'}
        </Button>
      </Block>

      <BlockTitle>Trust &amp; Safety — Content categories</BlockTitle>
      <List inset strong>
        {categoryRows.map((row) => (
          <ListItem
            key={row.category.key}
            title={row.category.key}
            subtitle={row.category.description}
            after={`effective: ${row.effectiveAction}`}
          >
            <div slot="footer" className="lfp2p-muted-detail">
              {row.lockedByGate ? (
                <em>Locked: enable the adult-content gate to override.</em>
              ) : (
                <span>
                  {CATEGORY_ACTION_CHOICES.map((choice) => (
                    <Button
                      key={choice}
                      small
                      outline={row.currentPreference !== choice}
                      fill={row.currentPreference === choice}
                      onClick={() =>
                        void setCategoryPreference(row.category.key, choice)
                      }
                    >
                      {choice}
                    </Button>
                  ))}
                </span>
              )}
            </div>
          </ListItem>
        ))}
      </List>

      <BlockTitle>Trust &amp; Safety — Keyword filters</BlockTitle>
      <Block inset strong>
        <label className="lfp2p-label" htmlFor="ts-keyword-input">
          Keyword
        </label>
        <input
          id="ts-keyword-input"
          className="lfp2p-input"
          value={keywordDraft}
          maxLength={256}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKeywordDraft(e.target.value)}
          placeholder="e.g. spoilers, #spoilers, or 'election fraud'"
        />
        <label className="lfp2p-label" htmlFor="ts-matchkind-select">
          Match kind
        </label>
        <select
          id="ts-matchkind-select"
          className="lfp2p-input"
          value={matchKindDraft}
          onChange={(e) => setMatchKindDraft(e.target.value as UiKeywordMatchKind)}
        >
          {KEYWORD_MATCH_KINDS_AVAILABLE_IN_UI.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <p className="lfp2p-muted-detail">
          Regex is intentionally not offered — patterns like <code>(?:a+)+$</code>{' '}
          can ReDoS the host. Use <code>phrase</code> for multi-word filtering or{' '}
          <code>hashtag</code> for tag tokens.
        </p>
        <Button outline onClick={() => void addKeywordFilter()}>
          Add filter
        </Button>
      </Block>
      <List inset strong>
        {keywordRows.length === 0 ? (
          <ListItem
            title="No keyword filters yet"
            subtitle="Add one above to mute matching posts."
          />
        ) : (
          keywordRows.map((row) => (
            <ListItem
              key={`${row.matchKind}::${row.keyword}`}
              title={row.keyword}
              subtitle={`match: ${row.matchKind}`}
            >
              <Button
                slot="after"
                small
                outline
                onClick={() => void removeKeywordFilter(row.keyword, row.matchKind)}
              >
                Remove
              </Button>
            </ListItem>
          ))
        )}
      </List>

      <BlockTitle>Trust &amp; Safety — Labeler subscriptions</BlockTitle>
      {overlaps.length > 0 ? (
        <Block inset strong>
          <p className="lfp2p-muted-detail">
            <strong>{overlaps.length}</strong> subscribed labeler{' '}
            {overlaps.length === 1 ? 'pair' : 'pairs'} overlap. Consider removing the
            redundant subscription.
          </p>
          <List>
            {overlaps.map((pair) => (
              <ListItem
                key={`${pair.labelerIdA}::${pair.labelerIdB}`}
                title={`${pair.labelerIdA} ↔ ${pair.labelerIdB}`}
                subtitle={`overlap: ${pair.level}; capabilities: ${pair.overlappingCapabilityIds.join(', ') || '(none)'}; labels: ${pair.overlappingLabelKeys.join(', ') || '(none)'}`}
              />
            ))}
          </List>
        </Block>
      ) : null}
      <List inset strong>
        {subscriptionRows.length === 0 ? (
          <ListItem
            title="No labeler subscriptions yet"
            subtitle="Labeler discovery / publish flow is shipped in a future slice."
          />
        ) : (
          subscriptionRows.map((row) => (
            <ListItem
              key={row.subscriptionId}
              title={row.labelerDisplayName}
              subtitle={`caps: ${row.capabilitySummary.join(', ') || '(none)'}; labels: ${row.supportedLabels.join(', ') || '(none)'}`}
            >
              <Button
                slot="after"
                small
                outline
                onClick={() => void unsubscribe(row.subscriptionId)}
              >
                Unsubscribe
              </Button>
            </ListItem>
          ))
        )}
      </List>

      {statusLine.length > 0 ? (
        <Block inset>
          <p className="lfp2p-muted-detail">{statusLine}</p>
        </Block>
      ) : null}
    </>
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
