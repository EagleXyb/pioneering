import { describe, it, expect } from 'vitest';
import { formatMessageTime } from './formatTime';

/** 固定"现在"：2026-10-10 15:30（本地时区） */
const NOW = new Date(2026, 9, 10, 15, 30, 0);

function iso(y: number, m: number, d: number, h: number, min: number): string {
  return new Date(y, m - 1, d, h, min, 0).toISOString();
}

describe('formatMessageTime', () => {
  it('今天：仅显示时:分（补零）', () => {
    expect(formatMessageTime(iso(2026, 10, 10, 9, 5), NOW)).toBe('09:05');
    expect(formatMessageTime(iso(2026, 10, 10, 23, 59), NOW)).toBe('23:59');
  });

  it('昨天：前缀"昨天"', () => {
    expect(formatMessageTime(iso(2026, 10, 9, 17, 26), NOW)).toBe('昨天 17:26');
  });

  it('今年更早：月日 + 时:分', () => {
    expect(formatMessageTime(iso(2026, 9, 29, 17, 26), NOW)).toBe('9月29日 17:26');
    expect(formatMessageTime(iso(2026, 1, 3, 8, 0), NOW)).toBe('1月3日 08:00');
  });

  it('跨年：补全年份', () => {
    expect(formatMessageTime(iso(2025, 12, 31, 23, 0), NOW)).toBe('2025年12月31日 23:00');
  });

  it('空值 / 非法值返回空字符串（不抛错）', () => {
    expect(formatMessageTime(undefined, NOW)).toBe('');
    expect(formatMessageTime(null, NOW)).toBe('');
    expect(formatMessageTime('not-a-date', NOW)).toBe('');
  });

  it('跨天边界：当天 00:00 视为今天，前一天 23:59 视为昨天', () => {
    expect(formatMessageTime(iso(2026, 10, 10, 0, 0), NOW)).toBe('00:00');
    expect(formatMessageTime(iso(2026, 10, 9, 23, 59), NOW)).toBe('昨天 23:59');
  });
});
