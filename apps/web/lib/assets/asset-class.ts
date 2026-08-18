// Single source of truth for asset-class bucketing + display.
//
// IMPORTANT: categorization lives in JS, never as an interpolated SQL CASE
// string. The neon HTTP driver parameter-binds every `${...}` in a tagged
// template, so a `${CASE_SQL}` fragment is sent as a bound string literal and
// every row's category comes back as that literal text (the "SQL-text
// artifact" that collapsed the asset-mix donut into one bogus slice). Fetch raw
// symbols and bucket them here instead.

export type AssetClass = 'stablecoin' | 'lst' | 'lrt' | 'btc' | 'eth' | 'rwa' | 'other';

const STABLE = new Set(['USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD','FDUSD','TUSD','MIM','BUIDL']);
const LST = new Set(['WSTETH','WEETH','EZETH','RSETH','SWETH','RETH','METH','OSETH','LSETH']);
const LRT = new Set(['PT-WEETH','PT-EZETH','PT-RSETH','EBTC','UNIETH','PUFETH']);
const BTC = new Set(['WBTC','CBBTC','TBTC','LBTC','SBTC','RBTC','MBTC','SOLVBTC','EBTC','WBTC18']);
const ETH = new Set(['WETH','ETH']);
const RWA = new Set(['USTB','OUSG','UDUSD','SBUIDL']);

// Order matters. Stablecoin is detected by USD/EUR pattern PLUS the explicit
// STABLE set (which covers the non-USD-named stables: DAI, GHO, FRAX, MIM,
// BUIDL). The earlier strict-set-only approach under-counted stablecoins badly:
// ~20 real stables (RLUSD, AUSD, USDTB, USDT0, VBUSDC, APXUSD, FRXUSD, EURC,
// USD1, ...) fell into 'other'. Stablecoin is checked first so a Pendle PT of a
// stablecoin reads as a stablecoin position. Precedence below preserves the
// legacy LRT-before-BTC rule (e.g. EBTC matches 'lrt' before 'btc').
export function categorizeAsset(symbol: string | null | undefined): AssetClass {
  if (!symbol) return 'other';
  const s = symbol.toUpperCase().replace(/\./g, '');
  if (s.includes('USD') || s.includes('EUR') || STABLE.has(s)) return 'stablecoin';
  if (LST.has(s)) return 'lst';
  if (LRT.has(s) || s.startsWith('PT-')) return 'lrt';
  if (BTC.has(s) || s.includes('BTC')) return 'btc';
  if (ETH.has(s)) return 'eth';
  if (s.includes('RWA') || RWA.has(s)) return 'rwa';
  return 'other';
}

export const ASSET_CLASS_ORDER: AssetClass[] = ['stablecoin', 'lst', 'lrt', 'btc', 'eth', 'rwa', 'other'];

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  stablecoin: 'Stablecoins',
  lst: 'LSTs',
  lrt: 'LRTs / PTs',
  btc: 'BTC-pegged',
  eth: 'ETH',
  rwa: 'RWA',
  other: 'Other',
};

// Short ALL-CAPS column headers for the structural-identity heatmap.
export const ASSET_CLASS_SHORT: Record<AssetClass, string> = {
  stablecoin: 'STABLE',
  lst: 'LST',
  lrt: 'LRT',
  btc: 'BTC',
  eth: 'ETH',
  rwa: 'RWA',
  other: 'OTHER',
};

// Aligned with tokens.colors.chart.
export const ASSET_CLASS_COLOR: Record<AssetClass, string> = {
  stablecoin: '#34d399', // green
  lst: '#38bdf8',        // cyan
  lrt: '#818cf8',        // indigo
  btc: '#fbbf24',        // yellow
  eth: '#6b85ff',        // blue
  rwa: '#b97aff',        // purple
  other: 'hsla(0, 0%, 100%, 0.22)',
};
