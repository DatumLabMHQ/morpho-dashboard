// Brand tokens for the Morpho Research Terminal.
// Extracted from the Lending Intelligence Terminal at
// https://lending-intelligence-terminal.vercel.app/ via Playwright on 2026-05-26
// (see branding/extracted-tokens.json). Two sibling products under the Datum
// Labs brand — these tokens are the source of truth so they stay consistent.
//
// Aesthetic: Bloomberg-style terminal — dark, JetBrains Mono throughout, dense
// information layout, vivid 8-color chart palette, ALL-CAPS small-caps headers
// with wide letter-spacing.

export const tokens = {
  colors: {
    // Surfaces — Datum navy (dark-theme values; Recharts renders on these).
    background: '#03072d',         // page bg — Datum navy
    surface: '#0a0f33',            // card / panel bg
    surfaceHover: '#141b47',
    panelHeader: '#0c1138',
    border: 'hsla(0, 0%, 100%, 0.09)',
    borderBright: 'hsla(0, 0%, 100%, 0.18)',
    hoverOverlay: 'hsla(0, 0%, 100%, 0.05)',

    // Text
    textPrimary: '#e8eaf6',
    textSecondary: '#c2c7e0',
    textMuted: '#8b92b5',

    // Accents — Datum blue lead.
    accent: '#5b7cff',             // brand blue (brightened for navy bg)
    accentSecondary: '#a78bfa',
    accentBlue: '#5b7cff',
    accentCyan: '#38bdf8',
    accentYellow: '#fbbf24',

    // Semantic
    positive: '#34d399',           // success / up
    negative: '#f26b68',           // danger / down

    // Chart palette — blue-led, multi-hue for stacked legibility.
    chart: [
      '#5b7cff', // 1 brand blue
      '#34d399', // 2 green
      '#fbbf24', // 3 yellow
      '#a78bfa', // 4 purple
      '#38bdf8', // 5 cyan
      '#fb923c', // 6 orange
      '#f472b6', // 7 pink
      '#818cf8', // 8 indigo
    ] as const,

    // Tooltip / overlay
    tooltipBg: 'rgba(10, 15, 51, 0.98)',
    tooltipShadow: 'rgba(0, 0, 0, 0.55)',
  },

  typography: {
    // JetBrains Mono everywhere — including headings, KPI values, table cells.
    // The Lending Terminal uses Mono as its sans equivalent for the dense
    // tabular look. We follow.
    fontFamilySans: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    fontFamilyMono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    scale: {
      // Small caps headers + dense body. Sizes mirror what the terminal uses.
      h1: '13px',                 // section header, all-caps, letter-spaced
      h2: '11px',                 // sub-section
      h3: '10px',                 // tertiary
      kpiValue: '24px',
      body: '13px',
      small: '11px',
      tiny: '10px',
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
