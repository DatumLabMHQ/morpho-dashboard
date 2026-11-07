// Brand tokens for the Morpho Research Terminal.
// Extracted from the Lending Intelligence Terminal at
// https://lending-intelligence-terminal.datumlabs.workers.dev/ via Playwright on 2026-05-26
// (see branding/extracted-tokens.json). Two sibling products under the Datum
// Labs brand. These tokens are the source of truth so they stay consistent.
//
// Aesthetic: Datum Labs terminal. Near-black surfaces (#0B0D11), an ORANGE
// (#FF8155) primary accent, JetBrains Mono throughout, dense information
// layout, ALL-CAPS small-caps headers with wide letter-spacing. Exact match to
// the Lending Intelligence Terminal at datumlab.xyz/lending-terminal.

export const tokens = {
  colors: {
    // Surfaces — exact match to the Lending Intelligence Terminal dark theme.
    background: '#0B0D11',         // page bg. Near-black
    surface: '#14171D',            // card / panel bg
    surfaceHover: '#1B1F27',
    panelHeader: '#1A1D24',
    border: 'rgba(255, 255, 255, 0.08)',
    borderBright: 'rgba(255, 255, 255, 0.16)',
    hoverOverlay: 'rgba(255, 255, 255, 0.04)',

    // Text
    textPrimary: '#E5E7EB',
    textSecondary: '#C8CCD6',
    textMuted: '#8B92A1',

    // Accents — ORANGE is the primary brand accent (matches the terminal)
    accent: '#FF8155',
    accentSecondary: '#B97AFF',
    accentBlue: '#6B85FF',
    accentCyan: '#38BDF8',
    accentYellow: '#FBBF24',

    // Semantic
    positive: '#34D399',           // success / up
    negative: '#F26B68',           // danger / down

    // Chart palette — Lending Terminal dark family (blue-led series, orange #6).
    chart: [
      '#6B85FF', // 1 blue
      '#34D399', // 2 green
      '#FBBF24', // 3 yellow
      '#B97AFF', // 4 purple
      '#38BDF8', // 5 cyan
      '#FF8155', // 6 orange (brand accent)
      '#F472B6', // 7 pink
      '#818CF8', // 8 indigo
    ] as const,

    // Tooltip / overlay
    tooltipBg: 'rgba(20, 23, 29, 0.98)',
    tooltipShadow: 'rgba(0, 0, 0, 0.45)',
  },

  typography: {
    // JetBrains Mono for everything — the terminal face. CSS var injected by
    // next/font in app/layout.tsx (--font-jetbrains).
    fontFamilySans: 'var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, monospace',
    fontFamilyMono: 'var(--font-jetbrains), ui-monospace, SFMono-Regular, Menlo, monospace',
    scale: {
      // Slight bump toward the lending terminal's airier scale (+1-2px).
      h1: '14px',                 // section header, all-caps, letter-spaced
      h2: '12px',                 // sub-section
      h3: '11px',                 // tertiary
      kpiValue: '26px',
      body: '14px',
      small: '12px',
      tiny: '11px',
    },
    weights: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    letterSpacing: {
      // The terminal uses wide tracking on ALL-CAPS headers.
      headerWide: '0.15em',       // ≈ 1.95px on 13px text
      headerMedium: '0.10em',
      normal: 'normal',
    },
  },

  radii: {
    sm: '4px',
    md: '6px',                    // buttons
    lg: '8px',                    // cards
  },

  shadows: {
    card: 'rgba(15, 17, 21, 0.18) 0px 12px 32px 0px',
    elevated: 'rgba(0, 0, 0, 0.45) 0px 20px 48px 0px',
  },

  spacing: {
    unit: 4,                      // 1 unit = 4px
    cardPadding: '16px',
    sectionGap: '24px',
  },

  logo: {
    wordmark: 'Datum Labs',
    productLabel: 'Morpho Research Terminal',
    iconPath: '/branding/datumlabs-icon.png',
  },
} as const;

export type Tokens = typeof tokens;
export type ChartColor = (typeof tokens.colors.chart)[number];
