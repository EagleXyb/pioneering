/**
 * BrandMark —— 模型品牌标识
 *
 * 绘制规范（所有品牌共用，仅替换内部图元）：
 * - 画板 48×48：三分支统一，坐标可读性优于 24 画板，且便于做墨迹居中的微调
 * - 描边 4（= 画板的 1/12）：与 lucide 24 画板 / stroke-width 2 的相对粗细一致，
 *   因此品牌标识与项目内其它 lucide 图标混排时视觉重量相当
 * - 颜色 currentColor：跟随容器文字色，不依赖具体底色（明暗主题、hover 底色均自适应）
 *
 * 新增品牌：在 GLYPHS 中按前缀登记，未命中时回退到通用标识。
 */
import type { ComponentType, ReactNode } from 'react';

/** 标识渲染尺寸：触发胶囊与上弹菜单共用同一值，保证两处视觉重量一致 */
const DEFAULT_SIZE = 20;
/** 统一画板 */
const VIEW_BOX = '0 0 48 48';
/** 统一描边宽度（= 画板的 1/12，对齐 lucide 的相对粗细） */
const STROKE_WIDTH = 4;

/** 统一外框：尺寸 / 画板 / 描边 / 线帽 / 颜色在此收口，各品牌只提供内部图元 */
function LogoFrame({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * DeepSeek：螺旋鲸身 + 双尾鳍。
 * 原始图形重心偏右上（墨迹包围盒 x 7.5~48 / y 2~40.7），整体平移使墨迹居中于画板。
 */
function DeepSeekGlyph() {
  return (
    <g transform="translate(-3.75 2.65)">
      {/* 尾鳍：两片，交汇于尾柄（右上） */}
      <path d="M32.5 13.5C37 5.5 42.5 3 46 4.5" />
      <path d="M32.5 13.5C40 11.5 44.5 12.5 46 16.5" />
      {/* 背部大弧 → 左下头部 → 腹部向内回勾，呈螺旋鲸身 */}
      <path d="M32.5 13.5C19.5 14.5 8.5 23 9.5 32c0.8 7 8 9 12.5 5.5 5-4 6.5-9.5 3-12.5" />
      {/* 眼睛：实心点用 currentColor，任意底色下都成立（原先挖空依赖 --bg-card，
          hover 时底色变为 --bg-input 会露出色差） */}
      <circle cx="14" cy="33" r="2.4" fill="currentColor" stroke="none" />
    </g>
  );
}

/** GPT：双六边节点（本身已居中于画板，无需平移） */
function GptGlyph() {
  return (
    <>
      <path d="M30 5.5 39 10.75v10.5L30 26.5l-9-5.25v-10.5L30 5.5Z" />
      <path d="M18 21.5 9 26.75v10.5L18 42.5l9-5.25v-10.5L18 21.5Z" />
    </>
  );
}

/** 通用标识（未登记品牌）：大小菱形光斑，原 24 画板坐标 ×2 居中换算至 48 画板 */
function GenericGlyph() {
  return (
    <>
      <path d="M21 6l3.8 10.2L35 20l-10.2 3.8L21 34l-3.8-10.2L7 20l10.2-3.8L21 6Z" />
      <path d="M35 30l1.6 4.4L41 36l-4.4 1.6L35 42l-1.6-4.4L29 36l4.4-1.6L35 30Z" />
    </>
  );
}

/** 品牌前缀 → 图形登记表（按序匹配，首个命中者生效） */
const GLYPHS: ReadonlyArray<{ prefix: string; glyph: ComponentType }> = [
  { prefix: 'deepseek', glyph: DeepSeekGlyph },
  { prefix: 'gpt', glyph: GptGlyph },
];

interface Props {
  /** 模型 id（按前缀匹配品牌） */
  id: string;
  /** 渲染尺寸，默认 20px */
  size?: number;
}

export function BrandMark({ id, size = DEFAULT_SIZE }: Props) {
  const matched = GLYPHS.find((entry) => id.startsWith(entry.prefix));
  const Glyph = matched?.glyph ?? GenericGlyph;
  return (
    <LogoFrame size={size}>
      <Glyph />
    </LogoFrame>
  );
}
