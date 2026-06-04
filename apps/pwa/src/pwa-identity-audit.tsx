/**
 * Phase 2.3b — Identity audit React surface.
 *
 * Renders the device list, capability list, and contact-card
 * publication audit from the projection snapshot. Provides a
 * rotation affordance per non-controller active device that
 * generates a fresh keypair, confirms with the user, and calls
 * `emitDeviceRotatedEvent`.
 *
 * Discipline:
 *  - The rotation flow never touches the in-memory signing
 *    keypair the PWA currently uses for outgoing events. That
 *    keypair is the controller; rotating a non-controller device
 *    only updates the projection and the on-disk audit trail.
 *  - The confirmation dialog displays both the OLD and the NEW
 *    fingerprint so the user has a record of what they
 *    authorized.
 *  - All decisions about whether to show a rotate button live in
 *    the view-model (`isRotatable`). The component does not
 *    second-guess.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Block, BlockTitle, Button, List, ListItem } from 'framework7-react';
import { generateSigningKeypair, type SigningKeypair } from '@lfp2p/crypto';
import { type createLocalFirstStore, type StoredIdentityControlProjection } from '@lfp2p/local-store';
import { emitDeviceRotatedEvent } from './pwa-identity-emit.js';
import {
  buildIdentityAuditViewModel,
  prepareRotationIntent,
  shortPublicKeyFingerprint
} from './pwa-identity-audit-state.js';

type Store = ReturnType<typeof createLocalFirstStore>;

export type IdentityAuditProps = Readonly<{
  store: Store;
  identityId: string;
  /**
   * The current controller keypair (held by the PWA). Required
   * because every authority-changing event MUST be signed by the
   * controller. Rotations of non-controller devices do NOT
   * replace this keypair.
   */
  controllerKeypair: SigningKeypair;
  /**
   * The deviceId the controller key represents (i.e. the
   * bootstrap device). Used as the `signingDeviceId` on every
   * emitted identity event.
   */
  controllerDeviceId: string;
}>;

export function IdentityAudit({
  store,
  identityId,
  controllerKeypair,
  controllerDeviceId
}: IdentityAuditProps): JSX.Element {
  const [projection, setProjection] = useState<StoredIdentityControlProjection | undefined>(
    undefined
  );
  const [statusLine, setStatusLine] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const p = await store.getIdentityControlProjection(identityId);
      setProjection(p);
    } catch (err) {
      setStatusLine(`Failed to load identity audit: ${formatError(err)}`);
    }
  }, [identityId, store]);

  useEffect(() => {
    // The setState calls happen inside `refresh` AFTER an `await`,
    // not synchronously in the effect body. The rule misfires here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const viewModel = useMemo(() => buildIdentityAuditViewModel(projection), [projection]);

  const onRotate = useCallback(
    async (deviceId: string): Promise<void> => {
      try {
        const newKeypair = generateSigningKeypair();
        const intent = prepareRotationIntent(viewModel, deviceId, newKeypair.publicKey);
        const oldFp = shortPublicKeyFingerprint(intent.previousPublicKey);
        const newFp = shortPublicKeyFingerprint(intent.newPublicKey);
        // Intentional consent prompt before emitting a Class C
        // identity-control event (key rotation). The message body
        // contains only short fingerprints + neutral language per
        // docs/protocol/privacy-safe-logging.md error-message hygiene.
        // eslint-disable-next-line no-alert
        const confirmed = globalThis.confirm(
          `Rotate the key for ${deviceId}?\n\n` +
            `Old fingerprint:  ${oldFp}\n` +
            `New fingerprint:  ${newFp}\n\n` +
            `This records a key rotation in your identity log. Contacts who verified the old fingerprint should re-verify the new one out of band.`
        );
        if (!confirmed) return;
        await emitDeviceRotatedEvent({
          store,
          identityId,
          deviceIdToRotate: intent.deviceId,
          previousPublicKey: intent.previousPublicKey,
          newPublicKey: intent.newPublicKey,
          epoch: intent.epoch,
          controllerKeypair,
          signingDeviceId: controllerDeviceId
        });
        await refresh();
        setStatusLine(`Rotation recorded. New fingerprint: ${newFp}.`);
      } catch (err) {
        setStatusLine(`Rotation failed: ${formatError(err)}`);
      }
    },
    [controllerDeviceId, controllerKeypair, identityId, refresh, store, viewModel]
  );

  return (
    <>
      <BlockTitle>Identity audit — devices</BlockTitle>
      <List inset strong>
        {viewModel.devices.length === 0 ? (
          <ListItem title="No devices yet" subtitle="The controller event has not been replayed yet." />
        ) : (
          viewModel.devices.map((row) => (
            <ListItem
              key={row.deviceId}
              title={row.deviceId}
              subtitle={`${row.isController ? 'controller / ' : ''}${row.status} • fingerprint ${shortPublicKeyFingerprint(row.publicKey)}`}
            >
              {row.isRotatable ? (
                <Button slot="after" small outline onClick={() => void onRotate(row.deviceId)}>
                  Rotate key
                </Button>
              ) : null}
              {row.isController ? (
                <div slot="footer" className="lfp2p-muted-detail">
                  <em>
                    Controller device. Rotating the controller key is a separate flow
                    (controller-key supersession; not yet shipped). Re-verify your
                    fingerprint with contacts out of band instead.
                  </em>
                </div>
              ) : null}
              {row.status === 'revoked' ? (
                <div slot="footer" className="lfp2p-muted-detail">
                  Revoked at {row.revokedAt ?? 'unknown'}.
                </div>
              ) : null}
            </ListItem>
          ))
        )}
      </List>

      <BlockTitle>Identity audit — capabilities</BlockTitle>
      <List inset strong>
        {viewModel.capabilities.length === 0 ? (
          <ListItem
            title="No capabilities issued"
            subtitle="Capability delegation (delegate-of-delegate) is a future slice."
          />
        ) : (
          viewModel.capabilities.map((row) => (
            <ListItem
              key={row.capabilityId}
              title={row.capabilityId}
              subtitle={`${row.status}${row.isActive ? '' : ' / inactive'} • scope ${row.scope} • delegate ${row.delegateDeviceId}${row.expiresAt === undefined ? '' : ` • expires ${row.expiresAt}`}`}
            />
          ))
        )}
      </List>

      <BlockTitle>Identity audit — contact-card publication</BlockTitle>
      <Block inset strong>
        {viewModel.contactCardPublication === undefined ? (
          <p className="lfp2p-muted-detail">
            No contact card has been published from this device yet. Use the
            "Export contact card" flow above to publish one.
          </p>
        ) : (
          <>
            <p>
              <strong>Digest:</strong> {viewModel.contactCardPublication.contactCardDigest}
            </p>
            <p className="lfp2p-muted-detail">
              Captured at {viewModel.contactCardPublication.capturedAt}; recorded at{' '}
              {viewModel.contactCardPublication.publishedAt}.
            </p>
          </>
        )}
      </Block>

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
