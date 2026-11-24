'use client';

export interface DecisionCardData {
  p: string;
  c: string;
  f: string[];
  recap?: string;
}

const STORAGE_KEY = 'libretv_ai_decision_cards_v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LOCAL_ENTRIES = 120;

interface StoredEntry {
  data: DecisionCardData;
  ts: number;
}

const memCache = new Map<string, DecisionCardData>();
const inflight = new Map<string, Promise<DecisionCardData | null>>();

function normalizeKey(title: string, year?: string | number): string {
  const cleanTitle = title.trim().replace(/[《》\s]+/g, '').toLowerCase();
  const cleanYear = year ? String(year).trim() : '';
  return cleanYear ? `${cleanTitle}_${cleanYear}` : cleanTitle;
}

function readStorage(): Record<string, StoredEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredEntry>) : {};
  } catch {
    return {};
  }
}

function writeStorage(map: Record<string, StoredEntry>) {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(map)
      .filter(([, v]) => v?.data?.p && Date.now() - (v.ts || 0) < TTL_MS)
      .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))
      .slice(0, MAX_LOCAL_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* 隐私模式或存储满时静默忽略 */
  }
}

export function getCachedDecisionCard(title: string, year?: string | number): DecisionCardData | null {
  const key = normalizeKey(title, year);
  if (!key) return null;
  const mem = memCache.get(key);
  if (mem) return mem;

  const store = readStorage();
  const hit = store[key];
  if (hit?.data?.p && Date.now() - (hit.ts || 0) < TTL_MS) {
    memCache.set(key, hit.data);
    return hit.data;
  }
  return null;
}

export function saveCachedDecisionCard(title: string, year: string | number | undefined, data: DecisionCardData) {
  const key = normalizeKey(title, year);
  if (!key || !data?.p) return;
  memCache.set(key, data);
  const store = readStorage();
  store[key] = { data, ts: Date.now() };
  writeStorage(store);
}

/**
 * 获取 30 秒决策卡（前端内存 -> localStorage 30 天 -> 服务端持久缓存/边缘缓存 -> LLM）。
 * 同一影片并发请求自动合并去重，避免重复消耗 Token。
 */
export async function fetchDecisionCardCached(params: {
  title: string;
  year?: string | number;
  overview?: string;
}): Promise<DecisionCardData | null> {
  const title = params.title.trim();
  if (!title) return null;

  const cached = getCachedDecisionCard(title, params.year);
  if (cached) return cached;

  const key = normalizeKey(title, params.year);
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = fetch('/api/ai/decision-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      year: params.year || '',
      overview: params.overview || '',
    }),
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as DecisionCardData;
      if (data?.p) {
        saveCachedDecisionCard(title, params.year, data);
        return data;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}
