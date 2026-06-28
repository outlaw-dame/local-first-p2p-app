import type { CapabilityDecision, CapabilityProofRef, ProofRegistry } from '@lfp2p/capabilities';
import type { DexieLocalFirstStore } from '@lfp2p/local-store';
import { evaluateTrustSafetyCap } from '@lfp2p/trust-safety';
import {
  emitContactCardPublishedEvent,
  type EmitContactCardPublishedInput
} from './pwa-identity-emit.js';
import type { StoredIdentityControlProjection } from '@lfp2p/local-store';

/**
 * The capability scope string a controller-issued identity-control-log
 * proof must declare to authorize `identity.contact-card.publish` for
 * this device. A grant for any other scope (e.g. `outbox.send`) will NOT
 * unlock contact-card publication — the scope-binding filter enforces this.
 */
const CONTACT_CARD_PUBLISH_SCOPE = 'identity.contact-card.publish';

export type ContactCardPublishCapabilityGate = Readonly<{
  /**
   * The id of the device running this PWA, used to look up the device's
   * identity-control-log proofs in the registry.
   */
  localDeviceId: string;
  /**
   * ISO timestamp for the reliance gate's `now` field.
   * Defaults to `new Date().toISOString()` when omitted.
   */
  now?: string;
}>;

export type GatedEmitContactCardInput = EmitContactCardPublishedInput &
  Readonly<{
    /**
     * Proof-registry-backed authorization gate. When supplied, the gate
     * consults the trust-safety cap-adapter before emitting. Omitting this
     * field skips the gate entirely (back-compat for existing callers).
     */
    capabilityGate?: ContactCardPublishCapabilityGate;
  }>;

export type GatedEmitContactCardResult =
  | Readonly<{
      status: 'emitted';
      projection: StoredIdentityControlProjection;
    }>
  | Readonly<{
      status: 'blocked';
      reason: 'capability-proof-denied';
      message: string;
    }>;

/**
 * Gate `emitContactCardPublishedEvent` behind the proof-registry
 * cap-adapter. When `capabilityGate` is supplied the device's
 * identity-control-log proofs are folded through
 * `evaluateTrustSafetyCap` with action `identity.contact-card.publish`.
 * Omitting `capabilityGate` delegates directly to
 * `emitContactCardPublishedEvent` with no gate (back-compat).
 */
export async function gatedEmitContactCardPublished(
  input: GatedEmitContactCardInput
): Promise<GatedEmitContactCardResult> {
  if (input.capabilityGate !== undefined) {
    const now =
      input.capabilityGate.now ?? new Date().toISOString();
    const gateDecision = await evaluateContactCardPublishGate({
      store: input.store,
      identityId: input.identityId,
      localDeviceId: input.capabilityGate.localDeviceId,
      now
    });
    if (gateDecision.status === 'deny') {
      return {
        status: 'blocked',
        reason: 'capability-proof-denied',
        message: `contact-card publish blocked: ${gateDecision.message}`
      };
    }
  }

  const projection = await emitContactCardPublishedEvent(input);
  return { status: 'emitted', projection };
}

async function evaluateContactCardPublishGate(input: {
  store: DexieLocalFirstStore;
  identityId: string;
  localDeviceId: string;
  now: string;
}): Promise<{ status: 'allow' } | { status: 'deny'; message: string }> {
  let registry: ProofRegistry;
  try {
    registry = await input.store.loadProofRegistry();
  } catch (err) {
    return {
      status: 'deny',
      message: `proof registry load failed (${err instanceof Error ? err.message : 'unknown'})`
    };
  }
  if (
    registry === null ||
    typeof registry !== 'object' ||
    !(registry.proofs instanceof Map)
  ) {
    return {
      status: 'deny',
      message: 'proof registry load returned an invalid shape — fail closed'
    };
  }

  const nowMs = Date.parse(input.now);
  const candidateRecords: { proofId: string; expired: boolean }[] = [];
  for (const record of registry.proofs.values()) {
    if (record.scheme !== 'identity-control-log') continue;
    if (record.subject.kind !== 'device') continue;
    if (record.subject.id !== input.localDeviceId) continue;
    const expMs = Date.parse(record.expiresAt);
    const isExpired =
      Number.isFinite(expMs) && Number.isFinite(nowMs) && nowMs >= expMs;
    candidateRecords.push({ proofId: record.proofId, expired: isExpired });
  }

  if (candidateRecords.length === 0) {
    return {
      status: 'deny',
      message:
        'no identity-control-log proof registered for this device — the controller must grant contact-card publish authority before this device can publish'
    };
  }

  const refs: CapabilityProofRef[] = [];
  let anyExpired = false;
  let anyScopeMismatch = false;

  const unexpiredCandidates = candidateRecords.filter(c => {
    if (c.expired) { anyExpired = true; return false; }
    return true;
  });

  const fetchedEvents = await Promise.all(
    unexpiredCandidates.map(async ({ proofId }) => {
      try {
        return { proofId, event: await input.store.getSignedEvent(proofId) };
      } catch {
        return { proofId, event: undefined };
      }
    })
  );

  for (const { proofId, event } of fetchedEvents) {
    if (event === undefined) continue;
    // Scope the grant to this identity's controller. The registry is store-wide;
    // a grant issued by another identity's controller for the same device must not
    // authorize publication for this identity. (Codex review #104 P1)
    if (event.author !== input.identityId) continue;
    const payload = event.payload as Record<string, unknown> | undefined;
    if (payload === undefined || payload === null) continue;
    if (typeof payload.scope !== 'string' || payload.scope !== CONTACT_CARD_PUBLISH_SCOPE) {
      anyScopeMismatch = true;
      continue;
    }
    refs.push({ proofId, scheme: 'identity-control-log' });
  }

  if (refs.length === 0) {
    if (anyExpired) {
      return {
        status: 'deny',
        message: `all matching identity-control-log proofs have expired — controller must re-grant ${CONTACT_CARD_PUBLISH_SCOPE} authority`
      };
    }
    if (anyScopeMismatch) {
      return {
        status: 'deny',
        message: `no identity-control-log proof with scope ${CONTACT_CARD_PUBLISH_SCOPE} registered for this device — the controller granted other capabilities but not contact-card publish`
      };
    }
    return {
      status: 'deny',
      message: `no resolvable identity-control-log proof for this device with scope ${CONTACT_CARD_PUBLISH_SCOPE} — fail closed`
    };
  }

  const allow: CapabilityDecision = Object.freeze({
    status: 'allow',
    reasonCodes: Object.freeze(['capability.valid'] as const),
    capabilityId: `identity.contact-card.publish:${input.localDeviceId}`,
    invocationId: `contact-card-publish:${input.now}`,
    createdAt: input.now
  });

  const verdict = evaluateTrustSafetyCap({
    capabilityDecision: allow,
    capabilityAction: 'identity.contact-card.publish',
    now: input.now,
    proofRegistry: registry,
    capabilityProofs: refs
  });
  if (verdict.status === 'allow') return { status: 'allow' };
  return {
    status: 'deny',
    message: `proof gate denied (${verdict.reasonCodes.join(', ')})`
  };
}
