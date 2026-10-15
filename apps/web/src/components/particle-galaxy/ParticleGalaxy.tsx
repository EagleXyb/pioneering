/**
 * ParticleGalaxy ——「对数螺旋星系」背景组件（WebGL2，零依赖）
 *
 * 视觉与算法对齐参考实现「螺旋星系 · 静态单帧」：
 *   亮核白 → 紫 → 蓝紫 → 边缘暗紫的三段色带；3 条对数螺旋臂 + 高斯散布；
 *   恒星层（小而锐）/ 尘埃层（大而极淡的"紫雾"）/ 背景深空星三层粒子；
 *   中心三层径向渐变亮核 sprite；UnrealBloom 式泛光 + 曝光/暗角/gamma 合成。
 *
 * 与旧版（Canvas 2D 逐帧 arc+fill）的差异：
 *   · 渲染后端换成 WebGL2（3 个 draw call 画完 11.8 万粒子），几何一次性上传
 *   · 默认 `static`：只渲染一帧，登录页不常驻 rAF（零稳态开销）
 *   · 真 3D：相机俯角 + 透视投影 + 近大远小的 gl_PointSize，不再是 2D y 缩放
 *   · 颜色在线性空间插值，与 sRGB 输出经 gamma 校正，紫调不过曝
 *
 * 降级链：WebGL2 不可用 → 不渲染（页面纯色底不受影响）；<768px → 不挂载
 * （CSS 只做兜底，避免移动端白占显存）；prefers-reduced-motion → 静止单帧。
 *
 * 仅作认证页品牌面板的装饰层使用（aria-hidden）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  GALAXY_DEFAULTS,
  RAMP_DARK,
  RAMP_LIGHT,
  buildGalaxyGeometry,
  rampFromColors,
  resolveLayerCounts,
  srgbHexToLinear,
  stopsFromHex,
  type GalaxyGeometryConfig,
  type RampStop,
} from './galaxyGeometry';
import {
  CORE_SPRITE_STOPS_DARK,
  CORE_SPRITE_STOPS_LIGHT,
  GalaxyRenderer,
  type CoreSpriteSpec,
  type GalaxyRenderParams,
} from './galaxyRenderer';

export interface ParticleGalaxyProps {
  /** [核心色, 悬臂末端色]（hex）——不给则用 palette 内置色带 */
  colors?: [string, string];
  /** 四点色带（核心 → 边缘），优先级高于 colors */
  ramp?: [string, string, string, string];
  /** 内置主题色带 */
  palette?: 'dark' | 'light';
  /** 背景；transparent 时读取身后颜色（如页面底色） */
  backgroundColor?: string;
  /** 旋臂数量 */
  arms?: number;
  /** 恒星层粒子数（尘埃 / 背景星按参考实现比例派生） */
  count?: number;
  /** 厚度方向压缩（决定星系盘的"厚薄"） */
  tilt?: number;
  /** 相机俯角（度）——决定椭圆压扁比 */
  camElev?: number;
  /** 自转角速度 rad/s（仅 static=false 时生效） */
  spin?: number;
  /** 亮核强度（0..1.5，缩放三层 sprite 的不透明度） */
  glow?: number;
  /** 泛光强度 */
  bloomStrength?: number;
  /** 泛光半径（高斯扩散倍数） */
  bloomRadius?: number;
  /** 泛光阈值（只让亮核/亮星溢出） */
  bloomThreshold?: number;
  /** 曝光 */
  exposure?: number;
  /**
   * 叠加方式：
   * - 'lighter'（默认）深色背景，粒子相加形成辉光；
   * - 'source-over' 浅色背景，加法会被浅底吞掉，改走 normal 混合。
   */
  composite?: 'lighter' | 'source-over';
  /** 只渲染一帧（默认 true）——登录页背景不需要常驻动画 */
  static?: boolean;
  /** 停止自转 */
  paused?: boolean;
  /** canvas 最大设备像素比 */
  dpr?: number;
  /** 指针移动视差 */
  interactive?: boolean;
  /** 拖拽旋转 */
  draggable?: boolean;
  /** 随机种子（固定 → 每次都是同一张"照片"） */
  seed?: number;
  /** 是否渲染尘埃层 */
  dust?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** <768px 与 auth.module.css 的移动端断点保持一致：星云退场 */
const NARROW_QUERY = '(max-width: 767px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [query]);

  return matches;
}

function resolveRamp(
  ramp: ParticleGalaxyProps['ramp'],
  colors: ParticleGalaxyProps['colors'],
  palette: 'dark' | 'light'
): RampStop[] {
  if (ramp) return stopsFromHex(ramp);
  if (colors) return rampFromColors(colors);
  return palette === 'dark' ? RAMP_DARK : RAMP_LIGHT;
}

export default function ParticleGalaxy({
  colors,
  ramp,
  palette = 'dark',
  backgroundColor = 'transparent',
  arms = 3,
  count = 90000,
  tilt = GALAXY_DEFAULTS.tilt,
  camElev = GALAXY_DEFAULTS.camElev,
  spin = GALAXY_DEFAULTS.spin,
  glow = 0.7,
  bloomStrength = GALAXY_DEFAULTS.bloomStrength,
  bloomRadius = GALAXY_DEFAULTS.bloomRadius,
  bloomThreshold = GALAXY_DEFAULTS.bloomThreshold,
  exposure = GALAXY_DEFAULTS.exposure,
  composite = 'lighter',
  static: staticFrame = true,
  paused = false,
  dpr = 2,
  interactive = false,
  draggable = false,
  seed = GALAXY_DEFAULTS.seed,
  dust = true,
  className,
  style,
}: ParticleGalaxyProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [contextEpoch, setContextEpoch] = useState(0);

  const isNarrow = useMediaQuery(NARROW_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);

  const additive = composite === 'lighter';
  /**
   * 浅色底上加法混合会被吞掉，整条管线随之切换：
   *   · 关掉泛光 —— normal 混合下尘埃斑本身就是柔边光斑，再叠一层 bloom
   *     会把它们扩散成大团白晕（浅底下尤其明显）；
   *   · 关掉 HDR 色调压缩（没有过曝需要压制）。
   */
  const effectiveBloomStrength = additive ? bloomStrength : 0;
  const effectiveExposure = additive ? exposure : exposure * 0.95;

  const geometryConfig = useMemo<GalaxyGeometryConfig>(() => {
    const counts = resolveLayerCounts(count);
    return {
      ...counts,
      // 浅色页面没有"深空"语境：白色背景星会变成突兀的白点，直接不生成
      bgCount: additive ? counts.bgCount : 0,
      arms,
      radiusMax: GALAXY_DEFAULTS.radiusMax,
      spin: GALAXY_DEFAULTS.spin,
      armSpread: GALAXY_DEFAULTS.armSpread,
      haloRatio: GALAXY_DEFAULTS.haloRatio,
      thickness: GALAXY_DEFAULTS.thickness,
      tilt,
      coreR: GALAXY_DEFAULTS.coreR,
      seed,
      ramp: resolveRamp(ramp, colors, palette),
      /**
       * 浅色下尘埃要抬亮：canvas 是透明底，单个尘埃斑的 alpha ≈ bright
       * （0.006~0.02）时合成结果几乎就是页面底色本身（一坨"白斑"而不是紫雾）。
       * 抬到 3 倍后单斑 alpha ≈ 2%~6%，叠加呈现浅紫雾而不至于颗粒可见。
       */
      dustBoost: additive ? 1 : 3,
      dust,
    };
  }, [count, arms, tilt, seed, ramp, colors, palette, additive, dust]);

  const geometry = useMemo(() => buildGalaxyGeometry(geometryConfig), [geometryConfig]);

  const renderParams = useMemo<GalaxyRenderParams>(() => {
    const spriteBase: CoreSpriteSpec[] = [
      { size: 40, inner: 0.055, opacity: 0.48 },
      { size: 18, inner: 0.03, opacity: 0.48 },
      { size: 8, inner: 0.012, opacity: 0.48 },
    ];
    const glowScale = glow / 0.7;
    const clearColor: [number, number, number, number] =
      backgroundColor === 'transparent'
        ? [0, 0, 0, 0]
        : (() => {
            const [r, g, b] = srgbHexToLinear(backgroundColor);
            return [r, g, b, 1] as [number, number, number, number];
          })();

    return {
      fov: GALAXY_DEFAULTS.fov,
      camElev,
      radiusMax: GALAXY_DEFAULTS.radiusMax,
      thickness: GALAXY_DEFAULTS.thickness,
      tilt,
      fitY: 0.95,
      fitX: 0.98,
      pointK: GALAXY_DEFAULTS.pointK,
      refHeight: GALAXY_DEFAULTS.refHeight,
      bloomStrength: effectiveBloomStrength,
      bloomRadius,
      bloomThreshold,
      bloomSmooth: 0.12,
      exposure: effectiveExposure,
      additive,
      clearColor,
      vignette: true,
      toneMap: additive,
      coreSprites: additive
        ? spriteBase.map((s) => ({ ...s, opacity: s.opacity * glowScale }))
        : [],
      coreSpriteStops: palette === 'light' ? CORE_SPRITE_STOPS_LIGHT : CORE_SPRITE_STOPS_DARK,
    };
  }, [
    backgroundColor,
    camElev,
    tilt,
    effectiveBloomStrength,
    effectiveExposure,
    additive,
    bloomRadius,
    glow,
    palette,
  ]);

  const disabled = isNarrow;

  useEffect(() => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let renderer: GalaxyRenderer;
    try {
      renderer = new GalaxyRenderer(canvas, geometry, renderParams);
    } catch (error) {
      // WebGL2 不可用 / 驱动不支持 RGBA16F：静默不渲染，页面纯色底不受影响。
      // 单测环境（jsdom 无 WebGL）不打印，避免噪音淹没真实用例输出。
      if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
        console.warn('[ParticleGalaxy] WebGL renderer unavailable:', error);
      }
      return;
    }

    const animate = !staticFrame && !paused && !reducedMotion;
    let ratio = Math.min(dpr, window.devicePixelRatio || 1) || 1;
    let rafId = 0;
    let last = performance.now();
    let angle = 0;

    const loop = (now: number) => {
      rafId = 0;
      if (animate) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        angle += dt * spin;
        renderer.setAngle(angle);
      }
      renderer.render();
      if (animate) rafId = requestAnimationFrame(loop);
    };

    const scheduleRender = () => {
      if (!rafId) rafId = requestAnimationFrame(loop);
    };

    const resize = () => {
      ratio = Math.min(dpr, window.devicePixelRatio || 1) || 1;
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, ratio);
    };

    resize();
    scheduleRender();

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            resize();
            scheduleRender();
          })
        : null;
    observer?.observe(container);

    const onPointerMove = (event: PointerEvent) => {
      if (draggable) {
        angle += (event.movementX || 0) * 0.002;
      } else if (interactive) {
        const rect = container.getBoundingClientRect();
        if (!rect.width) return;
        angle = ((event.clientX - rect.left) / rect.width - 0.5) * 0.6;
      } else {
        return;
      }
      renderer.setAngle(angle);
      scheduleRender();
    };
    if (interactive || draggable) window.addEventListener('pointermove', onPointerMove);

    // 上下文丢失（移动端切后台/显存回收）：允许恢复并重建全部 GL 资源
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setContextEpoch((n) => n + 1);
    };
    const onContextRestored = () => setContextEpoch((n) => n + 1);
    canvas.addEventListener('webglcontextlost', onContextLost as EventListener);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer?.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('webglcontextlost', onContextLost as EventListener);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      renderer.dispose();
    };
  }, [
    disabled,
    geometry,
    renderParams,
    staticFrame,
    paused,
    reducedMotion,
    dpr,
    spin,
    interactive,
    draggable,
    contextEpoch,
  ]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'absolute', inset: 0, ...style }}
      aria-hidden="true"
    >
      {!disabled && <canvas ref={canvasRef} style={{ display: 'block' }} />}
    </div>
  );
}
