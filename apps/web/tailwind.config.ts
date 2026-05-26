import type { Config } from 'tailwindcss';

// Every color token resolves to a CSS variable defined in globals.css. The
// dual-theme palette (`:root[data-theme="light"]` vs `:root[data-theme="dark"]`)
// then makes utility classes like `bg-surface` flip automatically when the
// ThemeProvider writes a new attribute.
//
// Colors that participate in opacity modifiers (e.g. `bg-accent/10`) use the
// `rgb(var(...-rgb) / <alpha-value>)` form so Tailwind can compose the alpha.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        background: 'var(--background)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        'surface-hover': 'var(--card-hover)',
        'panel-header': 'var(--panel-header)',
        card: 'var(--card)',
        'card-bg': 'var(--card-bg)',
        'card-hover': 'var(--card-hover)',
        'card-border': 'var(--card-border)',
        border: 'var(--border)',
        'border-bright': 'var(--border-bright)',
        'hover-overlay': 'var(--hover-overlay)',

        // Text
        foreground: 'var(--foreground)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',

        // Accents
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        'accent-orange': 'var(--accent-orange)',
        'accent-secondary': 'var(--accent-secondary)',
        'accent-blue': 'var(--accent-blue)',
        'accent-cyan': 'var(--accent-cyan)',
        'accent-yellow': 'var(--accent-yellow)',
        'accent-purple': 'var(--accent-purple)',
        'accent-green': 'var(--accent-green)',
        'accent-red': 'var(--accent-red)',

        // Semantic
        positive: 'var(--positive)',
        negative: 'rgb(var(--negative-rgb) / <alpha-value>)',
        success: 'var(--success)',
        danger: 'var(--danger)',

        // Chart palette (theme-aware)
        'chart-1': 'var(--chart-1)',
        'chart-2': 'var(--chart-2)',
        'chart-3': 'var(--chart-3)',
        'chart-4': 'var(--chart-4)',
        'chart-5': 'var(--chart-5)',
        'chart-6': 'var(--chart-6)',
        'chart-7': 'var(--chart-7)',
        'chart-8': 'var(--chart-8)',
      },
      fontFamily: {
        sans: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        elevated: 'rgba(0, 0, 0, 0.45) 0px 20px 48px 0px',
        tooltip: 'rgba(0, 0, 0, 0.45) 0px 8px 24px 0px',
      },
      letterSpacing: {
        'header-wide': '0.15em',
        'header-medium': '0.10em',
      },
      fontSize: {
        tiny: ['10px', '15px'],
        small: ['11px', '16px'],
        body: ['13px', '19.5px'],
        kpi: ['24px', '32px'],
      },
    },
  },
  plugins: [],
};

export default config;
