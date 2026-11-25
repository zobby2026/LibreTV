import { describe, expect, it } from 'vitest';
import { classifySearchIntent, normalizeDirectTitle } from './search-intent';

describe('classifySearchIntent', () => {
  const catalogTitles = new Set(['沙丘2', '饥饿游戏：收获日出', '黑镜']);

  it('正常电影与剧集名称应直接走片源直搜', () => {
    expect(classifySearchIntent('庆余年', catalogTitles)).toBe('direct');
    expect(classifySearchIntent('周处除三害', catalogTitles)).toBe('direct');
    expect(classifySearchIntent('《沙丘2》', catalogTitles)).toBe('direct');
    expect(classifySearchIntent('唐朝诡事录之西行', catalogTitles)).toBe('direct');
    expect(classifySearchIntent('Inception', catalogTitles)).toBe('direct');
  });

  it('包含找片意图、情绪描述或长句时进入 AI 影展', () => {
    expect(classifySearchIntent('像《黑镜》一样细思极恐的反转剧', catalogTitles)).toBe('ai');
    expect(classifySearchIntent('周二晚上的电子布洛芬轻喜剧', catalogTitles)).toBe('ai');
    expect(classifySearchIntent('推荐几部适合周末下饭的片', catalogTitles)).toBe('ai');
    expect(classifySearchIntent('深夜emo看什么好？', catalogTitles)).toBe('ai');
    expect(classifySearchIntent('烧脑', catalogTitles)).toBe('ai');
    expect(classifySearchIntent('   ', catalogTitles)).toBe('ai');
  });

  it('normalizeDirectTitle 去除首尾成对书名号与引号', () => {
    expect(normalizeDirectTitle('《黑镜》')).toBe('黑镜');
    expect(normalizeDirectTitle('庆余年')).toBe('庆余年');
  });
});
