'use client';

import { createContext, useContext, useState, useLayoutEffect, useEffect, useCallback } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'dark', toggle: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

function resolveTheme(): Theme {
  const dom = document.documentElement.getAttribute('data-theme') as Theme | null;
  if (dom === 'dark' || dom === 'light') return dom;
  try {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored === 'dark' || stored === 'light') return stored;
  } catch { /* localStorage 不可用 */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 服务端和客户端首次渲染统一用 'dark'，避免 hydration mismatch
  const [theme, setTheme] = useState<Theme>('dark');

  // hydration 后立即同步真实主题（layout 内联脚本已设好 data-theme）
  useLayoutEffect(() => {
    const actual = resolveTheme();
    if (actual !== 'dark') {
      setTheme(actual);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
