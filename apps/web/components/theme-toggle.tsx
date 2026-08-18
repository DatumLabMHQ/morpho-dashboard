/**
 * Theme toggle. Sun ⇄ moon button rendered in the nav.
 *
 * Ported from the Lending Intelligence Terminal. Flips the active theme
 * via the ThemeProvider hook and persists the choice via the provider.
 */
'use client';

import { Moon, Sun } from 'lucide-react';

import { useTheme } from './theme-provider';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center rounded-md border border-border bg-transparent text-text-muted transition-colors hover:border-border-bright hover:text-text-primary"
      style={{ width: 30, height: 30, cursor: 'pointer' }}
    >
      {theme === 'dark' ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
    </button>
  );
}
