import { beforeEach, describe, expect, it, vi } from 'vitest';

// user-data-sync 运行时引用 db.ts / client-api.ts（IndexedDB、fetch），node 测试环境下 mock 掉
vi.mock('./db', () => ({
  db: {},
  clearLiveProbeResultsDb: vi.fn(async () => {}),
  loadLiveProbeResults: vi.fn(async () => ({})),
  saveLiveProbeResults: vi.fn(async () => {}),
}));
vi.mock('./client-api', () => ({
  api: {
    shared: vi.fn(async () => ({})),
    userData: vi.fn(async () => ({ updatedAt: 0, data: null })),
    saveUserData: vi.fn(async () => {}),
    saveShared: vi.fn(async () => {}),
  },
}));

import { ensureUserSourcesSelected } from './user-data-sync';
import { useAppStore } from './store';
import type { SourceConfig } from './types';

/**
 * 「源管理」只对管理员可见，普通用户没有勾选源的入口。
 * 如果此时 selectedKeys 仍为空，搜索会筛出 0 个源 —— 表现为「登录了但搜不到片」。
 * 这组用例守的就是这条兜底。
 */

const src = (key: string, extra: Partial<SourceConfig> = {}): SourceConfig => ({
  key,
  name: key,
  url: `https://${key}.example.com/api.php/provide/vod`,
  ...extra,
});

beforeEach(() => {
  useAppStore.setState({
    customAPIs: [],
    envSources: [],
    selectedKeys: [],
    yellowFilter: false,
  });
});

describe('ensureUserSourcesSelected', () => {
  it('普通用户：把预置源与共享源全部勾上', () => {
    useAppStore.setState({
      envSources: [src('env_0'), src('env_1')],
      customAPIs: [src('custom_0')],
    });

    ensureUserSourcesSelected('user');

    expect(useAppStore.getState().selectedKeys.sort()).toEqual(['custom_0', 'env_0', 'env_1']);
  });

  it('管理员不动：自己勾的源被故意停用时不能被“补”回来', () => {
    useAppStore.setState({
      envSources: [src('env_0'), src('env_1')],
      selectedKeys: ['env_0'],
    });

    ensureUserSourcesSelected('admin');

    expect(useAppStore.getState().selectedKeys).toEqual(['env_0']);
  });

  it('未登录不动', () => {
    useAppStore.setState({ envSources: [src('env_0')] });

    ensureUserSourcesSelected(null);

    expect(useAppStore.getState().selectedKeys).toEqual([]);
  });

  it('成人过滤开启时跳过成人源', () => {
    useAppStore.setState({
      envSources: [src('env_0'), src('env_adult', { isAdult: true })],
      yellowFilter: true,
    });

    ensureUserSourcesSelected('user');

    expect(useAppStore.getState().selectedKeys).toEqual(['env_0']);
  });

  it('没有可用源时保持原状，不清空已有勾选', () => {
    useAppStore.setState({ selectedKeys: ['custom_9'] });

    ensureUserSourcesSelected('user');

    expect(useAppStore.getState().selectedKeys).toEqual(['custom_9']);
  });

  it('幂等：已经全选时不重复写 state', () => {
    useAppStore.setState({
      envSources: [src('env_0')],
      selectedKeys: ['env_0'],
    });
    const before = useAppStore.getState().selectedKeys;

    ensureUserSourcesSelected('user');

    expect(useAppStore.getState().selectedKeys).toBe(before);
  });
});
