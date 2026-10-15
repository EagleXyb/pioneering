/**
 * ParticleGalaxy 几何生成 —— 纯函数 + 固定随机种子，可单测。
 *
 * 算法逐行转译自参考实现「螺旋星系 · 静态单帧」：
 *   对数螺旋 θ = ln(1 + r·K) · 系数  →  旋臂走向
 *   半径幂律 pow(rnd, 1.5|1.7)·R      →  向心聚集（越靠中心越密）
 *   近似高斯散布 gauss()·spread       →  旋臂横向/径向发散，外松内紧
 *   haloRatio 弥散晕                  →  臂间填充 + 外围稀疏
 *   exp(-r/0.45R) 指数盘厚度          →  中心鼓、边缘薄
 *
 * 三层几何：
 *   stars 小而锐（软边指数 2.2）—— "星点"
 *   dust  大而极淡（软边指数 1.4）—— 旋臂"紫雾"
 *   bg    球壳深空星（半径 900~1600）—— 空间纵深
 *
 * 坐标单位与世界尺度完全沿用参考实现（radiusMax = 100），由渲染器的相机
 * fit 逻辑映射到容器尺寸；颜色一律为 sRGB→线性（linear working space），
 * 与参考实现中 THREE.ColorManagement 的 hex 解析行为一致。
 */

/** 线性色彩空间 RGB（0..1），sRGB hex 解析后所得 */
export type LinearRgb = [number, number, number];

/** 色带停靠点（t 升序，与参考实现 ramp() 的分段线性等价） */
export interface RampStop {
  t: number;
  rgb: LinearRgb;
}

export interface GalaxyGeometryConfig {
  /** 恒星层粒子数（"星点"） */
  starCount: number;
  /** 尘埃层粒子数（"紫雾"） */
  dustCount: number;
  /** 背景深空星数 */
  bgCount: number;
  /** 旋臂数量 */
  arms: number;
  /** 星系盘半径（世界单位） */
  radiusMax: number;
  /** 螺旋卷曲系数（越大卷越紧） */
  spin: number;
  /** 旋臂横向散布 */
  armSpread: number;
  /** 弥散晕粒子占比（臂间填充） */
  haloRatio: number;
  /** 盘中心厚度 */
  thickness: number;
  /** 厚度方向压缩（参考实现的 tilt） */
  tilt: number;
  /** 亮核增强半径 */
  coreR: number;
  /** 随机种子（固定 → 每次渲染同一张"照片"） */
  seed: number;
  /** 颜色梯度（核心 → 边缘） */
  ramp: RampStop[];
  /** 尘埃层亮度倍数（浅色 normal 混合下需略抬高，否则被底色吞掉） */
  dustBoost?: number;
  /** 是否生成尘埃层 */
  dust?: boolean;
}

export interface PointLayerData {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  bright: Float32Array;
  count: number;
  /** 片元软边指数（越大越"点"、越小越"雾"） */
  soft: number;
  /** 该层允许的最大设备像素比（尘埃层限 2 以控制填充率） */
  prCap: number;
}

export interface GalaxyGeometry {
  stars: PointLayerData;
  dust: PointLayerData;
  bg: PointLayerData;
}

/* ---------------------------------------------------------------- 随机数 */

export interface Rng {
  /** [0,1) 均匀分布 */
  next: () => number;
  /** 近似高斯 [-1,1]：6 个均匀分布之和（参考实现同款） */
  gauss: () => number;
}

/** 线性同余发生器：固定种子 → 可复现的"照片" */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const gauss = () => {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += next();
    return (sum - 3) / 3;
  };
  return { next, gauss };
}

/* ------------------------------------------------------------------ 颜色 */

/** sRGB hex → 线性 RGB（与 THREE.Color(hex) 的 sRGB→linear 一致） */
export function srgbHexToLinear(hex: string): LinearRgb {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  const toLinear = (v: number) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return [
    toLinear(((n >> 16) & 255) / 255),
    toLinear(((n >> 8) & 255) / 255),
    toLinear((n & 255) / 255),
  ];
}

const RAMP_T = [0, 0.1, 0.38, 1] as const;

/** 深色主题色带：亮核白 → 紫 → 蓝紫 → 边缘暗紫（参考实现原值） */
const RAMP_DARK_HEX = ['#ffffff', '#b07cff', '#6b3fd4', '#2a1a5e'] as const;
/**
 * 浅色主题色带：深紫 → 紫 → 亮紫 → 淡紫。
 * 整体刻意压暗一档：normal 混合下多层尘埃会收敛到粒子自身颜色，色带越浅
 * 叠加后越接近白，再叠加页面浅底就会糊成"白云"而不是紫雾。
 */
const RAMP_LIGHT_HEX = ['#3f0f86', '#5b21b6', '#7c3aed', '#a78bfa'] as const;

export function stopsFromHex(hexes: readonly string[], positions: readonly number[] = RAMP_T): RampStop[] {
  return hexes.map((hex, i) => ({
    t: positions[Math.min(i, positions.length - 1)] ?? i / Math.max(1, hexes.length - 1),
    rgb: srgbHexToLinear(hex),
  }));
}

export const RAMP_DARK: RampStop[] = stopsFromHex(RAMP_DARK_HEX);
export const RAMP_LIGHT: RampStop[] = stopsFromHex(RAMP_LIGHT_HEX);

function mixLinear(a: LinearRgb, b: LinearRgb, k: number): LinearRgb {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** 两色 → 四点色带（保留旧 `colors` prop 语义：核心色 / 悬臂末端色） */
export function rampFromColors(colors: [string, string]): RampStop[] {
  const core = srgbHexToLinear(colors[0]);
  const edge = srgbHexToLinear(colors[1]);
  return [
    { t: RAMP_T[0], rgb: core },
    { t: RAMP_T[1], rgb: mixLinear(core, edge, 0.45) },
    { t: RAMP_T[2], rgb: mixLinear(core, edge, 0.78) },
    { t: RAMP_T[3], rgb: edge },
  ];
}

/** 分段线性采样色带（t 会被 clamp 到 [0,1]） */
export function sampleRamp(ramp: RampStop[], t: number): LinearRgb {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < ramp.length - 1; i++) {
    const a = ramp[i];
    const b = ramp[i + 1];
    if (x <= b.t) {
      const span = b.t - a.t;
      const k = span <= 0 ? 0 : (x - a.t) / span;
      return mixLinear(a.rgb, b.rgb, k);
    }
  }
  return ramp.length ? ([...ramp[ramp.length - 1].rgb] as LinearRgb) : [1, 1, 1];
}

/* ------------------------------------------------------------ 螺旋采样器 */

/** 对数螺旋系数：θ += ln(1 + r·K) */
const SPIRAL_R_K = 0.55;
/** 螺旋缠绕系数分子：θ += ln(1 + r·K) · TWIST/(spin·10) */
const SPIRAL_TWIST = 1.15;

export interface SpiralPoint {
  x: number;
  y: number;
  z: number;
  /** 距星系中心的半径 */
  r: number;
  /** 归一化半径 0..1 */
  t: number;
}

interface SpiralOptions {
  dust?: boolean;
  spreadMul?: number;
  thickMul?: number;
}

/**
 * 生成一个粒子的三维位置。**随机数消耗顺序与参考实现严格一致**，
 * 以保证同一 seed 下产出完全相同的分布。
 */
export function spiralPoint(
  rng: Rng,
  index: number,
  cfg: GalaxyGeometryConfig,
  opt: SpiralOptions = {}
): SpiralPoint {
  const armOff = ((index % cfg.arms) / cfg.arms) * Math.PI * 2;

  // 半径：幂次分布 → 越靠近中心越密
  const r = Math.pow(rng.next(), opt.dust ? 1.7 : 1.5) * cfg.radiusMax + 0.4;

  // 对数螺旋 θ = ln(1 + r·K)·c
  let ang = armOff + Math.log(1 + r * SPIRAL_R_K) * (SPIRAL_TWIST / (cfg.spin * 10));
  let rr = r;

  // 旋臂横向/径向散布：越往外越松散
  const spread = (opt.spreadMul ?? 1) * cfg.armSpread * (0.1 + (0.9 * r) / cfg.radiusMax);
  ang += rng.gauss() * spread * 0.55;
  rr = Math.max(r + rng.gauss() * spread * r * 0.16, 0.2);

  // 弥散晕（臂间填充 + 外围稀疏）
  if (rng.next() < cfg.haloRatio) {
    ang = rng.next() * Math.PI * 2;
    rr = Math.pow(rng.next(), 0.8) * cfg.radiusMax;
  }

  // 盘厚度：中心鼓、边缘薄
  const th = cfg.thickness * Math.exp(-rr / (cfg.radiusMax * 0.45)) + 0.35;
  const y = rng.gauss() * th * (opt.thickMul ?? 1) * cfg.tilt;

  return { x: Math.cos(ang) * rr, y, z: Math.sin(ang) * rr, r: rr, t: rr / cfg.radiusMax };
}

/* -------------------------------------------------------------- 三层构建 */

/** 恒星层：小而锐，核球提亮，零星亮星 */
export function buildStars(rng: Rng, cfg: GalaxyGeometryConfig): PointLayerData {
  const n = Math.max(0, cfg.starCount);
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const bright = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const p = spiralPoint(rng, i, cfg);
    const i3 = i * 3;
    position[i3] = p.x;
    position[i3 + 1] = p.y;
    position[i3 + 2] = p.z;

    let b = (1 - p.t * 0.5) * (0.28 + rng.next() * 0.65);
    if (rng.next() < 0.012) b *= 2.2; // 零星亮星
    if (p.r < cfg.coreR) b *= 1 + (1 - p.r / cfg.coreR) * 1.6; // 核球提亮
    bright[i] = Math.min(b, 2.4);

    const c = sampleRamp(cfg.ramp, p.t);
    color[i3] = c[0];
    color[i3 + 1] = c[1];
    color[i3 + 2] = c[2];

    size[i] = (p.r < cfg.coreR ? 0.9 : 1.05 + rng.next() * 1.5) * (1 + (1 - p.t) * 0.5);
  }

  return { position, color, size, bright, count: n, soft: 2.2, prCap: 3 };
}

/** 尘埃层：大柔光斑 + 极低亮度，加法叠加成旋臂"雾" */
export function buildDust(rng: Rng, cfg: GalaxyGeometryConfig): PointLayerData {
  const n = Math.max(0, cfg.dustCount);
  const boost = cfg.dustBoost ?? 1;
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const bright = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const p = spiralPoint(rng, i, cfg, { dust: true, spreadMul: 1.25, thickMul: 1.5 });
    const i3 = i * 3;
    position[i3] = p.x;
    position[i3 + 1] = p.y;
    position[i3 + 2] = p.z;

    const c = sampleRamp(cfg.ramp, Math.min(p.t * 1.05, 1));
    color[i3] = c[0];
    color[i3 + 1] = c[1];
    color[i3 + 2] = c[2];

    size[i] = 9 + rng.next() * 24;
    bright[i] = (0.006 + rng.next() * 0.014) * boost;
  }

  return { position, color, size, bright, count: n, soft: 1.4, prCap: 2 };
}

/** 背景深空星：半径 900~1600 球壳均匀采样，冷白偏蓝 */
export function buildBackdrop(rng: Rng, cfg: GalaxyGeometryConfig): PointLayerData {
  const n = Math.max(0, cfg.bgCount);
  const position = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const bright = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const R = 900 + rng.next() * 700;
    const th = rng.next() * Math.PI * 2;
    const ph = Math.acos(2 * rng.next() - 1);
    const i3 = i * 3;
    position[i3] = R * Math.sin(ph) * Math.cos(th);
    position[i3 + 1] = R * Math.cos(ph);
    position[i3 + 2] = R * Math.sin(ph) * Math.sin(th);

    const w = 0.7 + rng.next() * 0.3;
    color[i3] = w;
    color[i3 + 1] = w;
    color[i3 + 2] = w * (0.9 + rng.next() * 0.1);

    size[i] = 0.5 + rng.next() * 1.1;
    bright[i] = 0.25 + rng.next() * 0.55;
  }

  return { position, color, size, bright, count: n, soft: 2.6, prCap: 3 };
}

/* -------------------------------------------------------------------- 入口 */

/**
 * 星点预算拆分：参考实现的 90000 / 26000 / 2200 三层比例。
 * `total` 为恒星层数量，尘埃与背景星按比例派生。
 */
export function resolveLayerCounts(total: number): {
  starCount: number;
  dustCount: number;
  bgCount: number;
} {
  const starCount = Math.max(1, Math.round(total));
  return {
    starCount,
    dustCount: Math.max(0, Math.round(starCount * (26000 / 90000))),
    bgCount: Math.max(0, Math.round(starCount * (2200 / 90000))),
  };
}

export function buildGalaxyGeometry(cfg: GalaxyGeometryConfig): GalaxyGeometry {
  const rng = createRng(cfg.seed);
  return {
    stars: buildStars(rng, cfg),
    dust: cfg.dust === false ? emptyLayer(1.4, 2) : buildDust(rng, cfg),
    bg: buildBackdrop(rng, cfg),
  };
}

function emptyLayer(soft: number, prCap: number): PointLayerData {
  return {
    position: new Float32Array(0),
    color: new Float32Array(0),
    size: new Float32Array(0),
    bright: new Float32Array(0),
    count: 0,
    soft,
    prCap,
  };
}

/** 参考实现的默认参数表（CFG），供组件默认值复用 */
export const GALAXY_DEFAULTS = {
  radiusMax: 100,
  spin: 0.055,
  armSpread: 0.25,
  haloRatio: 0.08,
  thickness: 3.2,
  tilt: 0.62,
  coreR: 7,
  pointK: 500,
  fov: 35,
  camElev: 42,
  bloomStrength: 1.1,
  bloomRadius: 0.72,
  bloomThreshold: 0.22,
  exposure: 1.22,
  seed: 20261015,
  /** gl_PointSize 公式中 uK 的标定参考视口高度（CSS px） */
  refHeight: 950,
} as const;
