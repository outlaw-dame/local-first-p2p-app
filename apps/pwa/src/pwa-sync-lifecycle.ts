import {
  ForegroundSyncController,
  type ForegroundSyncResult,
  type ForegroundSyncRun,
  type ForegroundSyncTrigger
} from '@lfp2p/sync-client/foreground-sync';

export type BrowserOnlineSource = Readonly<{
  navigator?: Readonly<{ onLine?: boolean }>;
}>;

export type EventSubscriptionTarget = Readonly<{
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}>;

export type VisibilitySubscriptionTarget = EventSubscriptionTarget &
  Readonly<{ visibilityState?: DocumentVisibilityState }>;

export type PwaForegroundSyncController = Pick<
  ForegroundSyncController,
  'getState' | 'requestSync'
>;

const UNKNOWN_SYNC_ERROR = 'Unknown foreground sync failure';
const MAX_STATUS_TEXT_LENGTH = 180;

export function browserIsOnline(source: BrowserOnlineSource = globalThis): boolean {
  return source.navigator?.onLine !== false;
}

export function createPwaForegroundSyncController(input: {
  run: ForegroundSyncRun;
  onlineSource?: BrowserOnlineSource;
  now?: () => Date;
}): ForegroundSyncController {
  return new ForegroundSyncController({
    run: input.run,
    isOnline: () => browserIsOnline(input.onlineSource),
    ...(input.now === undefined ? {} : { now: input.now })
  });
}

export function attachPwaForegroundSyncTriggers(input: {
  controller: PwaForegroundSyncController;
  windowTarget?: EventSubscriptionTarget | null;
  documentTarget?: VisibilitySubscriptionTarget | null;
  onResult?: (result: ForegroundSyncResult) => void;
  onUnexpectedError?: (error: unknown, trigger: ForegroundSyncTrigger) => void;
}): () => void {
  const windowTarget = resolveWindowTarget(input.windowTarget);
  const documentTarget = resolveDocumentTarget(input.documentTarget);
  const disposers: (() => void)[] = [];
  let disposed = false;

  if (windowTarget !== undefined) {
    const onlineListener = () =>
      requestAndNotify(input.controller, 'online', input.onResult, input.onUnexpectedError);
    windowTarget.addEventListener('online', onlineListener);
    disposers.push(() => windowTarget.removeEventListener('online', onlineListener));
  }

  if (documentTarget !== undefined) {
    const visibilityListener = () => {
      if (documentTarget.visibilityState === 'visible') {
        requestAndNotify(input.controller, 'visible', input.onResult, input.onUnexpectedError);
      }
    };
    documentTarget.addEventListener('visibilitychange', visibilityListener);
    disposers.push(() =>
      documentTarget.removeEventListener('visibilitychange', visibilityListener)
    );
  }

  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers.reverse()) dispose();
  };
}

export async function requestPwaForegroundSync(
  controller: PwaForegroundSyncController,
  trigger: ForegroundSyncTrigger,
  onResult?: (result: ForegroundSyncResult) => void
): Promise<ForegroundSyncResult> {
  const result = await controller.requestSync(trigger);
  onResult?.(result);
  return result;
}

export function formatPwaForegroundSyncResult(result: ForegroundSyncResult): string {
  if (result.status === 'completed') return `Foreground sync completed from ${result.trigger}.`;
  if (result.status === 'failed')
    return `Foreground sync failed from ${result.trigger}: ${formatPwaSyncStatusText(result.error)}.`;
  if (result.reason === 'backoff' && result.nextRetryAt !== undefined) {
    return `Foreground sync skipped from ${result.trigger}: backing off until ${formatRetryTime(result.nextRetryAt)}.`;
  }
  return `Foreground sync skipped from ${result.trigger}: ${result.reason}.`;
}

export function formatPwaSyncStatusText(value: unknown, fallback = UNKNOWN_SYNC_ERROR): string {
  const raw = value instanceof Error ? value.message : typeof value === 'string' ? value : fallback;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const safe = cleaned.length === 0 ? fallback : cleaned;
  if (safe.length <= MAX_STATUS_TEXT_LENGTH) return safe;
  return `${safe.slice(0, MAX_STATUS_TEXT_LENGTH - 3)}...`;
}

function requestAndNotify(
  controller: PwaForegroundSyncController,
  trigger: ForegroundSyncTrigger,
  onResult: ((result: ForegroundSyncResult) => void) | undefined,
  onUnexpectedError: ((error: unknown, trigger: ForegroundSyncTrigger) => void) | undefined
): void {
  void controller.requestSync(trigger).then(
    (result) => onResult?.(result),
    (error: unknown) => onUnexpectedError?.(error, trigger)
  );
}

function resolveWindowTarget(
  target: EventSubscriptionTarget | null | undefined
): EventSubscriptionTarget | undefined {
  if (target !== undefined) return target ?? undefined;
  const maybeGlobal = globalThis as Partial<EventSubscriptionTarget>;
  if (typeof maybeGlobal.addEventListener !== 'function') return undefined;
  if (typeof maybeGlobal.removeEventListener !== 'function') return undefined;
  return maybeGlobal as EventSubscriptionTarget;
}

function resolveDocumentTarget(
  target: VisibilitySubscriptionTarget | null | undefined
): VisibilitySubscriptionTarget | undefined {
  if (target !== undefined) return target ?? undefined;
  const maybeDocument = (globalThis as { document?: Partial<VisibilitySubscriptionTarget> })
    .document;
  if (maybeDocument === undefined) return undefined;
  if (typeof maybeDocument.addEventListener !== 'function') return undefined;
  if (typeof maybeDocument.removeEventListener !== 'function') return undefined;
  return maybeDocument as VisibilitySubscriptionTarget;
}

function formatRetryTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'later';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(timestamp)
  );
}
