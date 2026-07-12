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
