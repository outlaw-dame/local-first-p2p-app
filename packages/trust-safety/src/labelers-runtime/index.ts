export {
  LABELER_EVENT_KINDS,
  LABELER_EVENT_VERSION,
  validateLabelerEvent
} from './events.js';
export type { LabelerEvent, LabelerEventKind } from './events.js';

export {
  STACKED_ACTIONS,
  applyLabelerEvent,
  createEmptyLabelersState,
  effectiveLabelsForSubject,
  mostRestrictiveAction,
  seedLabelersState
} from './projection.js';
export type {
  LabelRecord,
  LabelStatus,
  LabelersState,
  ResolvedLabel,
  StackedAction,
  SubscriptionRecord,
  SubscriptionStatus
} from './projection.js';

export {
  detectRedundantSubscription,
  findOverlappingSubscriptions
} from './overlap.js';
export type { OverlapLevel, OverlappingPair, RedundancyAssessment } from './overlap.js';
