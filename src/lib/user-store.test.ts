import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { countUsers, createFirstAdmin } from './user-store';

describe('createFirstAdmin', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltv-users-'));
  const prevDir = process.env.LIBRETV_DATA_DIR;
  const prevMode = process.env.LIBRETV_STORAGE;
  process.env.LIBRETV_DATA_DIR = dir;
  process.env.LIBRETV_STORAGE = 'file';

  afterAll(() => {
    if (prevDir === undefined) delete process.env.LIBRETV_DATA_DIR;
    else process.env.LIBRETV_DATA_DIR = prevDir;
    if (prevMode === undefined) delete process.env.LIBRETV_STORAGE;
    else process.env.LIBRETV_STORAGE = prevMode;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('在可写目录里创建唯一管理员', async () => {
    expect(await countUsers()).toBe(0);
    const created = await createFirstAdmin({ username: 'zobby', password: 'secret1' });
    expect(created.ok).toBe(true);
    expect(created.user?.role).toBe('admin');
    expect(await countUsers()).toBe(1);
    expect(fs.existsSync(path.join(dir, 'users.json'))).toBe(true);

    const again = await createFirstAdmin({ username: 'other', password: 'secret1' });
    expect(again.ok).toBe(false);
    expect(await countUsers()).toBe(1);
  });
});
