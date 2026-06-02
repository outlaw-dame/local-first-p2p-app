export {
  CURATION_EVENT_KINDS,
  CURATION_EVENT_VERSION,
  EXCLUDE_FROM,
  MAX_SCORE_DELTA,
  validateCurationEvent
} from './events.js';
export type { CurationEvent, CurationEventKind, ExcludeFrom } from './events.js';

export {
  applyCurationEvent,
  computeItemRanking,
  createEmptyCurationState,
  seedCurationState,
  subjectKey
} from './projection.js';
export type {
  CurationState,
  ItemActionRecord,
  ItemCurationRecord,
  ItemExclusionRecord,
  ItemRankingView,
  RuleRecord,
  RuleStatus
} from './projection.js';

export {
  LOCAL_CURATION_SURFACES,
  PUBLIC_CURATION_SURFACES,
  PUBLIC_SAFE_ENVELOPE_SCOPES,
  SURFACE_GATE_REASONS,
  assertCurationSurfaceIngest,
  assertReportAsCurationSignal,
  decideCurationSurfaceIngest,
  decideReportAsCurationSignal
} from './surface-gate.js';
export type {
  ReportSignalDecision,
  SurfaceGateDecision,
  SurfaceGateReason
} from './surface-gate.js';
