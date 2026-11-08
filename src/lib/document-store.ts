import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 账号、邀请码、共享源和个人数据的文档存储。
 *
 * Docker / 本机继续写 `data/`（或 LIBRETV_DATA_DIR）。
 * Cloudflare Workers 的项目目录不可写，改走 KV 绑定 LIBRETV_DATA。
 * OpenNext 在请求期间把绑定放在 globalThis[Symbol.for("__cloudflare-context__")]。
 */

const CLOUDFLARE_CONTEXT = Symbol.for('__cloudflare-context__');

type KvNamespace = {
  get(key: string, options: { type: 'text' }): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export function dataDir(): string {
  return process.env.LIBRETV_DATA_DIR || path.join(process.cwd(), 'data');
}

/** 显式 LIBRETV_STORAGE=file 时强制走磁盘，测试和 Docker 都用这个 */
export function usesWorkersKv(): boolean {
  if (process.env.LIBRETV_STORAGE === 'file') return false;
  if (process.env.LIBRETV_STORAGE === 'kv') return true;
  const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? '';
  return ua.includes('Cloudflare-Workers');
}

function kvBinding(): KvNamespace | null {
  const ctx = (globalThis as Record<symbol, { env?: Record<string, unknown> } | undefined>)[CLOUDFLARE_CONTEXT];
  const kv = ctx?.env?.LIBRETV_DATA;
  if (!kv || typeof kv !== 'object') return null;
  const candidate = kv as KvNamespace;
  if (typeof candidate.get !== 'function' || typeof candidate.put !== 'function') return null;
  return candidate;
}

async function requireKv(): Promise<KvNamespace> {
  const kv = kvBinding();
  if (kv) return kv;
  throw new Error('Cloudflare KV 绑定 LIBRETV_DATA 不存在，无法保存账号数据');
}

export async function ensureDataStore(): Promise<void> {
  if (usesWorkersKv()) {
    await requireKv();
    return;
  }
  await fs.mkdir(path.join(dataDir(), 'user-data'), { recursive: true });
}

export async function readStoredJson<T>(key: string, fallback: T): Promise<T> {
  if (usesWorkersKv()) {
    const raw = await (await requireKv()).get(key, { type: 'text' });
    if (!raw || !raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  }
  try {
    const raw = await fs.readFile(path.join(dataDir(), key), 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeStoredJson(key: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value, null, 2);
  if (usesWorkersKv()) {
    await (await requireKv()).put(key, body);
    return;
  }
  const file = path.join(dataDir(), key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
}

export async function deleteStored(key: string): Promise<void> {
  if (usesWorkersKv()) {
    await (await requireKv()).delete(key);
    return;
  }
  await fs.unlink(path.join(dataDir(), key)).catch(() => {});
}
