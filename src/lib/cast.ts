'use client';

/**
 * 多终端系统投屏与防息屏工具（AirPlay / Google Cast SDK / Remote Playback / WakeLock）。
 */

export interface CastMediaOptions {
  video?: HTMLVideoElement | null;
  url: string;
  title?: string;
  currentTime?: number;
  isLive?: boolean;
  onHint?: (text: string) => void;
}

interface CastFrameworkContext {
  setOptions(options: {
    receiverApplicationId: string;
    autoJoinPolicy: string;
  }): void;
  requestSession(): Promise<void>;
  getCurrentSession(): CastSession | null;
}

interface CastSession {
  loadMedia(request: unknown): Promise<void>;
}

interface CastWindow extends Window {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
  cast?: {
    framework?: {
      CastContext: {
        getInstance(): CastFrameworkContext;
      };
    };
  };
  chrome?: {
    cast?: {
      AutoJoinPolicy: {
        ORIGIN_SCOPED: string;
      };
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string;
        StreamType: {
          BUFFERED: string;
          LIVE: string;
        };
        GenericMediaMetadata: new () => { title?: string };
        MediaInfo: new (
          contentId: string,
          contentType: string
        ) => {
          metadata?: unknown;
          streamType?: string;
        };
        LoadRequest: new (mediaInfo: unknown) => {
          currentTime?: number;
          autoplay?: boolean;
        };
      };
    };
  };
}

const CAST_SDK_URL =
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

let castSdkPromise: Promise<boolean> | null = null;
let castInitialized = false;

/**
 * 预加载 Google Cast Web Sender SDK（幂等单例）。
 * 必须在用户点击前预加载，才能在点击回调里同步触发 requestSession() 而不丢失手势激活。
 */
export function preloadGoogleCastSdk(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const w = window as CastWindow;

  if (w.cast?.framework && w.chrome?.cast) {
    initCastContext(w);
    return Promise.resolve(true);
  }

  if (castSdkPromise) return castSdkPromise;

  castSdkPromise = new Promise<boolean>((resolve) => {
    const prevCallback = w.__onGCastApiAvailable;
    w.__onGCastApiAvailable = (isAvailable: boolean) => {
      prevCallback?.(isAvailable);
      if (isAvailable) {
        initCastContext(w);
      }
      resolve(isAvailable);
    };

    const existing = document.querySelector(`script[src="${CAST_SDK_URL}"]`);
    if (existing) return;

    const script = document.createElement('script');
    script.src = CAST_SDK_URL;
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return castSdkPromise;
}

function initCastContext(w: CastWindow) {
  if (castInitialized) return;
  const castFramework = w.cast?.framework;
  const chromeCast = w.chrome?.cast;
  if (!castFramework || !chromeCast) return;
  try {
    castFramework.CastContext.getInstance().setOptions({
      receiverApplicationId: chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    castInitialized = true;
  } catch {
    /* 忽略非 Chrome/Edge 或非安全上下文报错 */
  }
}

export function resolveAbsoluteMediaUrl(url: string): string {
  if (!url || typeof window === 'undefined') return url;
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

function inferContentType(url: string): string {
  if (/\.flv(\?|$)/i.test(url)) return 'video/x-flv';
  if (/\.(mp4|m4v|mov)(\?|$)/i.test(url)) return 'video/mp4';
  if (/\.webm(\?|$)/i.test(url)) return 'video/webm';
  return 'application/x-mpegURL';
}

function copyUrlQuietly(url: string) {
  if (!url || typeof navigator === 'undefined' || !navigator.clipboard) return;
  navigator.clipboard.writeText(url).catch(() => {});
}

/**
 * 统一触发多终端系统投屏：
 * 1. Apple Safari / iOS: webkitShowPlaybackTargetPicker (AirPlay)
 * 2. Chrome / Edge (Windows / Android): Google Cast Web Sender SDK (LOAD 真实流地址)
 * 3. 支持 W3C Remote Playback 的浏览器: video.remote.prompt()
 * 4. 兜底: 复制直链到剪贴板并提示系统投屏方式
 */
export async function triggerSystemCast({
  video,
  url,
  title,
  currentTime = 0,
  isLive = false,
  onHint,
}: CastMediaOptions): Promise<void> {
  const absoluteUrl = resolveAbsoluteMediaUrl(url);
  copyUrlQuietly(absoluteUrl);

  // 1. Apple AirPlay
  const appleVideo = video as
    | (HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void })
    | null
    | undefined;
  if (appleVideo && typeof appleVideo.webkitShowPlaybackTargetPicker === 'function') {
    try {
      appleVideo.webkitShowPlaybackTargetPicker();
      onHint?.(isLive ? '正在拉起 AirPlay 投屏（直播流已复制）' : '正在拉起 AirPlay 投屏（直链已复制）');
      return;
    } catch {
      /* 降级到其他方式 */
    }
  }

  // 2. Google Cast Web Sender SDK
  const w = typeof window !== 'undefined' ? (window as CastWindow) : undefined;
  const castFramework = w?.cast?.framework;
  const chromeCast = w?.chrome?.cast;
  if (castFramework && chromeCast && absoluteUrl) {
    try {
      initCastContext(w);
      const context = castFramework.CastContext.getInstance();
      await context.requestSession();
      const session = context.getCurrentSession();
      if (session) {
        const mediaInfo = new chromeCast.media.MediaInfo(
          absoluteUrl,
          inferContentType(absoluteUrl)
        );
        const metadata = new chromeCast.media.GenericMediaMetadata();
        if (title) metadata.title = title;
        mediaInfo.metadata = metadata;
        mediaInfo.streamType = isLive
          ? chromeCast.media.StreamType.LIVE
          : chromeCast.media.StreamType.BUFFERED;

        const request = new chromeCast.media.LoadRequest(mediaInfo);
        request.autoplay = true;
        if (!isLive && Number.isFinite(currentTime) && currentTime > 0) {
          request.currentTime = currentTime;
        }
        await session.loadMedia(request);
        onHint?.('已投屏到电视设备');
        return;
      }
    } catch {
      /* 用户取消或当前环境无 Cast 设备，继续尝试 Remote Playback */
    }
  }

  // 3. Android / W3C Remote Playback API（需非 blob: 源才能被系统投屏识别）
  const remoteVideo = video as
    | (HTMLVideoElement & { remote?: { prompt?: () => Promise<void> } })
    | null
    | undefined;
  if (remoteVideo?.remote && typeof remoteVideo.remote.prompt === 'function') {
    try {
      await remoteVideo.remote.prompt();
      onHint?.('正在投屏中...');
      return;
    } catch {
      /* NotSupportedError（如 blob: 源）或用户取消 */
    }
  }

  onHint?.(
    isLive
      ? '直播流已复制剪贴板！电脑请右键画面或使用系统“无线投屏”'
      : '直链已复制剪贴板！可使用系统“无线投屏”或外部播放器投屏'
  );
}

export interface WakeLockController {
  acquire(): void;
  release(): void;
  dispose(): void;
}

/**
 * 屏幕常亮控制器（Screen Wake Lock API）：
 * 播放中保持屏幕常亮，暂停/结束/卸载时释放；切回前台且仍在播放时自动重新申请。
 */
export function createWakeLockController(
  isVideoPlaying: () => boolean
): WakeLockController {
  let sentinel: WakeLockSentinel | null = null;
  let disposed = false;

  const acquire = () => {
    if (disposed || typeof navigator === 'undefined') return;
    if (!('wakeLock' in navigator) || !navigator.wakeLock?.request) return;
    if (sentinel && !sentinel.released) return;
    navigator.wakeLock
      .request('screen')
      .then((s) => {
        if (disposed) {
          s.release().catch(() => {});
          return;
        }
        sentinel = s;
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
        });
      })
      .catch(() => {
        /* 省电模式或权限受限时静默降级 */
      });
  };

  const release = () => {
    if (!sentinel) return;
    const current = sentinel;
    sentinel = null;
    current.release().catch(() => {});
  };

  const onVisibilityChange = () => {
    if (disposed) return;
    if (document.visibilityState === 'visible' && isVideoPlaying()) {
      acquire();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    acquire,
    release,
    dispose: () => {
      disposed = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      release();
    },
  };
}
