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
 * 将主题同步到 documentElement（阶段 5 起全站唯一机制 = data-theme）：
 * - system：移除 data-theme，tokens.css 的手写变量与 tailwind.css 的 shadcn
 *   令牌都通过 `@media (prefers-color-scheme: dark)` + :not() 兜底跟随系统
 * - 显式 light/dark：写入 data-theme
 */
function syncDomAttr(resolved: ResolvedTheme, mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', resolved);
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
