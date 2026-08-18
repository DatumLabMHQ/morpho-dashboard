/**
 * Theme provider + hook.
 *
 * Ported from the Lending Intelligence Terminal (components/theme-provider.tsx)
 * with the localStorage key renamed to `morpho-theme`.
 *
 * Two responsibilities:
 *   1. Sync the active theme between localStorage and the
 *      `<html data-theme="...">` attribute. The pre-paint inline script in
 *      app/layout.tsx applies the persisted choice before React hydrates,
 *      so there is no light-mode flash on dark-default loads.
 *   2. Expose `useThemeColors()`. A Recharts-friendly object of computed
 *      color values that mirrors the live CSS variables. Components that
 *      cannot read CSS variables directly (Recharts axes, tooltips,
 *      gridlines) read this hook and re-render when the theme toggles.
 *
 * Default: dark. The toggle button (ThemeToggle, rendered in the nav)
 * persists the user's choice under `morpho-theme`.
 */
'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'morpho-theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readActiveTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readActiveTheme());

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next);
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // localStorage may be disabled (privacy mode); the in-memory state
        // and DOM attribute still flip so the UI works for this session.
      }
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  // Re-apply from localStorage on mount. React 19's hydration reconciliation
  // can clear the inline-script's `data-theme` attribute on <html> even with
  // `suppressHydrationWarning`, so we read the persisted choice directly and
  // call setTheme (which sets the attribute + state) to recover.
  useEffect(() => {
    let saved: Theme = 'dark';
    if (typeof window !== 'undefined') {
      try {
        const v = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (v === 'light' || v === 'dark') saved = v;
      } catch {
        // localStorage disabled. Stay on default dark.
      }
    }
    setTheme(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  // Provider-absent fallback so isolated components (tests, routes that
  // forget to mount the provider) still get a stable dark reading.
  return {
    theme: 'dark',
    setTheme: () => {},
    toggleTheme: () => {},
  };
}

/**
 * Live color object that mirrors the active theme. Recharts components
 * read from this so axes / tooltips / gridlines flip instantly on toggle.
 *
 * SSR returns the fallback for the default theme. After mount, a single
 * getComputedStyle pass on `documentElement` reads live CSS variables, and
 * a MutationObserver on the html element re-reads when `data-theme` flips.
 */
const DARK_FALLBACK = {
  background: '#0B0D11',
  cardBg: '#14171D',
  cardBorder: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#E5E7EB',
  textSecondary: '#C8CCD6',
  textMuted: '#8B92A1',
  accent: '#FF8155',
  success: '#34D399',
  danger: '#F26B68',
};

const LIGHT_FALLBACK = {
  background: '#F5F6F8',
  cardBg: '#FFFFFF',
  cardBorder: 'rgba(15, 17, 21, 0.08)',
  textPrimary: '#0F1115',
  textSecondary: '#2C3344',
  textMuted: '#5B6373',
  accent: '#FF6B35',
  success: '#0F9D58',
  danger: '#D6322E',
};

type ThemeColors = typeof DARK_FALLBACK;

function readLiveColors(theme: Theme): ThemeColors {
  if (typeof window === 'undefined') {
    return theme === 'light' ? LIGHT_FALLBACK : DARK_FALLBACK;
  }
  const style = window.getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => {
    const v = style.getPropertyValue(name).trim();
    return v.length > 0 ? v : fallback;
  };
  const fb = theme === 'light' ? LIGHT_FALLBACK : DARK_FALLBACK;
  return {
    background: read('--background', fb.background),
    cardBg: read('--card-bg', fb.cardBg) || read('--card', fb.cardBg),
    cardBorder: read('--card-border', fb.cardBorder) || read('--border', fb.cardBorder),
    textPrimary: read('--text-primary', fb.textPrimary) || read('--foreground', fb.textPrimary),
    textSecondary: read('--text-secondary', fb.textSecondary),
    textMuted: read('--text-muted', fb.textMuted),
    accent: read('--accent', fb.accent) || read('--accent-orange', fb.accent),
    success: read('--success', fb.success) || read('--accent-green', fb.success),
    danger: read('--danger', fb.danger) || read('--accent-red', fb.danger),
  };
}

export function useThemeColors(): ThemeColors {
  const { theme } = useTheme();
  const [colors, setColors] = useState<ThemeColors>(() =>
    theme === 'light' ? LIGHT_FALLBACK : DARK_FALLBACK,
  );

  useEffect(() => {
    const update = () => setColors(readLiveColors(theme));
    update();
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [theme]);

  return colors;
}
