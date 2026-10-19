/**
 * SearchResultsCard —— 来源卡片渲染回归
 *
 * 锁定产品目标：工具检索到的**全部链接**按「站点图标 + 标题」逐条展示
 * （不铺简要概述），页脚展示「共 N 篇来源」——数据来自完整 sources 块，
 * 不再受 tool_result 800 字截断影响，条数与列表一致。
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchResultsCard } from './SearchResultsCard';
import type { SearchResultItem } from '@/lib/toolResult';

// jsdom 未实现剪贴板
beforeAll(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

const items: SearchResultItem[] = [
  { title: '标题一', url: 'https://a.com' },
  { title: '标题二', url: 'https://b.com' },
  { title: '标题三' },
];

describe('SearchResultsCard', () => {
  it('渲染全部条数概要，不只第一条', () => {
    render(<SearchResultsCard results={items} source="deepseek" raw="{}" />);
    expect(screen.getByText('标题一')).toBeTruthy();
    expect(screen.getByText('标题二')).toBeTruthy();
    expect(screen.getByText('标题三')).toBeTruthy();
    expect(screen.getByText('deepseek · 共 3 篇来源')).toBeTruthy();
  });

  it('只展示图标 + 标题，不渲染简要概述', () => {
    const { container } = render(
      <SearchResultsCard
        results={[{ title: '标题一', url: 'https://a.com', snippet: '这是一段摘要' }]}
        source="deepseek"
        raw="{}"
      />,
    );
    expect(screen.getByText('标题一')).toBeTruthy();
    expect(screen.queryByText('这是一段摘要')).toBeNull();
    expect(container.querySelector('.tao-source-snippet')).toBeNull();
  });

  it('标题可点击跳转原文；无 URL 的条目不渲染链接', () => {
    render(<SearchResultsCard results={items} source="deepseek" raw="{}" />);
    const link = screen.getByText('标题一').closest('a');
    expect(link?.getAttribute('href')).toBe('https://a.com');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('标题三').closest('a')).toBeNull();
  });

  it('原始数据默认收起，点击后展开', () => {
    render(<SearchResultsCard results={items} source="deepseek" raw='{"raw":true}' />);
    const toggle = screen.getByText('原始数据').closest('button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('{"raw":true}')).toBeTruthy();
  });

  it('缺 source 时只展示条数概要', () => {
    render(<SearchResultsCard results={items} raw="{}" />);
    expect(screen.getByText('共 3 篇来源')).toBeTruthy();
  });

  it('较多条目（如 30 条）也全部渲染，计数一致', () => {
    const many: SearchResultItem[] = Array.from({ length: 30 }, (_, i) => ({
      title: `来源 ${i + 1}`,
      url: `https://example.com/${i + 1}`,
    }));
    render(<SearchResultsCard results={many} source="deepseek" raw="{}" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(30);
    expect(screen.getByText('deepseek · 共 30 篇来源')).toBeTruthy();
  });
});
