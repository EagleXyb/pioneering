import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MODE_ICONS } from './modeIcons';
import { EmptyStateGlyph, type EmptyStateVariant } from './emptyStateGlyph';
import {
  ReplayRotateIcon,
  ShareForwardIcon,
  StepStatusGlyph,
  ThinkingIcon,
  type StepStatus,
} from './customIcons';

function renderSvg(node: React.ReactElement) {
  const { container } = render(node);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('未渲染出 svg');
  return svg;
}

describe('MODE_ICONS', () => {
  it('三种模式各有一个互不相同的图标', () => {
    expect(Object.keys(MODE_ICONS).sort()).toEqual(['chat', 'pro', 'task']);
    expect(new Set(Object.values(MODE_ICONS)).size).toBe(3);
  });
});

describe('EmptyStateGlyph', () => {
  const VARIANTS: EmptyStateVariant[] = ['chat', 'pro', 'task', 'process', 'error'];

  it('默认 48px / strokeWidth 1.2，且对无障碍树隐藏', () => {
    for (const variant of VARIANTS) {
      const svg = renderSvg(<EmptyStateGlyph variant={variant} />);
      expect(svg.getAttribute('width'), variant).toBe('48');
      expect(svg.getAttribute('height'), variant).toBe('48');
      expect(svg.getAttribute('stroke-width'), variant).toBe('1.2');
      expect(svg.getAttribute('aria-hidden'), variant).toBe('true');
    }
  });

  it('各变体是不同图形（同一模式图标在空态与侧栏保持一致）', () => {
    const markup = VARIANTS.map(
      (v) => render(<EmptyStateGlyph variant={v} />).container.innerHTML,
    );
    expect(new Set(markup).size).toBe(VARIANTS.length);
  });

  it('size 与 className 可覆盖', () => {
    const svg = renderSvg(
      <EmptyStateGlyph variant="process" size={32} className="process-empty-glyph" />,
    );
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('class')).toContain('process-empty-glyph');
  });
});

describe('StepStatusGlyph', () => {
  const STATUSES: StepStatus[] = ['done', 'failed', 'skipped'];

  it('默认 8px，使用 14 画板与 strokeWidth 2（小尺寸下的线宽标定）', () => {
    for (const status of STATUSES) {
      const svg = renderSvg(<StepStatusGlyph status={status} />);
      expect(svg.getAttribute('width'), status).toBe('8');
      expect(svg.getAttribute('viewBox'), status).toBe('0 0 14 14');
      expect(svg.getAttribute('stroke-width'), status).toBe('2');
    }
  });

  it('三种状态图形互不相同；size 可覆盖', () => {
    const markup = STATUSES.map(
      (s) => render(<StepStatusGlyph status={s} />).container.innerHTML,
    );
    expect(new Set(markup).size).toBe(3);
    expect(renderSvg(<StepStatusGlyph status="done" size={12} />).getAttribute('width')).toBe(
      '12',
    );
  });
});

describe('操作栏自绘图标', () => {
  it('默认 15px、strokeWidth 2，圆角线帽，className 透传', () => {
    for (const Icon of [ShareForwardIcon, ReplayRotateIcon]) {
      const svg = renderSvg(<Icon />);
      expect(svg.getAttribute('width')).toBe('15');
      expect(svg.getAttribute('stroke-width')).toBe('2');
      expect(svg.getAttribute('stroke-linecap')).toBe('round');
      expect(svg.getAttribute('stroke-linejoin')).toBe('round');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
    expect(
      renderSvg(<ShareForwardIcon size={18} className="chat-action-icon" />).getAttribute(
        'class',
      ),
    ).toBe('chat-action-icon');
  });

  it('思考标识固定 19px，实心瞳孔用 currentColor（不依赖底色）', () => {
    const svg = renderSvg(<ThinkingIcon className="chat-reasoning-icon" />);
    expect(svg.getAttribute('width')).toBe('19');
    const pupil = svg.querySelector('circle');
    expect(pupil?.getAttribute('fill')).toBe('currentColor');
  });

  it('四瓣花墨迹与 lucide 同口径（盒内边距恰好 1/24，图标间距才能统一）', () => {
    const svg = renderSvg(<ThinkingIcon className="tao-reasoning-icon" />);
    const ellipse = svg.querySelector('ellipse');
    const rx = Number(ellipse?.getAttribute('rx'));
    const ry = Number(ellipse?.getAttribute('ry'));
    const stroke = Number(svg.getAttribute('stroke-width'));
    // 45° 旋转后的包围半宽 = sqrt((rx² + ry²) / 2) + 半个描边宽度
    const halfExtent = Math.sqrt((rx ** 2 + ry ** 2) / 2) + stroke / 2;
    // lucide 图标（circle r=10 + stroke 2）墨迹外缘距盒子边缘 1/24：
    // 偏小 → 与地球同盒时笔画内缩，看起来"没左对齐"、图标↔文字间距也偏大
    expect(12 - halfExtent).toBeCloseTo(1, 1);
  });
});
