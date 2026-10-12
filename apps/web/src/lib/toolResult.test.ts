/**
 * toolResult 单元测试 —— 工具观测 → 结构化搜索结果（WorkBuddy 风格来源卡片的数据层）
 *
 * 重点锁定两件事：
 * 1. agent 通道 search_engine 的 {tool,status,data:{results,source}} 口径能正确解析；
 * 2. 持久化/下发链路会把观测截断（800 字符 slice 或 "...[truncated]"），
 *    截断后仍要尽量保住已完整到达的结果条目，而不是整块退化为原始 JSON。
 */
import { describe, it, expect } from 'vitest';
import { parseSearchToolResult, resultDomain } from './toolResult';

const A = { title: 'A', url: 'https://a.com', snippet: 'x'.repeat(50) };
const B = { title: 'B', url: 'https://b.com', snippet: 'y'.repeat(50) };

function fullResultJson(): string {
  return JSON.stringify({
    tool: 'search_engine',
    status: 'success',
    data: { results: [A, B], source: 'bing' },
  });
}

/** 在 B 对象内部截断（A 完整、B 被腰斩） */
function cutInsideB(): string {
  const full = fullResultJson();
  return full.slice(0, full.indexOf('{"title":"B"') + 12);
}

describe('parseSearchToolResult', () => {
  it('解析 {tool,status,data:{results,source}} 口径', () => {
    const parsed = parseSearchToolResult(fullResultJson());
    expect(parsed?.kind).toBe('search');
    expect(parsed?.results.map((r) => r.title)).toEqual(['A', 'B']);
    expect(parsed?.results[0]?.url).toBe('https://a.com');
    expect(parsed?.source).toBe('bing');
  });

  it('兼容裸 {results:[...]} 口径', () => {
    const parsed = parseSearchToolResult(
      JSON.stringify({ results: [{ title: '独立结果' }], source: 'tavily' }),
    );
    expect(parsed?.results).toHaveLength(1);
    expect(parsed?.source).toBe('tavily');
  });

  it('硬截断（JSON 不完整）时挽救已完整的条目', () => {
    const parsed = parseSearchToolResult(cutInsideB());
    expect(parsed?.results.map((r) => r.title)).toEqual(['A']);
  });

  it('带 "...[truncated]" 标记的截断结果同样可挽救', () => {
    const parsed = parseSearchToolResult(`${cutInsideB()}...[truncated]`);
    expect(parsed?.results.map((r) => r.title)).toEqual(['A']);
  });

  it('单条结果也被腰斩时返回 null（由调用方回退原始 JSON）', () => {
    const full = fullResultJson();
    expect(parseSearchToolResult(full.slice(0, 90))).toBeNull();
  });

  it('非搜索类观测返回 null', () => {
    expect(
      parseSearchToolResult(JSON.stringify({ tool: 'read_file', status: 'success', data: { content: 'hi' } })),
    ).toBeNull();
    expect(parseSearchToolResult('plain text')).toBeNull();
    expect(parseSearchToolResult('')).toBeNull();
    expect(parseSearchToolResult(undefined)).toBeNull();
  });

  it('结果项缺 title 时被丢弃', () => {
    const parsed = parseSearchToolResult(
      JSON.stringify({ data: { results: [{ url: 'https://x.com' }, { title: '有效' }] } }),
    );
    expect(parsed?.results.map((r) => r.title)).toEqual(['有效']);
  });
});

describe('resultDomain', () => {
  it('提取站点域名并去掉 www 前缀', () => {
    expect(resultDomain('https://www.example.com/a/b?c=1')).toBe('example.com');
    expect(resultDomain('not-a-url')).toBe('');
    expect(resultDomain(undefined)).toBe('');
  });
});
