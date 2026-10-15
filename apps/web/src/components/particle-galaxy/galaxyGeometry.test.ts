import { describe, expect, it } from 'vitest';
import {
  GALAXY_DEFAULTS,
  RAMP_DARK,
  RAMP_LIGHT,
  buildGalaxyGeometry,
  createRng,
  rampFromColors,
  resolveLayerCounts,
  sampleRamp,
  spiralPoint,
  srgbHexToLinear,
  stopsFromHex,
  type GalaxyGeometryConfig,
} from './galaxyGeometry';

function makeConfig(overrides: Partial<GalaxyGeometryConfig> = {}): GalaxyGeometryConfig {
  return {
    starCount: 20000,
    dustCount: Math.round(20000 * (26000 / 90000)),
    bgCount: Math.round(20000 * (2200 / 90000)),
    arms: 3,
    radiusMax: GALAXY_DEFAULTS.radiusMax,
    spin: GALAXY_DEFAULTS.spin,
    armSpread: GALAXY_DEFAULTS.armSpread,
    haloRatio: GALAXY_DEFAULTS.haloRatio,
    thickness: GALAXY_DEFAULTS.thickness,
    tilt: GALAXY_DEFAULTS.tilt,
    coreR: GALAXY_DEFAULTS.coreR,
    seed: GALAXY_DEFAULTS.seed,
    ramp: RAMP_DARK,
    ...overrides,
  };
}

describe('createRng', () => {
  it('固定种子产出可复现序列', () => {
    const a = createRng(20261015);
    const b = createRng(20261015);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('不同种子产出不同序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('gauss 落在 [-1,1] 且均值接近 0', () => {
    const rng = createRng(7);
    let sum = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      const g = rng.gauss();
      expect(g).toBeGreaterThanOrEqual(-1);
      expect(g).toBeLessThanOrEqual(1);
      sum += g;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.02);
  });
});

describe('srgbHexToLinear', () => {
  it('白黑端点', () => {
    expect(srgbHexToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(srgbHexToLinear('#000000')).toEqual([0, 0, 0]);
  });

  it('支持三位简写并做 sRGB→线性转换', () => {
    const short = srgbHexToLinear('#fff');
    expect(short).toEqual([1, 1, 1]);
    const mid = srgbHexToLinear('#808080');
    // 0x80/255 ≈ 0.502 sRGB → 线性 ≈ 0.2158，绝不是直接取原值
    expect(mid[0]).toBeCloseTo(0.2158, 3);
    expect(mid[0]).toBe(mid[1]);
  });

  it('非法输入回落为白色', () => {
    expect(srgbHexToLinear('not-a-color')).toEqual([1, 1, 1]);
  });
});

describe('色带', () => {
  it('端点与参考实现一致：核心白 / 边缘暗紫', () => {
    expect(sampleRamp(RAMP_DARK, 0)).toEqual([1, 1, 1]);
    const edge = sampleRamp(RAMP_DARK, 1);
    const expected = srgbHexToLinear('#2a1a5e');
    edge.forEach((channel, i) => expect(channel).toBeCloseTo(expected[i], 12));
  });

  it('分段线性且单调压暗（t 越大越暗）', () => {
    const luminance = (t: number) => {
      const [r, g, b] = sampleRamp(RAMP_DARK, t);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(luminance(1)).toBeLessThan(luminance(0.5));
    expect(luminance(0.5)).toBeLessThan(luminance(0.05));
  });

  it('越界 t 会被 clamp', () => {
    expect(sampleRamp(RAMP_DARK, -3)).toEqual(sampleRamp(RAMP_DARK, 0));
    expect(sampleRamp(RAMP_DARK, 9)).toEqual(sampleRamp(RAMP_DARK, 1));
  });

  it('浅色色带整体比深色更暗（画在浅底上）', () => {
    const dark = sampleRamp(RAMP_DARK, 0.2);
    const light = sampleRamp(RAMP_LIGHT, 0.2);
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(light)).toBeLessThan(lum(dark));
  });

  it('stopsFromHex 使用参考实现的 0 / 0.10 / 0.38 / 1 停靠点', () => {
    const stops = stopsFromHex(['#ffffff', '#b07cff', '#6b3fd4', '#2a1a5e']);
    expect(stops.map((s) => s.t)).toEqual([0, 0.1, 0.38, 1]);
  });

  it('两色输入 → 四点色带保持端点', () => {
    const stops = rampFromColors(['#ff0000', '#0000ff']);
    expect(stops[0].rgb).toEqual(srgbHexToLinear('#ff0000'));
    expect(stops[3].rgb).toEqual(srgbHexToLinear('#0000ff'));
    expect(stops).toHaveLength(4);
  });
});

describe('resolveLayerCounts', () => {
  it('按参考实现的 90000:26000:2200 派生三层', () => {
    expect(resolveLayerCounts(90000)).toEqual({
      starCount: 90000,
      dustCount: 26000,
      bgCount: 2200,
    });
  });

  it('极小预算不会出现负数或 0 星点', () => {
    const counts = resolveLayerCounts(0);
    expect(counts.starCount).toBe(1);
    expect(counts.dustCount).toBeGreaterThanOrEqual(0);
  });
});

describe('spiralPoint', () => {
  it('半径按幂律偏向中心（中位数远小于 radiusMax）', () => {
    const cfg = makeConfig({ haloRatio: 0 });
    const rng = createRng(11);
    const radii: number[] = [];
    for (let i = 0; i < 4000; i++) radii.push(spiralPoint(rng, i, cfg).r);
    radii.sort((a, b) => a - b);
    const median = radii[Math.floor(radii.length / 2)];
    expect(median).toBeLessThan(cfg.radiusMax * 0.5);
    expect(Math.max(...radii)).toBeLessThanOrEqual(cfg.radiusMax * 1.12);
  });

  it('旋臂按 index % arms 轮转分配基准角', () => {
    const cfg = makeConfig({ arms: 2, armSpread: 0, haloRatio: 0 });
    // 同种子分别取 index 0 / 1：半径与高斯序列完全一致，只剩臂偏移之差
    const a = spiralPoint(createRng(3), 0, cfg);
    const b = spiralPoint(createRng(3), 1, cfg);
    expect(a.r).toBeCloseTo(b.r, 10);
    const angleOf = (p: { x: number; z: number }) => Math.atan2(p.z, p.x);
    let diff = Math.abs(angleOf(a) - angleOf(b));
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    expect(diff).toBeCloseTo(Math.PI, 6);
  });

  it('haloRatio=1 时退化为均匀弥散（角向无臂结构）', () => {
    const cfg = makeConfig({ haloRatio: 1 });
    const rng = createRng(5);
    const radii = Array.from({ length: 2000 }, (_, i) => spiralPoint(rng, i, cfg).r);
    expect(radii.every((r) => r <= cfg.radiusMax + 1e-6)).toBe(true);
  });
});

describe('buildGalaxyGeometry', () => {
  it('同一 seed 完全可复现（"照片"稳定）', () => {
    const cfg = makeConfig({ starCount: 3000, dustCount: 900, bgCount: 200 });
    const first = buildGalaxyGeometry(cfg);
    const second = buildGalaxyGeometry(cfg);
    expect(Array.from(first.stars.position)).toEqual(Array.from(second.stars.position));
    expect(Array.from(first.dust.bright)).toEqual(Array.from(second.dust.bright));
    expect(Array.from(first.bg.position)).toEqual(Array.from(second.bg.position));
  });

  it('不同 seed 产出不同分布', () => {
    const a = buildGalaxyGeometry(makeConfig({ starCount: 500, seed: 1 }));
    const b = buildGalaxyGeometry(makeConfig({ starCount: 500, seed: 2 }));
    expect(Array.from(a.stars.position.slice(0, 30))).not.toEqual(
      Array.from(b.stars.position.slice(0, 30))
    );
  });

  it('三层数组长度自洽且无 NaN/Infinity', () => {
    const geometry = buildGalaxyGeometry(makeConfig({ starCount: 4000, dustCount: 1200, bgCount: 300 }));
    for (const layer of [geometry.stars, geometry.dust, geometry.bg]) {
      expect(layer.position).toHaveLength(layer.count * 3);
      expect(layer.color).toHaveLength(layer.count * 3);
      expect(layer.size).toHaveLength(layer.count);
      expect(layer.bright).toHaveLength(layer.count);
      for (const array of [layer.position, layer.color, layer.size, layer.bright]) {
        for (let i = 0; i < array.length; i++) {
          expect(Number.isFinite(array[i])).toBe(true);
        }
      }
    }
  });

  it('恒星层核球被提亮', () => {
    const cfg = makeConfig({ starCount: 30000, dustCount: 0, bgCount: 0, haloRatio: 0 });
    const { stars } = buildGalaxyGeometry(cfg);
    let coreSum = 0;
    let coreN = 0;
    let edgeSum = 0;
    let edgeN = 0;
    for (let i = 0; i < stars.count; i++) {
      const r = Math.hypot(stars.position[i * 3], stars.position[i * 3 + 2]);
      const b = stars.bright[i];
      if (r < cfg.coreR) {
        coreSum += b;
        coreN += 1;
      } else if (r > cfg.radiusMax * 0.6) {
        edgeSum += b;
        edgeN += 1;
      }
    }
    expect(coreN).toBeGreaterThan(0);
    expect(edgeN).toBeGreaterThan(0);
    expect(coreSum / coreN).toBeGreaterThan(edgeSum / edgeN);
  });

  it('尘埃层大而极淡（尺寸 9~33、亮度 ≤ 0.02）', () => {
    const geometry = buildGalaxyGeometry(makeConfig({ starCount: 1000, dustCount: 3000, bgCount: 10 }));
    const { size, bright } = geometry.dust;
    expect(Math.min(...size)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...size)).toBeLessThan(33);
    expect(Math.max(...bright)).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it('背景深空星位于 900~1600 球壳上', () => {
    const geometry = buildGalaxyGeometry(makeConfig({ starCount: 100, dustCount: 0, bgCount: 500 }));
    const { position } = geometry.bg;
    for (let i = 0; i < geometry.bg.count; i++) {
      const r = Math.hypot(position[i * 3], position[i * 3 + 1], position[i * 3 + 2]);
      expect(r).toBeGreaterThanOrEqual(900);
      expect(r).toBeLessThanOrEqual(1600);
    }
  });

  it('dust=false 时不生成尘埃层', () => {
    const geometry = buildGalaxyGeometry(makeConfig({ dust: false }));
    expect(geometry.dust.count).toBe(0);
  });
});
