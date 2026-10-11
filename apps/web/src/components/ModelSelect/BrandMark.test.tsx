import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BrandMark } from './BrandMark';

/** 渲染并取根节点 svg；size 缺省时走组件默认值 */
function renderMark(id: string, size?: number) {
  const { container } = render(
    <BrandMark id={id} {...(size === undefined ? {} : { size })} />,
  );
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('BrandMark 未渲染出 svg');
  return { svg, container };
}

/** 覆盖三个图形分支：品牌前缀命中 + 未登记回退 */
const ALL_BRANCHES = ['deepseek-v4-flash', 'gpt-4o-mini', 'some-unknown-model'];

describe('BrandMark', () => {
  it('三分支统一使用 48 画板与 1/12 相对描边（视觉重量一致）', () => {
    for (const id of ALL_BRANCHES) {
      const { svg } = renderMark(id);
      expect(svg.getAttribute('viewBox'), id).toBe('0 0 48 48');
      expect(svg.getAttribute('stroke-width'), id).toBe('4');
      expect(svg.getAttribute('stroke'), id).toBe('currentColor');
      expect(svg.getAttribute('fill'), id).toBe('none');
    }
  });

  it('按前缀匹配品牌，未登记 id 回退到通用标识', () => {
    expect(renderMark('deepseek-v4-flash').svg.querySelectorAll('path')).toHaveLength(3);
    expect(renderMark('gpt-4o').svg.querySelectorAll('path')).toHaveLength(2);
    expect(renderMark('claude-x').svg.querySelectorAll('path')).toHaveLength(2);
  });

  it('眼睛为 currentColor 实心点，不依赖容器底色（无 --bg-card 挖空）', () => {
    const { svg, container } = renderMark('deepseek-v4-flash');
    const eye = svg.querySelector('circle');
    expect(eye).not.toBeNull();
    expect(eye!.getAttribute('fill')).toBe('currentColor');
    expect(eye!.getAttribute('stroke')).toBe('none');
    expect(container.innerHTML).not.toContain('--bg-card');
  });

  it('DeepSeek 图形做整体平移，使墨迹居中于画板', () => {
    const { svg } = renderMark('deepseek-v4-flash');
    expect(svg.querySelector('g')?.getAttribute('transform')).toBe(
      'translate(-3.75 2.65)',
    );
    // GPT 图形本身已居中，不应有多余变换
    expect(renderMark('gpt-4o').svg.querySelector('g')).toBeNull();
  });

  it('默认渲染 20px，size 可覆盖', () => {
    const { svg } = renderMark('deepseek-v4-flash');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');

    const { svg: big } = renderMark('deepseek-v4-flash', 32);
    expect(big.getAttribute('width')).toBe('32');
    expect(big.getAttribute('height')).toBe('32');
  });

  it('装饰性图标：对无障碍树隐藏', () => {
    expect(renderMark('gpt-4o').svg.getAttribute('aria-hidden')).toBe('true');
  });
});
