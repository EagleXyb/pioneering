import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CometCard } from '../ui/comet-card';
import SpaceBackdrop, { DEFAULT_SPACE_PHOTO, type SpacePhoto } from './SpaceBackdrop';

const photo: SpacePhoto = {
  landscape: [
    { src: '/l-1600.avif', width: 1600 },
    { src: '/l-3200.avif', width: 3200 },
  ],
  portrait: [
    { src: '/p-780.avif', width: 780 },
    { src: '/p-1170.avif', width: 1170 },
  ],
  fallback: '/l-1600.webp',
  portraitFallback: '/p-780.webp',
  portraitAspect: '4/5',
};

describe('SpaceBackdrop', () => {
  it('四层背景齐备且对辅助技术隐藏', () => {
    const { container } = render(<SpaceBackdrop photo={photo} />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    // 色晕 / 照片 / 星空 / 遮罩
    expect(root.children).toHaveLength(4);
  });

  it('多分辨率出图：竖屏与横版各自成组，且都带 w 描述符与 sizes', () => {
    const { container } = render(<SpaceBackdrop photo={photo} />);

    const sources = Array.from(container.querySelectorAll('source'));
    expect(sources).toHaveLength(3); // avif 竖屏 / webp 竖屏兜底 / avif 横版
    for (const source of sources) {
      expect(source.getAttribute('srcset')).toMatch(/\d+w/);
      expect(source.getAttribute('sizes')).toBe('100vw');
    }

    const portrait = sources[0];
    expect(portrait.getAttribute('media')).toBe('(max-aspect-ratio: 4/5)');
    expect(portrait.getAttribute('srcset')).toBe('/p-780.avif 780w, /p-1170.avif 1170w');

    const landscape = sources[2];
    expect(landscape.getAttribute('media')).toBeNull();
    expect(landscape.getAttribute('srcset')).toBe('/l-1600.avif 1600w, /l-3200.avif 3200w');
  });

  it('img 兜底：老浏览器（无 AVIF）拿到 WebP，且 alt 为空（纯装饰）', () => {
    const { container } = render(<SpaceBackdrop photo={photo} />);

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/l-1600.webp');
    expect(img.getAttribute('sizes')).toBe('100vw');
    expect(img.getAttribute('alt')).toBe('');
  });

  it('全幅铺底：只有一张 img，且没有卡片内衬与说明行', () => {
    const { container } = render(<SpaceBackdrop photo={photo} />);

    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.queryByText(/Deep Field/)).toBeNull();
    expect(screen.queryByText(/#DSF-01/)).toBeNull();
  });

  it('默认素材覆盖横版 3 档 + 竖版 2 档，且带 WebP 兜底', () => {
    expect(DEFAULT_SPACE_PHOTO.landscape.map((c) => c.width)).toEqual([1600, 2560, 3200]);
    expect(DEFAULT_SPACE_PHOTO.portrait.map((c) => c.width)).toEqual([780, 1170]);
    expect(DEFAULT_SPACE_PHOTO.fallback).toMatch(/\.webp$/);
    expect(DEFAULT_SPACE_PHOTO.portraitFallback).toMatch(/\.webp$/);
    // 所有候选都是现代格式
    for (const candidate of [
      ...DEFAULT_SPACE_PHOTO.landscape,
      ...DEFAULT_SPACE_PHOTO.portrait,
    ]) {
      expect(candidate.src).toMatch(/\.avif$/);
    }
  });

  it('density 透传给星空层（行为由 starfield.test 覆盖）', () => {
    const { container } = render(<SpaceBackdrop photo={photo} density={1.4} />);
    expect(container.firstElementChild?.children).toHaveLength(4);
  });
});

describe('CometCard', () => {
  it('渲染子内容并透传 className', () => {
    const { container } = render(
      <CometCard className="bg-black">
        <span>inner</span>
      </CometCard>,
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bg-black');
    expect(screen.getByText('inner')).toBeInTheDocument();
    // 辉光层在内容层之前（z-0 / z-10）
    expect(root.children).toHaveLength(2);
  });

  it('interactive=false 时指针移动不改变 transform', () => {
    const { container } = render(
      <CometCard interactive={false}>
        <span>inner</span>
      </CometCard>,
    );
    const root = container.firstElementChild as HTMLElement;
    const inner = root.lastElementChild as HTMLElement;

    fireEvent.pointerMove(root, { clientX: 20, clientY: 20 });
    expect(inner.style.transform).toBe('');
  });

  it('尊重 prefers-reduced-motion：即使 interactive 也不倾斜', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      const { container } = render(
        <CometCard interactive>
          <span>inner</span>
        </CometCard>,
      );
      const root = container.firstElementChild as HTMLElement;
      const inner = root.lastElementChild as HTMLElement;

      fireEvent.pointerMove(root, { clientX: 40, clientY: 40 });
      expect(inner.style.transform).toBe('');
    } finally {
      window.matchMedia = original;
    }
  });
});
