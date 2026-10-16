/**
 * starfield —— 星空底纹生成（纯函数，固定种子可复现）
 *
 * 输出可直接挂到元素 style 上的多层 CSS 背景：
 *   backgroundImage: 逗号分隔的多条 radial-gradient（每颗星一条）
 *   backgroundSize:  与图层一一对应的平铺尺寸
 *
 * 为什么用 CSS 而不是 WebGL：
 *   星空是静态、无交互、无透视的装饰，不需要每帧渲染，也不需要 FBO 链
 *   （全屏 WebGL 星场的 RGBA16F scene + 两级 bloom 在 1920×1080@3x 下
 *     仅中间缓冲就接近 240MB）。CSS 多层渐变零显存、任意 DPR 自适应。
 *
 * 每颗星用「硬边渐变」模拟 1px 锐点：
 *   radial-gradient(circle at x% y%, rgba(...) 0 0.45px, transparent 0.6px)
 * 少量「亮星」额外带一圈微弱光晕，模拟大气/镜头衍射。
 */

/** 单个图层的参数 */
export interface StarLayerOptions {
  /** 平铺边长（CSS px），越大越稀疏 */
  tile: number;
  /** 该层星点数 */
  count: number;
  /** 亮度区间 */
  minAlpha: number;
  maxAlpha: number;
  /** 亮星（带光晕）占比 0..1 */
  brightRatio: number;
}

export interface StarfieldOptions {
  /** 随机种子（固定 → 每次刷新星图一致） */
  seed?: number;
  /** 图层定义，默认三层（近/中/远） */
  layers?: StarLayerOptions[];
  /** 星点密度倍率（1 = 默认三层共约 140 颗） */
  density?: number;
}

export interface StarfieldStyle {
  backgroundImage: string;
  backgroundSize: string;
}

/** 星点色（冷白为主，少量暖白与蓝白，避免纯灰的「胶片灰」） */
const STAR_COLORS = ['255,255,255', '226,236,255', '255,244,226'] as const;

/** 留出 3% 安全边距：贴边星点会被平铺裁掉半颗，形成可见接缝 */
const EDGE_MARGIN = 3;

const DEFAULT_LAYERS: StarLayerOptions[] = [
  { tile: 260, count: 34, minAlpha: 0.5, maxAlpha: 1, brightRatio: 0.14 },
  { tile: 420, count: 46, minAlpha: 0.28, maxAlpha: 0.62, brightRatio: 0.1 },
  { tile: 700, count: 58, minAlpha: 0.14, maxAlpha: 0.36, brightRatio: 0.06 },
];

/** 线性同余发生器（与 particle-galaxy 同款，便于统一理解与复现） */
function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function round(value: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

/** 生成一条星点渐变；bright=true 时附带一圈微弱光晕 */
function starGradient(rng: () => number, layer: StarLayerOptions, bright: boolean): string {
  const x = round(EDGE_MARGIN + rng() * (100 - EDGE_MARGIN * 2));
  const y = round(EDGE_MARGIN + rng() * (100 - EDGE_MARGIN * 2));
  const color = STAR_COLORS[Math.min(STAR_COLORS.length - 1, Math.floor(rng() * STAR_COLORS.length))];
  const alpha = round(layer.minAlpha + rng() * (layer.maxAlpha - layer.minAlpha));
  if (bright) {
    return (
      `radial-gradient(circle at ${x}% ${y}%,` +
      ` rgba(${color},${alpha}) 0 0.7px,` +
      ` rgba(${color},${round(alpha * 0.22)}) 0.8px 2.4px,` +
      ` rgba(${color},0) 2.6px)`
    );
  }
  return `radial-gradient(circle at ${x}% ${y}%, rgba(${color},${alpha}) 0 0.45px, rgba(${color},0) 0.65px)`;
}

/**
 * 生成星空背景样式。
 *
 * 三层不同 tile 尺寸叠加，靠 `background-repeat: repeat`（由调用方 CSS 设置）
 * 平铺；因为各层密度/亮度不同，重复感在肉眼上不可辨。
 */
export function buildStarfieldStyle(options: StarfieldOptions = {}): StarfieldStyle {
  const { seed = 20261016, layers = DEFAULT_LAYERS, density = 1 } = options;
  const rng = createRng(seed);

  const images: string[] = [];
  const sizes: string[] = [];
  const scale = Math.max(0, density);
  for (const layer of layers) {
    // 密度倍率只改星点数量，不改平铺尺寸与亮度分布——后者是设计的一部分
    const count = Math.round(layer.count * scale);
    if (count <= 0 || layer.tile <= 0) continue;
    const brightCount = Math.round(count * layer.brightRatio);
    for (let i = 0; i < count; i += 1) {
      images.push(starGradient(rng, layer, i < brightCount));
    }
    sizes.push(`${layer.tile}px ${layer.tile}px`);
  }

  return { backgroundImage: images.join(','), backgroundSize: sizes.join(',') };
}
