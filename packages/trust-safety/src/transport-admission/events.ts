import type { BlockRef } from '@lfp2p/content-addressing';
import { validateBlockRef } from '@lfp2p/content-addressing';
import type { SafetyAuthority } from '../authorities.js';
import { validateSafetyAuthority } from '../authorities.js';
import { tsError } from '../errors.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import { SAFETY_REASON_CODES } from '../reason-codes.js';
import type { TransportAdmissionDecision } from '../transport-admission.js';
import { validateTransportAdmissionDecision } from '../transport-admission.js';
import {
  assertExactVersion,
  assertId,
  assertIso8601,
  assertNotBefore,
  assertOneOf,
  assertPlainObject
} from '../validation.js';

export const TRANSPORT_EVENT_VERSION = 'lfp2p.transport-event.v1' as const;

/**
 * Transport-side admission events emitted by an infrastructure operator
 * (bridge / relay / super-peer). These are scoped to the operator's
 * surface — they are NOT global moderation. The doctrine: bridge-local
 * rejection is not global deletion.
 */
export const TRANSPORT_EVENT_KINDS = [
  'transport.event.accepted',
  'transport.event.rejected',
  'transport.event.quarantined',
  'transport.peer.rate_limited',
  'transport.peer.quarantined',
  'transport.media.rejected'
] as const;
export type TransportEventKind = (typeof TRANSPORT_EVENT_KINDS)[number];

type CommonFields = Readonly<{
  version: typeof TRANSPORT_EVENT_VERSION;
  eventId: string;
  createdAt: string;
}>;

export type TransportEvent =
  | Readonly<
      CommonFields & {
        kind: 'transport.event.accepted';
        decision: TransportAdmissionDecision;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'transport.event.rejected';
        decision: TransportAdmissionDecision;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'transport.event.quarantined';
        decision: TransportAdmissionDecision;
        quarantineExpiresAt?: string;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'transport.peer.rate_limited';
        peerId: string;
        operatorAuthority: SafetyAuthority;
        reasonCode: SafetyReasonCode;
        retryAfter: string;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'transport.peer.quarantined';
        peerId: string;
        operatorAuthority: SafetyAuthority;
        reasonCode: SafetyReasonCode;
        quarantineExpiresAt?: string;
      }
    >
  | Readonly<
      CommonFields & {
        kind: 'transport.media.rejected';
        blockRef: BlockRef;
        operatorAuthority: SafetyAuthority;
        reasonCode: SafetyReasonCode;
      }
    >;

function commonFields(record: Record<string, unknown>, label: string): CommonFields {
  assertExactVersion(record.version, TRANSPORT_EVENT_VERSION, `${label}.version`);
  const eventId = assertId(record.eventId, `${label}.eventId`);
  const createdAt = assertIso8601(record.createdAt, `${label}.createdAt`);
  return Object.freeze({ version: TRANSPORT_EVENT_VERSION, eventId, createdAt });
}

export function validateTransportEvent(value: unknown, label = 'TransportEvent'): TransportEvent {
  const record = assertPlainObject(value, label);
  const kind = record.kind;
  if (typeof kind !== 'string' || !(TRANSPORT_EVENT_KINDS as readonly string[]).includes(kind)) {
    throw tsError(
      'TS_INVALID_ENUM',
      `${label}.kind must be one of ${TRANSPORT_EVENT_KINDS.join(', ')} (got: ${String(kind)})`
    );
  }
  const k = kind as TransportEventKind;
  const common = commonFields(record, label);

  switch (k) {
    case 'transport.event.accepted':
    case 'transport.event.rejected': {
      return Object.freeze({
        ...common,
        kind: k,
        decision: validateTransportAdmissionDecision(record.decision, `${label}.decision`)
      });
    }
    case 'transport.event.quarantined': {
      const decision = validateTransportAdmissionDecision(record.decision, `${label}.decision`);
      const out: {
        -readonly [K in keyof Extract<
          TransportEvent,
          { kind: 'transport.event.quarantined' }
        >]: Extract<TransportEvent, { kind: 'transport.event.quarantined' }>[K];
      } = {
        ...common,
        kind: 'transport.event.quarantined',
        decision
      };
      if (record.quarantineExpiresAt !== undefined) {
        out.quarantineExpiresAt = assertIso8601(
          record.quarantineExpiresAt,
          `${label}.quarantineExpiresAt`
        );
        assertNotBefore(
          common.createdAt,
          out.quarantineExpiresAt,
          `${label}.createdAt`,
          `${label}.quarantineExpiresAt`
        );
      }
      return Object.freeze(out);
    }
    case 'transport.peer.rate_limited': {
      const peerId = assertId(record.peerId, `${label}.peerId`);
      const operatorAuthority = validateSafetyAuthority(
        record.operatorAuthority,
        `${label}.operatorAuthority`
      );
      const reasonCode = assertOneOf(record.reasonCode, SAFETY_REASON_CODES, `${label}.reasonCode`);
      const retryAfter = assertIso8601(record.retryAfter, `${label}.retryAfter`);
      assertNotBefore(common.createdAt, retryAfter, `${label}.createdAt`, `${label}.retryAfter`);
      return Object.freeze({
        ...common,
        kind: 'transport.peer.rate_limited',
        peerId,
        operatorAuthority,
        reasonCode,
        retryAfter
      });
    }
    case 'transport.peer.quarantined': {
      const peerId = assertId(record.peerId, `${label}.peerId`);
      const operatorAuthority = validateSafetyAuthority(
        record.operatorAuthority,
        `${label}.operatorAuthority`
      );
      const reasonCode = assertOneOf(record.reasonCode, SAFETY_REASON_CODES, `${label}.reasonCode`);
      const out: {
        -readonly [K in keyof Extract<
          TransportEvent,
          { kind: 'transport.peer.quarantined' }
        >]: Extract<TransportEvent, { kind: 'transport.peer.quarantined' }>[K];
      } = {
        ...common,
        kind: 'transport.peer.quarantined',
        peerId,
        operatorAuthority,
        reasonCode
      };
      if (record.quarantineExpiresAt !== undefined) {
        out.quarantineExpiresAt = assertIso8601(
          record.quarantineExpiresAt,
          `${label}.quarantineExpiresAt`
        );
        assertNotBefore(
          common.createdAt,
          out.quarantineExpiresAt,
          `${label}.createdAt`,
          `${label}.quarantineExpiresAt`
        );
      }
      return Object.freeze(out);
    }
    case 'transport.media.rejected': {
      const blockRef = validateBlockRef(record.blockRef);
      const operatorAuthority = validateSafetyAuthority(
        record.operatorAuthority,
        `${label}.operatorAuthority`
      );
      const reasonCode = assertOneOf(record.reasonCode, SAFETY_REASON_CODES, `${label}.reasonCode`);
      return Object.freeze({
        ...common,
        kind: 'transport.media.rejected',
        blockRef,
        operatorAuthority,
        reasonCode
      });
    }
  }
}
