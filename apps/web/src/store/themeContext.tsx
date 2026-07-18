import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { ThemeMode } from '../types';

type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
});

/**
 * 根据系统偏好计算实际生效的主题。
 * 在 SSR / matchMedia 不可用时回退为 'light'。
 */
function getSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/**
 * 将实际生效的主题同步到 documentElement。
 * 1) 我们自己的设计 Token：system 模式移除 data-theme，交给 tokens.css 的
 *    `@media (prefers-color-scheme: dark)` 媒体查询接管；显式模式写入 data-theme。
 * 2) TDesign 组件库（ChatSender / ChatMessage / Button / Select / Radio 等）的暗色
 *    并非由 data-theme 驱动，而是识别 html 上的 `theme-mode="dark"` 属性或
 *    `t-theme-dark` 类。必须显式给出 resolved 结果（含 system 跟随系统的实际情况），
 *    否则聊天输入框、消息气泡等 TDesign 内部组件永远不会变暗。
 */
function syncDomAttr(resolved: ResolvedTheme, mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', resolved);
  }

  if (resolved === 'dark') {
    root.setAttribute('theme-mode', 'dark');
    root.classList.add('t-theme-dark');
  } else {
    root.removeAttribute('theme-mode');
    root.classList.remove('t-theme-dark');
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('theme') as ThemeMode | null;
    return stored || 'system';
  });

  // 订阅系统主题变化，仅在 mode==='system' 时影响实际生效主题。
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    // 兼容 Safari < 14 的旧 API
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
    return;
  }, []);

  // 实际生效的主题：显式选择时优先，否则跟随系统。
  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  // mode 或 systemTheme 变化时，同步 DOM 属性。
  useEffect(() => {
    syncDomAttr(resolvedTheme, theme);
  }, [resolvedTheme, theme]);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    if (t === 'system') {
      localStorage.removeItem('theme');
    } else {
      localStorage.setItem('theme', t);
    }
    // DOM 同步交由上面的 effect 统一处理，避免双写。
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
