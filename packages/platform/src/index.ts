export type PlatformKind = 'ios' | 'android' | 'desktop' | 'unknown';
export type RuntimeKind = 'browser' | 'standalone-pwa' | 'capacitor' | 'server';

export type PlatformCapabilities = Readonly<{
  platform: PlatformKind;
  runtime: RuntimeKind;
  webPush: boolean;
  badging: boolean;
  backgroundSync: boolean;
  haptics: boolean;
  biometrics: boolean;
  shareTarget: boolean;
  fileSystemAccess: boolean;
  opfs: boolean;
  webRtc: boolean;
  safeAreaInsets: boolean;
}>;

export function detectPlatformCapabilities(): PlatformCapabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return emptyCapabilities('server');
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const platform = /iphone|ipad|ipod/.test(userAgent)
    ? 'ios'
    : /android/.test(userAgent)
      ? 'android'
      : 'desktop';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true;
  const nav = navigator as Navigator & {
    standalone?: boolean;
    serviceWorker?: unknown;
    setAppBadge?: unknown;
    share?: unknown;
  };

  return {
    platform,
    runtime: standalone || nav.standalone === true ? 'standalone-pwa' : 'browser',
    webPush: 'PushManager' in window && 'serviceWorker' in navigator,
    badging: 'setAppBadge' in navigator,
    backgroundSync: 'serviceWorker' in navigator && 'SyncManager' in window,
    haptics: false,
    biometrics: 'PublicKeyCredential' in window,
    shareTarget: typeof nav.share === 'function',
    fileSystemAccess: 'showOpenFilePicker' in window,
    opfs: typeof navigator.storage?.getDirectory === 'function',
    webRtc: 'RTCPeerConnection' in window,
    safeAreaInsets: true
  };
}

function emptyCapabilities(runtime: RuntimeKind): PlatformCapabilities {
  return {
    platform: 'unknown',
    runtime,
    webPush: false,
    badging: false,
    backgroundSync: false,
    haptics: false,
    biometrics: false,
    shareTarget: false,
    fileSystemAccess: false,
    opfs: false,
    webRtc: false,
    safeAreaInsets: false
  };
}
