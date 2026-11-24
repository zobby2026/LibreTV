import { describe, expect, it } from 'vitest';
import { buildDiscover, filterFallback, type CatalogFile } from './catalog';

describe('buildDiscover', () => {
  it('评分排序强制 vote_count.gte=50', () => {
    const { params } = buildDiscover({ type: '电影', region: '全部', year: '全部', sort: '评分', page: 1 });
    expect(params.sort_by).toBe('vote_average.desc');
    expect(params['vote_count.gte']).toBe('50');
  });

  it('动画走剧集接口并带类型 16', () => {
    const { endpoint, params } = buildDiscover({ type: '动画', region: '日韩', year: '2024', sort: '热度', page: 2 });
    expect(endpoint).toBe('discover/tv');
    expect(params.with_genres).toBe('16');
    expect(params.with_origin_country).toBe('JP|KR');
    expect(params['first_air_date.gte']).toBe('2024-01-01');
  });
});

describe('filterFallback', () => {
  const file: CatalogFile = {
    hero: [],
    boards: [{
      id: 'x',
      name: 'x',
      sub: '',
      items: [
        { id: 1, t: '甲', y: 2024, d: '2024.01', r: 9, a: '#000', b: '#111', ty: '电影', kind: '电影', rg: '欧美', poster: '', w: '' },
        { id: 2, t: '乙', y: 2010, d: '2010.01', r: 7, a: '#000', b: '#111', ty: '剧集', kind: '动画', rg: '日韩', poster: '', w: '' },
      ],
    }],
  };

  it('按地区和年份筛兜底片单', () => {
    const page = filterFallback({ type: '全部', region: '欧美', year: '2024', sort: '评分', page: 1 }, file);
    expect(page.items.map((i) => i.t)).toEqual(['甲']);
  });
});
