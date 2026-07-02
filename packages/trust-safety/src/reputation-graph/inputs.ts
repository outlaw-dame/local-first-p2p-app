/**
 * Phase 1.8.2 — input record types + canonical subject key.
 *
 * The computer (`./computer.ts`) operates on plain record arrays —
 * NOT on `SignedEventEnvelope` objects directly. The caller
 * (PWA emit / sync-client / bridge wiring at later phases) is
 * responsible for unwrapping envelopes into these records. Keeping
 * the computer envelope-agnostic lets us replay deterministically
 * from any source of validated inputs (Phase 3.2 pure-projection
 * discipline) and keeps the computer free of crypto dependencies.
 *
 * `subjectRefToKey` is the canonical-id producer for any
 * `SafetySubjectRef`. The computer keys EVERY internal map on the
 * canonical string — never on the ref object — so JS Map identity
 * cannot interact with reference identity to break replay
 * equivalence.
 */

import type { BlockRef } from '@lfp2p/content-addressing';
import type { SafetySubjectRef } from '../subjects.js';
import type { AttestationContextTag, AttestationValence, ObservationKind } from './constants.js';

/**
 * Stable string identity for a subject in the reputation graph.
 * Format is `<type>:<id>`. The type prefix exists so an `actor:alice`
 * cannot collide with a `domain:alice` even though both happen to
 * contain the substring `alice`.
 */
export type SubjectKey = string;

/**
 * Stable string identity for an observer (the signing author of a
 * reputation event). Today every observer is an actor; the type is
 * a separate alias from `SubjectKey` so a future protocol change
 * that allowed e.g. a community to act as observer would not
 * silently break the typing on observers vs subjects.
 */
export type ObserverKey = string;

/**
 * Input record for the computer. Each `ObservationRecord` represents
 * one already-validated `reputation.observation.recorded` event with
 * its signing-author identity bundled in.
 */
export type ObservationRecord = Readonly<{
  observer: ObserverKey;
  subject: SubjectKey;
  observationKind: ObservationKind;
  /** Non-negative safe integer, doctrine-bounded. */
  satCount: number;
  /** Non-negative safe integer, doctrine-bounded. */
  unsatCount: number;
  /** ISO-8601 timestamp, inclusive. */
  windowStart: string;
  /** ISO-8601 timestamp, inclusive. */
  windowEnd: string;
  /** Wallclock the event was authored at. */
  createdAt: string;
}>;

/**
 * One already-validated `reputation.attestation.published` event with
 * its observer.
 */
export type AttestationRecord = Readonly<{
  observer: ObserverKey;
  /**
   * Event id of the underlying signed attestation. Required so a
   * later `RevocationRecord` referencing this `attestationId` can be
   * matched and the attestation's contribution removed.
   */
  attestationId: string;
  subject: SubjectKey;
  valence: AttestationValence;
  contextTag: AttestationContextTag;
  /** Bounded `[0, 1]`. */
  strength: number;
  createdAt: string;
  expiresAt?: string;
}>;

/**
 * One already-validated `reputation.attestation.revoked` event. The
 * computer applies a revocation by removing the matching
 * `AttestationRecord` BY EVENT ID from the input set BEFORE the
 * trust matrix is built.
 *
 * The observer field is preserved for audit (`isAuthorized`-style
 * checks happen at the envelope layer, not here — by the time an
 * `AttestationRecord` is in the input set its `observer` has already
 * been authenticated).
 */
export type RevocationRecord = Readonly<{
  observer: ObserverKey;
  attestationId: string;
  revokedAt: string;
}>;

/**
 * Phase 2.3 contact reference promoted into the reputation seed
 * vector. `strength` is the documented band assignment from the
 * doctrine:
 *
 *   - 1.0 — fingerprint-verified in-person
 *   - 0.5 — petname-set / long-term-correspondence
 *   - 0.1 — observed-only
 *
 * `attestedAt` is the moment the user attested this contact (NOT the
 * moment of the original meeting). Time-decay uses this to age the
 * seed strength gradually over time so a years-old verification is
 * weaker than a recent one.
 */
export type SeedContact = Readonly<{
  subject: SubjectKey;
  strength: number;
  attestedAt: string;
}>;

/**
 * Top-level input to the reputation computer. Frozen by convention
 * before being passed in; the computer additionally freezes its
 * own output deeply per Phase 3.2.
 */
export type ReputationGraphInputs = Readonly<{
  observations: ReadonlyArray<ObservationRecord>;
  attestations: ReadonlyArray<AttestationRecord>;
  revocations: ReadonlyArray<RevocationRecord>;
  seedContacts: ReadonlyArray<SeedContact>;
  /**
   * Caller-supplied wallclock — used as the reference point for
   * time-decay and observation-window filters. If omitted the
   * computer derives it from `max(createdAt)` across inputs so the
   * function remains pure on its arguments.
   */
  nowIso?: string;
}>;

/* -------------------------------------------------------------------------- */
/*                          canonical subject key                              */
/* -------------------------------------------------------------------------- */

/**
 * Map a `SafetySubjectRef` to a stable canonical string. Used to key
 * every internal data structure in the computer.
 *
 * Two distinct subjects MUST produce two distinct strings (no
 * collisions across subject types) and the same subject MUST always
 * produce the same string (no nondeterminism).
 */
export function subjectRefToKey(ref: SafetySubjectRef): SubjectKey {
  switch (ref.type) {
    case 'event':
      return `event:${ref.eventId}`;
    case 'actor':
      return `actor:${ref.actorId}`;
    case 'device':
      // Two devices owned by the same actor are NOT the same
      // reputation subject — we key on deviceId, not actorId.
      return `device:${ref.deviceId}`;
    case 'community':
      return `community:${ref.communityId}`;
    case 'thread':
      return `thread:${ref.threadId}`;
    case 'media':
      return `media:${ref.mediaId}`;
    case 'blob':
      return `blob:${blockRefToKey(ref.blockRef)}`;
    case 'url':
      return `url:${ref.normalizedUrl}`;
    case 'domain':
      return `domain:${ref.domain}`;
    case 'topic':
      return `topic:${ref.value}`;
    case 'bridge':
      return `bridge:${ref.bridgeId}`;
    case 'relay':
      return `relay:${ref.relayId}`;
    case 'super-peer':
      return `super-peer:${ref.superPeerId}`;
    case 'policy-list':
      return `policy-list:${ref.policyListId}`;
  }
}

function blockRefToKey(ref: BlockRef): string {
  // BlockRef.source is a discriminated union of `digest` and
  // `content-link`. Encode the discriminator so a digest-sourced
  // blob can never collide with a content-link-sourced one even if
  // their bytes match coincidentally.
  if (ref.source.kind === 'digest') {
    return `digest:${ref.source.digest.algorithm}:${ref.source.digest.digest}`;
  }
  // content-link variant — the ContentLink carries the CID.
  return `cid:${ref.source.link.cid}`;
}
