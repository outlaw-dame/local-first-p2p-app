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

export type PwaForegroundSyncController = Pick<ForegroundSyncController, 'getState' | 'requestSync'>;

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
}): () => void {
  const windowTarget = resolveWindowTarget(input.windowTarget);
  const documentTarget = resolveDocumentTarget(input.documentTarget);
  const disposers: (() => void)[] = [];
  let disposed = false;

  if (windowTarget !== undefined) {
    const onlineListener = () => requestAndNotify(input.controller, 'online', input.onResult);
    windowTarget.addEventListener('online', onlineListener);
    disposers.push(() => windowTarget.removeEventListener('online', onlineListener));
  }

  if (documentTarget !== undefined) {
    const visibilityListener = () => {
      if (documentTarget.visibilityState === undefined || documentTarget.visibilityState === 'visible') {
        requestAndNotify(input.controller, 'visible', input.onResult);
      }
    };
    documentTarget.addEventListener('visibilitychange', visibilityListener);
    disposers.push(() => documentTarget.removeEventListener('visibilitychange', visibilityListener));
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
  if (result.status === 'failed') return `Foreground sync failed from ${result.trigger}: ${cleanStatusText(result.error)}.`;
  if (result.reason === 'backoff' && result.nextRetryAt !== undefined) {
    return `Foreground sync skipped from ${result.trigger}: backing off until ${result.nextRetryAt}.`;
  }
  return `Foreground sync skipped from ${result.trigger}: ${result.reason}.`;
}

function requestAndNotify(
  controller: PwaForegroundSyncController,
  trigger: ForegroundSyncTrigger,
  onResult: ((result: ForegroundSyncResult) => void) | undefined
): void {
  void controller.requestSync(trigger).then((result) => onResult?.(result));
}

function resolveWindowTarget(target: EventSubscriptionTarget | null | undefined): EventSubscriptionTarget | undefined {
  if (target !== undefined) return target ?? undefined;
  const maybeGlobal = globalThis as Partial<EventSubscriptionTarget>;
  if (typeof maybeGlobal.addEventListener !== 'function') return undefined;
  if (typeof maybeGlobal.removeEventListener !== 'function') return undefined;
  return maybeGlobal as EventSubscriptionTarget;
}

function resolveDocumentTarget(target: VisibilitySubscriptionTarget | null | undefined): VisibilitySubscriptionTarget | undefined {
  if (target !== undefined) return target ?? undefined;
  const maybeDocument = (globalThis as { document?: Partial<VisibilitySubscriptionTarget> }).document;
  if (maybeDocument === undefined) return undefined;
  if (typeof maybeDocument.addEventListener !== 'function') return undefined;
  if (typeof maybeDocument.removeEventListener !== 'function') return undefined;
  return maybeDocument as VisibilitySubscriptionTarget;
}

function cleanStatusText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180) || 'Unknown foreground sync failure';
}
