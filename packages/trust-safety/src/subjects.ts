import type { BlockRef, DigestRef, ObjectRef } from '@lfp2p/content-addressing';
import { validateBlockRef, validateDigestRef, validateObjectRef } from '@lfp2p/content-addressing';
import { tsError } from './errors.js';
import { assertId, assertNonEmptyString, assertPlainObject } from './validation.js';

/**
 * SafetySubjectRef variants. Each variant carries enough information to
 * route a decision without leaking unrelated state. Unknown variant types
 * fail closed.
 */
export const SAFETY_SUBJECT_TYPES = [
  'event',
  'actor',
  'device',
  'community',
  'thread',
  'media',
  'blob',
  'url',
  'domain',
  'topic',
  'bridge',
  'relay',
  'super-peer',
  'policy-list'
] as const;
export type SafetySubjectType = (typeof SAFETY_SUBJECT_TYPES)[number];

/**
 * Subjects whose content body is private by nature and must not be referenced
 * in `public-index` or `network-advisory` flows by default. Callers that
 * cross-check privacy enforcement use this set.
 */
export const PRIVATE_BY_NATURE_SUBJECTS: ReadonlySet<SafetySubjectType> = new Set([
  'blob',
  'media',
  'thread'
]);

export type SafetySubjectRef =
  | Readonly<{ type: 'event'; eventId: string; objectRef?: ObjectRef }>
  | Readonly<{ type: 'actor'; actorId: string }>
  | Readonly<{ type: 'device'; deviceId: string; actorId?: string }>
  | Readonly<{ type: 'community'; communityId: string }>
  | Readonly<{ type: 'thread'; threadId: string; rootEventId?: string }>
  | Readonly<{ type: 'media'; mediaId: string; objectRef: ObjectRef }>
  | Readonly<{ type: 'blob'; blockRef: BlockRef }>
  | Readonly<{ type: 'url'; normalizedUrl: string; digest?: DigestRef }>
  | Readonly<{ type: 'domain'; domain: string }>
  | Readonly<{ type: 'topic'; value: string }>
  | Readonly<{ type: 'bridge'; bridgeId: string }>
  | Readonly<{ type: 'relay'; relayId: string }>
  | Readonly<{ type: 'super-peer'; superPeerId: string }>
  | Readonly<{ type: 'policy-list'; policyListId: string }>;

const MAX_URL_LENGTH = 8192;
const MAX_DOMAIN_LENGTH = 253;
const MAX_TOPIC_LENGTH = 256;

function isLikelyUrl(value: string): boolean {
  return value.includes('://');
}

export function validateSafetySubjectRef(
  value: unknown,
  label = 'SafetySubjectRef'
): SafetySubjectRef {
  const record = assertPlainObject(value, label);
  const type = record.type;
  if (typeof type !== 'string') {
    throw tsError('TS_INVALID_SUBJECT', `${label}.type must be a string`);
  }
  if (!(SAFETY_SUBJECT_TYPES as readonly string[]).includes(type)) {
    throw tsError(
      'TS_INVALID_SUBJECT',
      `${label}.type "${type}" is not recognized (unknown subject types fail closed)`
    );
  }
  const t = type as SafetySubjectType;

  switch (t) {
    case 'event': {
      const out: {
        -readonly [K in keyof Extract<SafetySubjectRef, { type: 'event' }>]: Extract<
          SafetySubjectRef,
          { type: 'event' }
        >[K];
      } = {
        type: 'event',
        eventId: assertId(record.eventId, `${label}.eventId`)
      };
      if (record.objectRef !== undefined) out.objectRef = validateObjectRef(record.objectRef);
      return Object.freeze(out);
    }
    case 'actor':
      return Object.freeze({
        type: 'actor',
        actorId: assertId(record.actorId, `${label}.actorId`)
      });
    case 'device': {
      const out: {
        -readonly [K in keyof Extract<SafetySubjectRef, { type: 'device' }>]: Extract<
          SafetySubjectRef,
          { type: 'device' }
        >[K];
      } = {
        type: 'device',
        deviceId: assertId(record.deviceId, `${label}.deviceId`)
      };
      if (record.actorId !== undefined) out.actorId = assertId(record.actorId, `${label}.actorId`);
      return Object.freeze(out);
    }
    case 'community':
      return Object.freeze({
        type: 'community',
        communityId: assertId(record.communityId, `${label}.communityId`)
      });
    case 'thread': {
      const out: {
        -readonly [K in keyof Extract<SafetySubjectRef, { type: 'thread' }>]: Extract<
          SafetySubjectRef,
          { type: 'thread' }
        >[K];
      } = {
        type: 'thread',
        threadId: assertId(record.threadId, `${label}.threadId`)
      };
      if (record.rootEventId !== undefined)
        out.rootEventId = assertId(record.rootEventId, `${label}.rootEventId`);
      return Object.freeze(out);
    }
    case 'media': {
      return Object.freeze({
        type: 'media',
        mediaId: assertId(record.mediaId, `${label}.mediaId`),
        objectRef: validateObjectRef(record.objectRef)
      });
    }
    case 'blob': {
      return Object.freeze({
        type: 'blob',
        blockRef: validateBlockRef(record.blockRef)
      });
    }
    case 'url': {
      const normalizedUrl = assertNonEmptyString(record.normalizedUrl, `${label}.normalizedUrl`);
      if (normalizedUrl.length > MAX_URL_LENGTH) {
        throw tsError(
          'TS_INVALID_SUBJECT',
          `${label}.normalizedUrl length ${normalizedUrl.length} exceeds ${MAX_URL_LENGTH}`
        );
      }
      // The URL must be parseable, must be http(s), and must not embed userinfo.
      let url: URL;
      try {
        url = new URL(normalizedUrl);
      } catch {
        throw tsError('TS_INVALID_SUBJECT', `${label}.normalizedUrl must be a valid URL`);
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw tsError('TS_INVALID_SUBJECT', `${label}.normalizedUrl must use http: or https:`);
      }
      if (url.username !== '' || url.password !== '') {
        throw tsError('TS_PRIVATE_LEAK', `${label}.normalizedUrl must not embed userinfo`);
      }
      const out: {
        -readonly [K in keyof Extract<SafetySubjectRef, { type: 'url' }>]: Extract<
          SafetySubjectRef,
          { type: 'url' }
        >[K];
      } = {
        type: 'url',
        normalizedUrl
      };
      if (record.digest !== undefined) out.digest = validateDigestRef(record.digest);
      return Object.freeze(out);
    }
    case 'domain': {
      const domain = assertNonEmptyString(record.domain, `${label}.domain`);
      if (domain.length > MAX_DOMAIN_LENGTH || isLikelyUrl(domain) || domain.includes('/')) {
        throw tsError('TS_INVALID_SUBJECT', `${label}.domain must be a bare domain, not a URL`);
      }
      return Object.freeze({ type: 'domain', domain: domain.toLowerCase() });
    }
    case 'topic': {
      const v = assertNonEmptyString(record.value, `${label}.value`);
      if (v.length > MAX_TOPIC_LENGTH) {
        throw tsError(
          'TS_INVALID_SUBJECT',
          `${label}.value length ${v.length} exceeds ${MAX_TOPIC_LENGTH}`
        );
      }
      return Object.freeze({ type: 'topic', value: v });
    }
    case 'bridge':
      return Object.freeze({
        type: 'bridge',
        bridgeId: assertId(record.bridgeId, `${label}.bridgeId`)
      });
    case 'relay':
      return Object.freeze({
        type: 'relay',
        relayId: assertId(record.relayId, `${label}.relayId`)
      });
    case 'super-peer':
      return Object.freeze({
        type: 'super-peer',
        superPeerId: assertId(record.superPeerId, `${label}.superPeerId`)
      });
    case 'policy-list':
      return Object.freeze({
        type: 'policy-list',
        policyListId: assertId(record.policyListId, `${label}.policyListId`)
      });
  }
}
