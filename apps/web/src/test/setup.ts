/**
 * Vitest 测试环境初始化
 */
import '@testing-library/jest-dom';

// jsdom 不实现 matchMedia，手动 polyfill（ThemeProvider 需要）
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom 不实现 ResizeObserver，手动 polyfill（Radix Popover / Popper 定位需要）
if (typeof globalThis.ResizeObserver === 'undefined') {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const mock = MockResizeObserver as unknown as typeof ResizeObserver;
  window.ResizeObserver = mock;
  globalThis.ResizeObserver = mock;
}

// jsdom 未实现 CanvasRenderingContext2D，getContext 会向 stderr 抛「Not implemented」噪音。
// 认证页的粒子星云背景与图表类组件都会触发，此处统一以 null 桩替代
// （与 jsdom 实际返回值一致，消费方均有 `if (!ctx) return` 保护）。
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
}

// jsdom 不实现 IntersectionObserver，手动 polyfill（消息列表自动滚动哨兵）
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  const mock = MockIntersectionObserver as unknown as typeof IntersectionObserver;
  window.IntersectionObserver = mock;
  globalThis.IntersectionObserver = mock;
}
