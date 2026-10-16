import { describe, expect, it } from 'vitest';

import { buildStarfieldStyle } from './starfield';

describe('buildStarfieldStyle', () => {
  it('按图层生成等量的渐变与平铺尺寸', () => {
    const style = buildStarfieldStyle({
      layers: [
        { tile: 100, count: 5, minAlpha: 0.2, maxAlpha: 0.5, brightRatio: 0 },
        { tile: 200, count: 7, minAlpha: 0.1, maxAlpha: 0.3, brightRatio: 0 },
      ],
    });

    expect(style.backgroundImage.split('radial-gradient').length - 1).toBe(12);
    expect(style.backgroundSize).toBe('100px 100px,200px 200px');
  });

  it('固定种子 → 输出完全可复现', () => {
    expect(buildStarfieldStyle()).toEqual(buildStarfieldStyle());
  });

  it('不同种子 → 输出不同', () => {
    expect(buildStarfieldStyle({ seed: 1 }).backgroundImage).not.toBe(
      buildStarfieldStyle({ seed: 2 }).backgroundImage,
    );
  });

  it('density 只缩放星点数量，不改平铺尺寸与亮度区间', () => {
    const count = (style: { backgroundImage: string }) =>
      style.backgroundImage.split('radial-gradient').length - 1;

    const low = buildStarfieldStyle({ density: 0.4 });
    const high = buildStarfieldStyle({ density: 1.8 });
    const base = buildStarfieldStyle();

    expect(count(low)).toBeLessThan(count(base));
    expect(count(high)).toBeGreaterThan(count(base));
    expect(low.backgroundSize).toBe(base.backgroundSize);
    expect(high.backgroundSize).toBe(base.backgroundSize);

    // density = 0 → 不生成任何星点（但仍保留图层平铺尺寸为空串）
    expect(buildStarfieldStyle({ density: 0 }).backgroundImage).toBe('');
  });

  it('星点落在 3%~97% 安全边距内（避免平铺裁半颗产生接缝）', () => {
    const style = buildStarfieldStyle();
    const coords = [...style.backgroundImage.matchAll(/at ([\d.]+)% ([\d.]+)%/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);

    expect(coords.length).toBeGreaterThan(100);
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(3);
      expect(x).toBeLessThanOrEqual(97);
      expect(y).toBeGreaterThanOrEqual(3);
      expect(y).toBeLessThanOrEqual(97);
    }
  });

  it('亮度落在图层设定的 alpha 区间内', () => {
    const style = buildStarfieldStyle({
      layers: [{ tile: 120, count: 20, minAlpha: 0.3, maxAlpha: 0.3, brightRatio: 0 }],
    });
    const alphas = [...style.backgroundImage.matchAll(/rgba\(\d+,\d+,\d+,([\d.]+)\) 0 /g)].map(
      (m) => Number(m[1]),
    );

    expect(alphas).toHaveLength(20);
    for (const a of alphas) expect(a).toBeCloseTo(0.3, 1);
  });

  it('亮星（brightRatio=1）额外带光晕停靠点', () => {
    const style = buildStarfieldStyle({
      layers: [{ tile: 120, count: 3, minAlpha: 0.5, maxAlpha: 0.5, brightRatio: 1 }],
    });

    expect(style.backgroundImage).toContain('2.4px');
  });

  it('count<=0 或 tile<=0 的图层被跳过', () => {
    const style = buildStarfieldStyle({
      layers: [
        { tile: 100, count: 0, minAlpha: 0.2, maxAlpha: 0.4, brightRatio: 0 },
        { tile: 0, count: 5, minAlpha: 0.2, maxAlpha: 0.4, brightRatio: 0 },
      ],
    });

    expect(style.backgroundImage).toBe('');
    expect(style.backgroundSize).toBe('');
  });
});
