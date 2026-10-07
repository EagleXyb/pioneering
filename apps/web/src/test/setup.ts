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
