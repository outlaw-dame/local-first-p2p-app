/**
 * Phase 1.8.9 — PWA reputation view panel.
 *
 * Renders the per-subject reputation view produced by
 * `buildReputationView`. The user opens this panel to inspect their
 * computed state — score, band, confidence, seed distance per
 * subject they have observations or attestations for.
 *
 * Privacy-safe per Phase 3.1: the displayed band is the stable
 * string (`high` / `mid` / `low` / `untrusted`); the raw score is
 * shown alongside because this panel exists specifically for the
 * user to inspect their own state.
 */
import { useCallback, useEffect, useState } from 'react';
import { Block, BlockTitle, Button, List, ListItem } from 'framework7-react';
import type { createLocalFirstStore } from '@lfp2p/local-store';
import { buildReputationView, type ReputationView } from './pwa-reputation-view-model.js';

type Store = ReturnType<typeof createLocalFirstStore>;

export type PwaReputationViewProps = Readonly<{
  store: Store;
  /** The user's stable actor id (the observer / seed). */
  observerActorId: string;
}>;

export function PwaReputationView({ store, observerActorId }: PwaReputationViewProps): JSX.Element {
  const [view, setView] = useState<ReputationView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await buildReputationView({ store, observerActorId });
      setView(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [store, observerActorId]);

  useEffect(() => {
    // Defer the initial compute to the next microtask so we do not
    // call setState synchronously inside the effect's body —
    // matches the project's lint rule and avoids cascading renders.
    const handle = Promise.resolve().then(() => reload());
    return () => {
      // No real cancellation needed; the awaited reload's setState
      // calls are idempotent. The void here marks the promise as
      // intentionally not awaited.
      void handle;
    };
  }, [reload]);

  return (
    <>
      <BlockTitle>Computed reputation (Phase 1.8.9)</BlockTitle>
      <Block strong>
        <Button onClick={reload} disabled={loading}>
          {loading ? 'Computing…' : 'Refresh'}
        </Button>
        {error && <p style={{ color: 'crimson' }}>Could not compute reputation: {error}</p>}
        {view && (
          <div>
            <p>
              <strong>Events:</strong> loaded {view.totalEventsLoaded}, consumed{' '}
              {view.totalEventsConsumed} (observations + attestations + revocations).{' '}
              {view.truncated ? '⚠️ Graph truncated to maxNodes.' : null}{' '}
              {view.convergedWithinIterations
                ? '✓ Iteration converged.'
                : '⚠️ Iteration did NOT converge — confidence reduced.'}
            </p>
            {view.entries.length === 0 ? (
              <p>
                No subjects scored. Record observations or publish attestations to populate the
                graph.
              </p>
            ) : (
              <List>
                {view.entries.map((row) => (
                  <ListItem
                    key={row.subject}
                    title={row.subject}
                    after={`band: ${row.band}`}
                    footer={`score ${row.score.toFixed(4)} · confidence ${row.confidence.toFixed(2)} · seed-distance ${
                      row.seedDistance === Number.POSITIVE_INFINITY ? '∞' : String(row.seedDistance)
                    }`}
                  />
                ))}
              </List>
            )}
          </div>
        )}
      </Block>
    </>
  );
}
