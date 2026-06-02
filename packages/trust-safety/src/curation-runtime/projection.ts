import type { CurationExplanation, CurationRule, CurationSurface } from '../curation.js';
import type { SafetyAuthority } from '../authorities.js';
import { tsError } from '../errors.js';
import {
  withFrozenAppliedEventId as withAppliedEventId,
  withFrozenRecordSet as withRecordSet
} from '../projection-helpers.js';
import type { SafetyReasonCode } from '../reason-codes.js';
import type { SafetySubjectRef } from '../subjects.js';
import { type CurationEvent, type ExcludeFrom, validateCurationEvent } from './events.js';

// --- Subject keying ------------------------------------------------------

/**
 * Stable string encoding of a `SafetySubjectRef` so it can serve as a
 * record key. Encoding rules:
 *
 *  - The discriminator (`type`) comes first so two subjects of
 *    different types never collide.
 *  - Identifier-bearing fields follow, separated by `|` which is
 *    forbidden in our id validators (control / URL characters), so
 *    there is no ambiguity at decode time.
 *  - For content-bearing variants (`media`, `blob`) we use the
 *    underlying digest body (already a stable, opaque token) — never
 *    the encryption key.
 */
export function subjectKey(subject: SafetySubjectRef): string {
  switch (subject.type) {
    case 'event':
      return `event|${subject.eventId}`;
    case 'actor':
      return `actor|${subject.actorId}`;
    case 'device':
      return `device|${subject.deviceId}`;
    case 'community':
      return `community|${subject.communityId}`;
    case 'thread':
      return `thread|${subject.threadId}`;
    case 'media':
      return `media|${subject.mediaId}`;
    case 'blob':
      return `blob|${subject.blockRef.source.kind === 'digest' ? `${subject.blockRef.source.digest.algorithm}:${subject.blockRef.source.digest.digest}` : `cid:${subject.blockRef.source.link.cid}`}`;
    case 'url':
      return `url|${subject.normalizedUrl}`;
    case 'domain':
      return `domain|${subject.domain}`;
    case 'topic':
      return `topic|${subject.value}`;
    case 'bridge':
      return `bridge|${subject.bridgeId}`;
    case 'relay':
      return `relay|${subject.relayId}`;
    case 'super-peer':
      return `super-peer|${subject.superPeerId}`;
    case 'policy-list':
      return `policy-list|${subject.policyListId}`;
  }
}

// --- Records -------------------------------------------------------------

export type RuleStatus = 'active' | 'disabled';

export type RuleRecord = Readonly<{
  rule: CurationRule;
  status: RuleStatus;
  disabledBy?: SafetyAuthority;
  disabledAt?: string;
  disableReasonCode?: SafetyReasonCode;
}>;

export type ItemActionRecord = Readonly<{
  ts: string;
  surface: CurationSurface;
  sourceRuleId: string;
  reasonCode: SafetyReasonCode;
  scoreDelta: number;
}>;

export type ItemExclusionRecord = Readonly<{
  ts: string;
  surface: CurationSurface;
  sourceRuleId: string;
  reasonCode: SafetyReasonCode;
  excludeFrom: ExcludeFrom;
}>;

export type ItemCurationRecord = Readonly<{
  subjectKey: string;
  subject: SafetySubjectRef;
  boosts: ReadonlyArray<ItemActionRecord>;
  downranks: ReadonlyArray<ItemActionRecord>;
  exclusions: ReadonlyArray<ItemExclusionRecord>;
  /** Net boost minus downrank, for ranking adjustments. */
  netScoreDelta: number;
}>;

function emptyItemRecord(subjectKey: string, subject: SafetySubjectRef): ItemCurationRecord {
  return Object.freeze({
    subjectKey,
    subject,
    boosts: Object.freeze([]),
    downranks: Object.freeze([]),
    exclusions: Object.freeze([]),
    netScoreDelta: 0
  });
}

// --- State ---------------------------------------------------------------

export type CurationState = Readonly<{
  rulesById: Readonly<Record<string, RuleRecord>>;
  itemsBySubjectKey: Readonly<Record<string, ItemCurationRecord>>;
  explanationsById: Readonly<Record<string, CurationExplanation>>;
  appliedEventIds: ReadonlySet<string>;
}>;

export function createEmptyCurationState(): CurationState {
  return Object.freeze({
    rulesById: Object.freeze({}),
    itemsBySubjectKey: Object.freeze({}),
    explanationsById: Object.freeze({}),
    appliedEventIds: Object.freeze(new Set<string>())
  });
}

// --- Apply ---------------------------------------------------------------

/**
 * Apply a single curation event to the projection.
 *
 * Determinism rules:
 *  - Applying the same event twice (matching `eventId`) is a no-op.
 *  - Validation runs before any state mutation.
 *  - Rule state machine: `active → disabled` (terminal). Disabling an
 *    already-disabled rule throws `TS_LIFECYCLE_TRANSITION`.
 *  - Item-level actions accumulate. Each action records its source
 *    ruleId so a downstream layer can drop actions whose source rule
 *    has been disabled.
 *  - Exclusions are scoped to a specific `excludeFrom` (`feed` /
 *    `search` / `recommendation`). Recording an exclusion does NOT
 *    delete the item; it only flags it for the matching surface.
 */
export function applyCurationEvent(
  state: CurationState,
  event: CurationEvent | unknown,
  label = 'applyCurationEvent'
): CurationState {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw tsError('TS_INVALID_INPUT', `${label}: event must be a plain object`);
  }
  const e = validateCurationEvent(event, label);
  if (state.appliedEventIds.has(e.eventId)) return state;
  const appliedEventIds = withAppliedEventId(state.appliedEventIds, e.eventId);

  switch (e.kind) {
    case 'curation.rule.created': {
      // Re-creation under an existing ruleId is rejected — a new rule
      // requires a fresh ruleId so audit chains stay unambiguous.
      if (state.rulesById[e.rule.ruleId] !== undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: rule "${e.rule.ruleId}" already exists`
        );
      }
      const record: RuleRecord = Object.freeze({ rule: e.rule, status: 'active' });
      return Object.freeze({
        ...state,
        rulesById: withRecordSet(state.rulesById, e.rule.ruleId, record),
        appliedEventIds
      });
    }
    case 'curation.rule.disabled': {
      const existing = state.rulesById[e.ruleId];
      if (existing === undefined) {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: cannot disable unknown rule "${e.ruleId}"`
        );
      }
      if (existing.status === 'disabled') {
        throw tsError(
          'TS_LIFECYCLE_TRANSITION',
          `${label}: rule "${e.ruleId}" is already disabled`
        );
      }
      const next: RuleRecord = Object.freeze({
        rule: existing.rule,
        status: 'disabled',
        disabledBy: e.disabledBy,
        disabledAt: e.disabledAt,
        disableReasonCode: e.reasonCode
      });
      return Object.freeze({
        ...state,
        rulesById: withRecordSet(state.rulesById, e.ruleId, next),
        appliedEventIds
      });
    }
    case 'curation.item.boosted':
    case 'curation.item.downranked': {
      const key = subjectKey(e.itemSubject);
      const current = state.itemsBySubjectKey[key] ?? emptyItemRecord(key, e.itemSubject);
      const action: ItemActionRecord = Object.freeze({
        ts: e.createdAt,
        surface: e.surface,
        sourceRuleId: e.sourceRuleId,
        reasonCode: e.reasonCode,
        scoreDelta: e.scoreDelta
      });
      const next: ItemCurationRecord = Object.freeze({
        ...current,
        boosts:
          e.kind === 'curation.item.boosted'
            ? Object.freeze([...current.boosts, action])
            : current.boosts,
        downranks:
          e.kind === 'curation.item.downranked'
            ? Object.freeze([...current.downranks, action])
            : current.downranks,
        netScoreDelta:
          e.kind === 'curation.item.boosted'
            ? current.netScoreDelta + e.scoreDelta
            : current.netScoreDelta - e.scoreDelta
      });
      return Object.freeze({
        ...state,
        itemsBySubjectKey: withRecordSet(state.itemsBySubjectKey, key, next),
        appliedEventIds
      });
    }
    case 'curation.item.excluded': {
      const key = subjectKey(e.itemSubject);
      const current = state.itemsBySubjectKey[key] ?? emptyItemRecord(key, e.itemSubject);
      const exclusion: ItemExclusionRecord = Object.freeze({
        ts: e.createdAt,
        surface: e.surface,
        sourceRuleId: e.sourceRuleId,
        reasonCode: e.reasonCode,
        excludeFrom: e.excludeFrom
      });
      const next: ItemCurationRecord = Object.freeze({
        ...current,
        exclusions: Object.freeze([...current.exclusions, exclusion])
      });
      return Object.freeze({
        ...state,
        itemsBySubjectKey: withRecordSet(state.itemsBySubjectKey, key, next),
        appliedEventIds
      });
    }
    case 'curation.explanation.recorded': {
      // Explanation records are append-only with idempotency by
      // explanationId. A duplicate explanationId is a silent no-op so
      // replay does not loop.
      if (state.explanationsById[e.explanation.explanationId] !== undefined) {
        return Object.freeze({ ...state, appliedEventIds });
      }
      return Object.freeze({
        ...state,
        explanationsById: withRecordSet(
          state.explanationsById,
          e.explanation.explanationId,
          e.explanation
        ),
        appliedEventIds
      });
    }
  }
}

export function seedCurationState(
  events: Iterable<CurationEvent | unknown>,
  label = 'seedCurationState'
): CurationState {
  let state = createEmptyCurationState();
  let i = 0;
  for (const event of events) {
    state = applyCurationEvent(state, event, `${label}[${i}]`);
    i += 1;
  }
  return state;
}

// --- Ranking helpers -----------------------------------------------------

export type ItemRankingView = Readonly<{
  /**
   * Sum of boost deltas minus downrank deltas, **considering only
   * actions whose source rule is currently active**. Actions sourced
   * from disabled rules are filtered out — this is how the protocol
   * "disable a rule" affects rankings without rewriting history.
   */
  effectiveNetScoreDelta: number;
  /** True iff at least one currently-active exclusion targets the item on `excludeFrom`. */
  isExcludedFromFeed: boolean;
  isExcludedFromSearch: boolean;
  isExcludedFromRecommendation: boolean;
}>;

function isActive(state: CurationState, ruleId: string): boolean {
  return state.rulesById[ruleId]?.status === 'active';
}

export function computeItemRanking(
  state: CurationState,
  subject: SafetySubjectRef
): ItemRankingView {
  const key = subjectKey(subject);
  const record = state.itemsBySubjectKey[key];
  if (record === undefined) {
    return Object.freeze({
      effectiveNetScoreDelta: 0,
      isExcludedFromFeed: false,
      isExcludedFromSearch: false,
      isExcludedFromRecommendation: false
    });
  }
  let net = 0;
  for (const b of record.boosts) if (isActive(state, b.sourceRuleId)) net += b.scoreDelta;
  for (const d of record.downranks) if (isActive(state, d.sourceRuleId)) net -= d.scoreDelta;
  let feed = false;
  let search = false;
  let rec = false;
  for (const x of record.exclusions) {
    if (!isActive(state, x.sourceRuleId)) continue;
    if (x.excludeFrom === 'feed') feed = true;
    else if (x.excludeFrom === 'search') search = true;
    else if (x.excludeFrom === 'recommendation') rec = true;
  }
  return Object.freeze({
    effectiveNetScoreDelta: net,
    isExcludedFromFeed: feed,
    isExcludedFromSearch: search,
    isExcludedFromRecommendation: rec
  });
}
