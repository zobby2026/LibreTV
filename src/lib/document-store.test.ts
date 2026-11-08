import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readStoredJson, usesWorkersKv, writeStoredJson } from './document-store';

const CLOUDFLARE_CONTEXT = Symbol.for('__cloudflare-context__');

describe('document store', () => {
  const prevDir = process.env.LIBRETV_DATA_DIR;
  const prevMode = process.env.LIBRETV_STORAGE;

  afterEach(() => {
    if (prevDir === undefined) delete process.env.LIBRETV_DATA_DIR;
    else process.env.LIBRETV_DATA_DIR = prevDir;
    if (prevMode === undefined) delete process.env.LIBRETV_STORAGE;
    else process.env.LIBRETV_STORAGE = prevMode;
    delete (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT];
  });

  it('LIBRETV_STORAGE=file 时写到数据目录', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltv-doc-'));
    process.env.LIBRETV_STORAGE = 'file';
    process.env.LIBRETV_DATA_DIR = dir;
    expect(usesWorkersKv()).toBe(false);
    await writeStoredJson('users.json', { users: [{ id: '1' }] });
    const read = await readStoredJson<{ users: { id: string }[] }>('users.json', { users: [] });
    expect(read.users[0].id).toBe('1');
    expect(fs.existsSync(path.join(dir, 'users.json'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Workers 运行时读写 LIBRETV_DATA，不碰磁盘', async () => {
    const saved = new Map<string, string>();
    (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT] = {
      env: {
        LIBRETV_DATA: {
          async get(key: string) {
            return saved.get(key) ?? null;
          },
          async put(key: string, value: string) {
            saved.set(key, value);
          },
          async delete(key: string) {
            saved.delete(key);
          },
        },
      },
    };
    process.env.LIBRETV_STORAGE = 'kv';
    delete process.env.LIBRETV_DATA_DIR;
    expect(usesWorkersKv()).toBe(true);
    await writeStoredJson('users.json', { users: [] });
    const read = await readStoredJson<{ users: unknown[] }>('users.json', { users: [{ id: 'fallback' }] });
    expect(read.users).toEqual([]);
    expect(saved.has('users.json')).toBe(true);
  });
});
