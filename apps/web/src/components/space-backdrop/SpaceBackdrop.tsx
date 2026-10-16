/**
 * SpaceBackdrop —— 深色模式「太空」背景（登录 / 注册 / 忘记密码共用）
 *
 * 四层自下而上（详见 space-backdrop.module.css 头注）：
 *   ① 大尺度色晕  ② 银河照片（全幅出血）  ③ 全屏星空底纹  ④ 可读性遮罩
 *
 * 为什么照片用位图而不是粒子星云：用户要的底图是**银河带照片**（真实天体摄影的
 * 质感与细节层次），粒子系统无法在合理成本内还原；而星空那层「零星点」用 CSS
 * 多层 radial-gradient 平铺即可，零显存、任意 DPR 自适应，还避开了点精灵上限。
 *
 * 分辨率策略（「各种屏幕不虚不失真」）：
 *   · 不失真：`object-fit: cover` 只裁不拉伸，任何宽高比都不会变形；
 *   · 不虚：按像素密度出料并用 `srcset` + `sizes="100vw"` 交给浏览器选档——
 *       横版 1600 / 2560 / 3200（1512@1x → 1600；1512@2x → 3200；
 *       1920@1x → 2560；1280@2x → 2560），
 *       竖版 780 / 1170（`max-aspect-ratio: 4/5` 命中竖屏；390@2x → 780、
 *       390@3x → 1170 恰好 1:1，避免横版原片在窄屏被放大约 2~3 倍）。
 *   · 格式：主档 AVIF（同画质比 WebP 小 35%~45%），`<img>` 保留 WebP 兜底，
 *     不支持 AVIF 的浏览器退化为 1600 横版 / 780 竖版，仍可用。
 *
 * 照片来源与 ui.astonity.com 的 comet-card 参考稿一致（Unsplash 银河图，已按
 * 需求转纯灰阶）；差别只在使用位置：参考组件把照片放进 3:4 小卡片做交互演示，
 * 这里铺满整页。所有处理（灰阶 / 降亮 / 四角压暗）都在 CSS 里，源图保持原样。
 */
import { useMemo } from 'react';

import { buildStarfieldStyle } from './starfield';
import styles from './space-backdrop.module.css';

/** 一档候选图（w 描述符用于 srcset 选档） */
export interface SpacePhotoCandidate {
  src: string;
  /** 固有宽度（px），生成 `srcset` 的 `w` 描述符 */
  width: number;
}

export interface SpacePhoto {
  /** 竖屏（窄高视口）候选，按宽度升序 */
  portrait: SpacePhotoCandidate[];
  /** 横版候选，按宽度升序 */
  landscape: SpacePhotoCandidate[];
  /** 不支持现代格式时的兜底（通常给横版最小档） */
  fallback: string;
  /** 不支持 AVIF 时竖屏兜底 */
  portraitFallback?: string;
  /** 触发竖屏档的视口宽高比上限，默认 4/5 */
  portraitAspect?: string;
}

export interface SpaceBackdropProps {
  /** 银河照片候选集（不传则用包内默认多分辨率素材） */
  photo?: SpacePhoto;
  /** 星点密度倍率（1 = 默认约 140 颗） */
  density?: number;
  className?: string;
}

/**
 * 默认素材：同一张 Unsplash 银河照，纯灰阶（`sat=-100`）。
 * 竖版是服务端按手机宽高比（9:19.5）裁切的版本——横版原片套在竖屏上会被
 * `cover` 裁掉约 2/3 的宽度，等效放大 2~3 倍而发虚。
 */
export const DEFAULT_SPACE_PHOTO: SpacePhoto = {
  landscape: [
    { src: new URL('../../assets/nebula-galaxy-1600.avif', import.meta.url).href, width: 1600 },
    { src: new URL('../../assets/nebula-galaxy-2560.avif', import.meta.url).href, width: 2560 },
    { src: new URL('../../assets/nebula-galaxy-3200.avif', import.meta.url).href, width: 3200 },
  ],
  portrait: [
    { src: new URL('../../assets/nebula-galaxy-portrait-780.avif', import.meta.url).href, width: 780 },
    {
      src: new URL('../../assets/nebula-galaxy-portrait-1170.avif', import.meta.url).href,
      width: 1170,
    },
  ],
  fallback: new URL('../../assets/nebula-galaxy-1600.webp', import.meta.url).href,
  portraitFallback: new URL('../../assets/nebula-galaxy-portrait-780.webp', import.meta.url).href,
  portraitAspect: '4/5',
};

const toSrcSet = (candidates: SpacePhotoCandidate[]) =>
  candidates.map((c) => `${c.src} ${c.width}w`).join(', ');

export default function SpaceBackdrop({
  photo = DEFAULT_SPACE_PHOTO,
  density = 1,
  className,
}: SpaceBackdropProps) {
  const starsStyle = useMemo(() => buildStarfieldStyle({ density }), [density]);
  const portraitMedia = `(max-aspect-ratio: ${photo.portraitAspect ?? '4/5'})`;

  return (
    <div className={[styles.backdrop, className].filter(Boolean).join(' ')} aria-hidden="true">
      <div className={styles.deepField} />
      <div className={styles.nebula}>
        <picture>
          {/* 竖屏优先：与视口同宽高比的服务端裁切，避免横版在窄屏被放大 */}
          <source
            type="image/avif"
            media={portraitMedia}
            srcSet={toSrcSet(photo.portrait)}
            sizes="100vw"
          />
          {photo.portraitFallback && (
            <source
              type="image/webp"
              media={portraitMedia}
              srcSet={`${photo.portraitFallback} 780w`}
              sizes="100vw"
            />
          )}
          <source type="image/avif" srcSet={toSrcSet(photo.landscape)} sizes="100vw" />
          <img
            className={styles.nebulaImg}
            src={photo.fallback}
            srcSet={toSrcSet(photo.landscape)}
            sizes="100vw"
            alt=""
            loading="eager"
            decoding="async"
          />
        </picture>
      </div>
      <div className={styles.stars} style={starsStyle} />
      <div className={styles.scrim} />
    </div>
  );
}
