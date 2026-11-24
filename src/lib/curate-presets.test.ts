import { describe, expect, it } from 'vitest';
import {
  buildScreeningTimes,
  extractQueryKeywords,
  isValidHexColor,
  matchCuratePreset,
} from './curate-presets';

describe('curate-presets', () => {
  it('matches themed presets by query keywords', () => {
    expect(matchCuratePreset('想看一部深夜看完不想说话的雨夜片').id).toBe('rain-emo');
    expect(matchCuratePreset('像黑镜一样细思极恐的烧脑反转剧').id).toBe('midnight-twist');
    expect(matchCuratePreset('周末吃外卖看的轻喜剧下饭片').id).toBe('weekend-chill');
    expect(matchCuratePreset('复古港风经典佳片').id).toBe('film-warmth');
  });

  it('extracts concise keywords from user wish', () => {
    const kws = extractQueryKeywords('雨夜、爵士乐与孤独灵魂的文艺片');
    expect(kws.length).toBeGreaterThanOrEqual(2);
    expect(kws).toContain('孤独');
  });

  it('generates formatted HH:MM screening times', () => {
    const times = buildScreeningTimes(5, new Date('2026-11-24T14:00:00'));
    expect(times).toHaveLength(5);
    expect(times[0]).toBe('19:30');
    for (const t of times) {
      expect(t).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('validates 6-digit hex colors', () => {
    expect(isValidHexColor('#5ea8ff')).toBe(true);
    expect(isValidHexColor('#fff')).toBe(false);
    expect(isValidHexColor('blue')).toBe(false);
  });
});
