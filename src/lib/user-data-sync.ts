'use client';

import { api } from './client-api';
import { db, type HistoryEntry, type ProgressEntry, type SearchHistoryEntry } from './db';
import { PERSIST_KEY, flushPendingPersist } from './persist-storage';
import { useAppStore } from './store';

/**
 * 个人数据与账号同步（本轮多用户改造的第二半）。
 *
 * 之前所有数据都在浏览器里（localStorage 快照 + IndexedDB 历史/进度），换设备就丢。
 * 现在登录后按账号存取：
 *
 * - 快照结构：{ v, settings, history, progress, searchHistory }
 *   `settings` 就是 zustand persist 的那份 partialize 结果（不含三个源字段，见下）。
 * - 三个源字段（customAPIs / subscriptions / liveSubscriptions）属于「共享配置」，
 *   存服务端 shared.json、由管理员维护，所有人的页面都读同一份。
 * - 登录时：服务端有数据 → 覆盖本地；服务端为空 → 把本地数据认领给这个账号。
 *   浏览器里记一个 owner 标记，换账号登录时不会把上一个人的数据顶上去。
 * - 登录后：设置变更与 IndexedDB 写入都会标脏，5s 防抖后整包上传；内容没变就不发。
 *
 * 整套逻辑容错到「同步失败就当没有」：任何一个环节抛错都只打日志，
 * 不影响本地播放与收藏 —— 这是一个自托管影视站，不是网盘。
 */

/** 快照结构版本：将来改字段含义时递增，服务端不解释、只存 */
const SNAPSHOT_VERSION = 1;

/** 记住当前浏览器里的数据归谁，换账号登录时据此判断「要不要清空」 */
const OWNER_KEY = 'libretv-data-owner';

/** 上传防抖：播放中进度每几秒变一次，合并后再发 */
const PUSH_DEBOUNCE_MS = 5000;

/** 共享配置字段：不属于个人快照 */
const SHARED_FIELDS = ['customAPIs', 'subscriptions', 'liveSubscriptions'] as const;

/** 进度表保留上限：单账号最多同步最近 2000 条，防止长剧累积成几 MB */
const MAX_PROGRESS_ROWS = 2000;

export interface UserSnapshot {
  v: number;
  settings: Record<string, unknown> | null;
  history: HistoryEntry[];
  progress: ProgressEntry[];
  searchHistory: SearchHistoryEntry[];
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushed = '';
/** 上次推给共享配置的源快照：管理员改源后只在真变了才写 shared.json */
let lastSharedPushed = '';
let activeUserId: string | null = null;
let activeRole: 'admin' | 'user' | null = null;
let unsubscribeStore: (() => void) | null = null;
let dexieHooked = false;

// —— 采集 / 应用 ——

/** 读 zustand persist 写在 localStorage 里的完整快照（含共享源字段） */
function readStoredSettings(): Record<string, unknown> | null {
  // 节流缓冲里可能还有未落盘的设置，先冲掉再读，否则采到的是 800ms 前的旧快照
  flushPendingPersist();
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    return parsed?.state ?? null;
  } catch {
    return null;
  }
}

function stripShared(settings: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!settings) return null;
  const out = { ...settings };
  for (const key of SHARED_FIELDS) delete out[key];
  return out;
}

/** 共享源与订阅（管理员维护，写 shared.json） */
function pickShared(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SHARED_FIELDS) out[key] = settings[key] ?? [];
  return out;
}

/** 读当前浏览器的完整个人数据 */
export async function collectSnapshot(): Promise<UserSnapshot> {
  const settings = stripShared(readStoredSettings());

  let history: HistoryEntry[] = [];
  let progress: ProgressEntry[] = [];
  let searchHistory: SearchHistoryEntry[] = [];
  try {
    history = await db.history.orderBy('timestamp').reverse().limit(100).toArray();
    progress = await db.progress.orderBy('updatedAt').reverse().limit(MAX_PROGRESS_ROWS).toArray();
    searchHistory = await db.searchHistory.orderBy('timestamp').reverse().limit(10).toArray();
  } catch {
    // IndexedDB 不可用（隐私模式）：只同步设置
  }

  return {
    v: SNAPSHOT_VERSION,
    settings,
    history,
    progress,
    searchHistory,
  };
}

/** 把服务端的个人数据落到本地 */
export async function applySnapshot(snapshot: Partial<UserSnapshot> | null): Promise<void> {
  if (!snapshot) return;

  if (snapshot.settings && typeof snapshot.settings === 'object') {
    // 直写 store（而不是写 localStorage 再 rehydrate）：setState 会走 persist 的写入通道，
    // 既更新内存态、又让节流存储重新落盘，不用关心快照的 version 与 migrate
    try {
      useAppStore.setState(
        snapshot.settings as unknown as unknown as Parameters<typeof useAppStore.setState>[0]
      );
      // 再落一次 localStorage：Providers 会在挂载后 rehydrate，若它恰好晚于这里执行，
      // 只更新内存态就会被 rehydrate 用旧快照覆盖。保留原有的 version 字段，
      // 让 rehydrate 不会把这份数据当成旧版本再跑一遍 migrate。
      let version: unknown;
      try {
        const prev = localStorage.getItem(PERSIST_KEY);
        if (prev) version = (JSON.parse(prev) as { version?: unknown }).version;
      } catch {
        version = undefined;
      }
      const next: Record<string, unknown> = { state: snapshot.settings };
      if (version !== undefined) next.version = version;
      localStorage.setItem(PERSIST_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('[zobby] 应用个人设置失败', err);
    }
  }

  try {
    await db.transaction('rw', [db.history, db.progress, db.searchHistory], async () => {
      await db.history.clear();
      await db.progress.clear();
      await db.searchHistory.clear();
      if (snapshot.history?.length) await db.history.bulkPut(snapshot.history);
      if (snapshot.progress?.length) await db.progress.bulkPut(snapshot.progress);
      if (snapshot.searchHistory?.length) await db.searchHistory.bulkPut(snapshot.searchHistory);
    });
  } catch (err) {
    console.warn('[zobby] 应用观看历史失败', err);
  }
}

/** 清空本地个人数据（换账号且服务端没有该账号数据时用） */
async function clearLocalPersonalData(): Promise<void> {
  try {
    await db.transaction('rw', [db.history, db.progress, db.searchHistory], async () => {
      await db.history.clear();
      await db.progress.clear();
      await db.searchHistory.clear();
    });
  } catch {
    // 忽略
  }
}

// —— 共享配置（源与订阅） ——

/** 把管理员维护的源与订阅套用到本地；服务端还没配过就什么都不做 */
export async function applySharedConfig(): Promise<void> {
  try {
    const shared = await api.shared();
    const patch: Record<string, unknown> = {};
    if (shared.customAPIs?.length) patch.customAPIs = shared.customAPIs;
    if (shared.subscriptions?.length) patch.subscriptions = shared.subscriptions;
    if (shared.liveSubscriptions?.length) patch.liveSubscriptions = shared.liveSubscriptions;
    if (Object.keys(patch).length > 0) {
      useAppStore.setState(patch as unknown as Parameters<typeof useAppStore.setState>[0]);
    }
  } catch {
    // 未登录 / 网络异常：保留本地已有的源，不影响使用
  }
}

// —— 上传 ——

function schedulePush(): void {
  if (!activeUserId) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, PUSH_DEBOUNCE_MS);
}

async function pushNow(): Promise<void> {
  if (!activeUserId) return;
  try {
    const snapshot = await collectSnapshot();
    // 内容没变就不发：播放中每 5s 一次的空写没必要压到服务器上
    const body = JSON.stringify(snapshot);
    if (body !== lastPushed) {
      await api.saveUserData(snapshot as unknown as Record<string, unknown>);
      lastPushed = body;
    }
  } catch (err) {
    // 静默失败：下一次变更会重试，绝不能因为同步断了就打断观看
    if (process.env.NODE_ENV !== 'production') console.warn('[zobby] 个人数据上传失败', err);
  }

  // 管理员改动源时同步到 shared.json（普通用户的本地改动只留在本机，不广播给其他人）
  if (activeRole === 'admin') {
    try {
      const stored = readStoredSettings();
      if (stored) {
        const shared = pickShared(stored);
        const key = JSON.stringify(shared);
        if (key !== lastSharedPushed) {
          await api.saveShared(shared);
          lastSharedPushed = key;
        }
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.warn('[zobby] 共享源上传失败', err);
    }
  }
}

function startWatching(): void {
  if (!unsubscribeStore) {
    // 任何设置变更（收藏、过滤开关、音量……）都标脏
    unsubscribeStore = useAppStore.subscribe(() => schedulePush());
  }
  if (!dexieHooked) {
    try {
      // 用 Dexie 的表级 hook 标脏：观看历史/进度/搜索记录的任何写入都会触发同步，
      // 不必在每个 db 函数里手工标脏，也不用改 db.ts 的十几个调用点。
      // hook 是同步回调，标脏只排一个定时器，不会拖慢写入。
      for (const table of [db.history, db.progress, db.searchHistory]) {
        table.hook('creating', () => schedulePush());
        table.hook('updating', () => schedulePush());
        table.hook('deleting', () => schedulePush());
      }
      dexieHooked = true;
    } catch {
      // 极端情况下 hook 注册失败：退回只同步设置，不影响本地功能
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
  }
}

function stopWatching(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
  }
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

function onVisibilityChange(): void {
  // 页面隐藏时立刻把待发的改动推上去，避免关标签页丢最后一次修改
  if (document.visibilityState === 'hidden' && activeUserId) {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    void pushNow();
  }
}

function onPageHide(): void {
  if (activeUserId) void pushNow();
}

// —— 对外入口 ——

/**
 * 登录后（或会话恢复后）拉取该账号的数据。
 *
 * 三种情况：
 * 1. 服务端已有数据 → 直接覆盖本地（以账号为准，换设备也是同一份）
 * 2. 服务端没有数据 + 本浏览器没归属过别人 → 把本地存量数据认领给这个账号（老用户平移）
 * 3. 服务端没有数据 + 浏览器属于别的账号 → 先清空本地，避免把上一个人的收藏顶给新用户
 */
export async function hydrateUserData(
  userId: string,
  role: 'admin' | 'user' = 'user'
): Promise<void> {
  stopWatching();
  activeUserId = userId;
  activeRole = role;
  lastPushed = '';
  lastSharedPushed = '';

  try {
    const remote = await api.userData();

    if (remote.updatedAt > 0 && remote.data && typeof remote.data === 'object') {
      await applySnapshot(remote.data as unknown as Partial<UserSnapshot>);
    } else {
      let owner: string | null = null;
      try {
        owner = localStorage.getItem(OWNER_KEY);
      } catch {
        owner = null;
      }
      if (owner && owner !== userId) {
        await clearLocalPersonalData();
      }
    }

    try {
      localStorage.setItem(OWNER_KEY, userId);
    } catch {
      // 无痕模式：本次会话仍然可用，只是下次登录会重新判定归属
    }

    // 共享源放在个人数据之后：源属于管理员维护的公共部分，优先级更高
    await applySharedConfig();

    // 拉下来的共享源就是「已同步」状态，避免登录后立刻又把同一份写回去
    const stored = readStoredSettings();
    if (stored) lastSharedPushed = JSON.stringify(pickShared(stored));

    startWatching();
    // 认领场景要立刻把本地数据推上去，不能让用户以为「登录了但没同步」
    if (remote.updatedAt === 0) await pushNow();
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.warn('[zobby] 个人数据加载失败', err);
    // 拉取失败也开启监听：至少本次会话的改动还能在下次登录前尽力上传
    startWatching();
  }
}

/** 退出登录：停止同步。数据留在服务端，本地不清（下次同账号登录会覆盖回来） */
export function detachUserData(): void {
  activeUserId = null;
  activeRole = null;
  lastPushed = '';
  lastSharedPushed = '';
  stopWatching();
}

/** 立即上传一次（导出/设置页手动触发用） */
export async function flushUserData(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await pushNow();
}
