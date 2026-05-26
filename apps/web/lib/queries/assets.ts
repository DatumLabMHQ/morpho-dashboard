// Assets-surface queries.
//
// All composition is derived from `markets` × `market_state_daily` because
// vault_allocations_daily is empty. Every Morpho Blue market has both a
// loan_asset (the "supply side") and a collateral_asset (the "collateral side"),
// so a chain-aware aggregate over the latest market_state row per market
// gives us total supply / borrow / collateral by asset class.

import { unstable_cache } from 'next/cache';

import { getDb } from '../db.js';

const CACHE_VERSION = 'assets-v1';
const TTL = 900;

// Inline asset-class CASE. Centralized so every query stays in sync.
// PT-* (Pendle Principal Tokens) carry the class of their underlying.
// Keep these lists alphabetized inside each class to make additions painless.
const ASSET_CATEGORY_CASE = (col: string) => `
  CASE
    WHEN UPPER(${col}) LIKE 'PT-%' THEN
      CASE
        WHEN UPPER(${col}) LIKE 'PT-SUSDE%' OR UPPER(${col}) LIKE 'PT-USDE%' OR UPPER(${col}) LIKE 'PT-USDC%'
          OR UPPER(${col}) LIKE 'PT-USDS%'  OR UPPER(${col}) LIKE 'PT-USDT%' OR UPPER(${col}) LIKE 'PT-USR%'
          OR UPPER(${col}) LIKE 'PT-USD0%'  OR UPPER(${col}) LIKE 'PT-GHO%'  OR UPPER(${col}) LIKE 'PT-DAI%'
          THEN 'stablecoin'
        WHEN UPPER(${col}) LIKE 'PT-WEETH%' OR UPPER(${col}) LIKE 'PT-EZETH%' OR UPPER(${col}) LIKE 'PT-RSETH%'
          OR UPPER(${col}) LIKE 'PT-PUFETH%' OR UPPER(${col}) LIKE 'PT-EETH%'
          THEN 'lrt'
        WHEN UPPER(${col}) LIKE 'PT-WSTETH%' OR UPPER(${col}) LIKE 'PT-STETH%' OR UPPER(${col}) LIKE 'PT-CBETH%'
          OR UPPER(${col}) LIKE 'PT-RETH%'
          THEN 'lst'
        WHEN UPPER(${col}) LIKE 'PT-CBBTC%' OR UPPER(${col}) LIKE 'PT-WBTC%' OR UPPER(${col}) LIKE 'PT-LBTC%'
          OR UPPER(${col}) LIKE 'PT-TBTC%'  OR UPPER(${col}) LIKE 'PT-EBTC%'
          THEN 'btc'
        ELSE 'other'
      END
    WHEN UPPER(${col}) IN (
      'USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD',
      'FDUSD','TUSD','MIM','BUIDL','RLUSD','USD0','USD0++','EUSD','MKUSD','FRXUSD','DEUSD','SDEUSD',
      'USDD','USDM','GUSD','USDX','USDY','USDTB','USDTB','BOLD','GUSDC',
      -- Round 2 — added after sanity-bondusd.ts surfaced these as the next
      -- 30 uncategorized symbols >$10M. Wrapped USDC/USDT family (vb*, USDT0,
      -- USD₮0), credit-bearing stable derivatives (syrupUSDC, AA_FalconXUSDC,
      -- siUSD, stcUSD, sUSDat, wsrUSD), MakerDAO stUSDS, Aave AUSD, Anchorage
      -- EURCV, msUSD/vUSD/apxUSD stable mints.
      'SYRUPUSDC','AA_FALCONXUSDC','EURCV','WSRUSD','AUSD','VBUSDC','VBUSDT',
      'SIUSD','STCUSD','SUSDAT','STUSDS','USDT0','USD₮0','APXUSD','MSUSD','VUSD'
    ) THEN 'stablecoin'
    WHEN UPPER(${col}) IN (
      'WSTETH','STETH','RETH','CBETH','SFRXETH','ETHX','SWETH','OSETH','ANKRETH',
      -- Round 2 — Hyperliquid staked HYPE variants behave as LSTs of their L1
      -- gas token; Origin's OETH is a stETH-style yield wrapper.
      'KHYPE','STHYPE','OETH'
    ) THEN 'lst'
    WHEN UPPER(${col}) IN ('WEETH','EZETH','RSETH','PUFETH','EETH','RSTETH','AMPHRETH','KINGETH','UNIETH')
      THEN 'lrt'
    WHEN UPPER(${col}) IN (
      'WBTC','CBBTC','LBTC','TBTC','EBTC','SOLVBTC','STBTC','FBTC','M-BTC','UNIBTC','ENZOBTC','KBTC',
      'PUMPBTC','SOLVBTC.BBN','BTCB','XBTC','WBTC18',
      -- Round 2 — Venus / Binance-bridged WBTC clone on BNB/Hyper.
      'VBWBTC'
    ) THEN 'btc'
    WHEN UPPER(${col}) IN (
      'WETH','ETH',
      -- Round 2 — Venus / Binance-bridged WETH clone.
      'VBETH'
    ) THEN 'eth'
    WHEN UPPER(${col}) IN (
      'SDAI','PAXG','USTB','OUSG','UDUSD','SBUIDL',
      -- Round 2 — Tether Gold ticker.
      'XAUT'
    )
      OR UPPER(${col}) LIKE 'YT-%'
      OR UPPER(${col}) LIKE '%RWA%'
      THEN 'rwa'
    -- Round 2 — leave HYPE/WHYPE/cbXRP/PRIME/msY/mF-ONE/aHYPER under 'other':
    -- they're either native gas tokens (HYPE, WHYPE, cbXRP) or unclassified
    -- on-chain mints we don't want to misfile into a thematic bucket yet.
    ELSE 'other'
  END
`;

// Same CASE applied symbol-side for filtering predicates.
const STABLECOIN_LIST = `(
  'USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD','FDUSD',
  'TUSD','MIM','BUIDL','RLUSD','USD0','USD0++','EUSD','MKUSD','FRXUSD','DEUSD','SDEUSD','USDD','USDM',
  'GUSD','USDX','USDY','USDTB','BOLD','GUSDC',
  -- Round 2 additions (see ASSET_CATEGORY_CASE comment)
  'SYRUPUSDC','AA_FALCONXUSDC','EURCV','WSRUSD','AUSD','VBUSDC','VBUSDT',
  'SIUSD','STCUSD','SUSDAT','STUSDS','USDT0','USD₮0','APXUSD','MSUSD','VUSD'
)`;

// ---------- Types ----------

export interface AssetsHeader {
  loanAssetCount: number;
  collateralAssetCount: number;
  marketCount: number;
  chainCount: number;
}

export interface AssetsKpis {
  totalSupplyUsd: number;
  totalSupply30dAgo: number | null;
  totalCollateralUsd: number;
  totalCollateral30dAgo: number | null;
  totalBorrowUsd: number;
  totalBorrow30dAgo: number | null;
  largestSupplySymbol: string | null;
  largestSupplyUsd: number;
  largestCollateralSymbol: string | null;
  largestCollateralUsd: number;
}

export interface ClassSlice {
  category: string;
  usd: number;
  topSymbol: string | null;
  topSymbolUsd: number;
}

export interface StablecoinBar {
  symbol: string;
  supplyUsd: number;
  isEthena: boolean;
}

export interface StablecoinBreakdown {
  bars: StablecoinBar[];
  ethenaCombinedUsd: number;
  ethenaSharePct: number;          // of stablecoin supply
  stablecoinTotalUsd: number;
}

export interface TopCollateralRow {
  symbol: string;
  category: string;
  chainCount: number;
  collateralizingUsd: number;
  marketCount: number;
  maxLltvPct: number | null;       // 0..1
  weightedUtil: number | null;     // 0..1
}

export interface ClassShareOverTimePoint {
  date: string;
  // dynamic per-category keys → share value 0..1
  [cat: string]: string | number | null;
}

export interface ChainMixCell {
  chainSlug: string;
  category: string;
  supplyUsd: number;
}

export interface ChainMixMatrix {
  chains: { slug: string; name: string; totalUsd: number }[];
  categories: string[];
  cells: ChainMixCell[];
  // pre-computed structural identity lines for the footer
  identityLines: { chainSlug: string; line: string }[];
}

export interface UncategorizedAsset {
  symbol: string;
  side: 'loan' | 'collateral';
  totalUsd: number;
  marketCount: number;
}

// ---------- Queries ----------

export const getAssetsHeaderStats = unstable_cache(
  async (): Promise<AssetsHeader> => {
    const sql = getDb();
    const rows = (await sql`
      SELECT
        (SELECT COUNT(DISTINCT loan_asset_symbol)::int      FROM morpho_.markets) AS loan_assets,
        (SELECT COUNT(DISTINCT collateral_asset_symbol)::int FROM morpho_.markets WHERE collateral_asset_symbol IS NOT NULL) AS collateral_assets,
        (SELECT COUNT(*)::int                                FROM morpho_.markets) AS markets,
        (SELECT COUNT(DISTINCT chain_id)::int                FROM morpho_.markets) AS chains
    `) as { loan_assets: number; collateral_assets: number; markets: number; chains: number }[];
    const r = rows[0]!;
    return {
      loanAssetCount: r.loan_assets,
      collateralAssetCount: r.collateral_assets,
      marketCount: r.markets,
      chainCount: r.chains,
    };
  },
  [CACHE_VERSION, 'header'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getAssetsKpis = unstable_cache(
  async (): Promise<AssetsKpis> => {
    const sql = getDb();
    // Latest market state per market — both today and ~30d ago.
    const rows = (await sql`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, borrow_assets_usd, collateral_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      ago AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, borrow_assets_usd, collateral_assets_usd
        FROM morpho_.market_state_daily
        WHERE snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY market_unique_key, snapshot_date DESC
      ),
      -- Filter NULL/0 USD market_state rows so phantom positions (e.g. BONDUSD
      -- has $0 collateral but $3B borrowed) don't outrank real assets, and use
      -- explicit NULLS LAST so DESC ordering never surfaces a NULL sum first.
      sup AS (
        SELECT m.loan_asset_symbol AS symbol, SUM(l.supply_assets_usd)::float8 AS usd
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE l.supply_assets_usd IS NOT NULL AND l.supply_assets_usd > 0
        GROUP BY m.loan_asset_symbol
        HAVING SUM(l.supply_assets_usd) > 0
        ORDER BY usd DESC NULLS LAST
        LIMIT 1
      ),
      col AS (
        SELECT m.collateral_asset_symbol AS symbol, SUM(l.collateral_assets_usd)::float8 AS usd
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE m.collateral_asset_symbol IS NOT NULL
          AND l.collateral_assets_usd IS NOT NULL AND l.collateral_assets_usd > 0
        GROUP BY m.collateral_asset_symbol
        HAVING SUM(l.collateral_assets_usd) > 0
        ORDER BY usd DESC NULLS LAST
        LIMIT 1
      )
      SELECT
        (SELECT SUM(supply_assets_usd)::float8     FROM latest) AS supply,
        (SELECT SUM(borrow_assets_usd)::float8     FROM latest) AS borrow,
        (SELECT SUM(collateral_assets_usd)::float8 FROM latest) AS collateral,
        (SELECT SUM(supply_assets_usd)::float8     FROM ago)    AS supply_30,
        (SELECT SUM(borrow_assets_usd)::float8     FROM ago)    AS borrow_30,
        (SELECT SUM(collateral_assets_usd)::float8 FROM ago)    AS collateral_30,
        (SELECT symbol  FROM sup) AS largest_supply_symbol,
        (SELECT usd     FROM sup) AS largest_supply_usd,
        (SELECT symbol  FROM col) AS largest_collateral_symbol,
        (SELECT usd     FROM col) AS largest_collateral_usd
    `) as {
      supply: number | null; borrow: number | null; collateral: number | null;
      supply_30: number | null; borrow_30: number | null; collateral_30: number | null;
      largest_supply_symbol: string | null; largest_supply_usd: number | null;
      largest_collateral_symbol: string | null; largest_collateral_usd: number | null;
    }[];
    const r = rows[0]!;
    return {
      totalSupplyUsd:     r.supply ?? 0,
      totalSupply30dAgo:  r.supply_30,
      totalCollateralUsd: r.collateral ?? 0,
      totalCollateral30dAgo: r.collateral_30,
      totalBorrowUsd:     r.borrow ?? 0,
      totalBorrow30dAgo:  r.borrow_30,
      largestSupplySymbol: r.largest_supply_symbol,
      largestSupplyUsd:   r.largest_supply_usd ?? 0,
      largestCollateralSymbol: r.largest_collateral_symbol,
      largestCollateralUsd: r.largest_collateral_usd ?? 0,
    };
  },
  [CACHE_VERSION, 'kpis'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getSupplyByAssetClass = unstable_cache(
  async (): Promise<ClassSlice[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      classed AS (
        SELECT
          ${ASSET_CATEGORY_CASE('m.loan_asset_symbol')} AS category,
          m.loan_asset_symbol AS symbol,
          l.supply_assets_usd::float8 AS usd
        FROM morpho_.markets m
        JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE l.supply_assets_usd IS NOT NULL AND l.supply_assets_usd > 0
      ),
      by_cat AS (SELECT category, SUM(usd)::float8 AS usd FROM classed GROUP BY category),
      top_sym AS (
        SELECT DISTINCT ON (category)
          category, symbol, SUM(usd) OVER (PARTITION BY category, symbol)::float8 AS sym_usd
        FROM classed ORDER BY category, sym_usd DESC
      )
      SELECT b.category, b.usd, t.symbol AS top_symbol, t.sym_usd
      FROM by_cat b LEFT JOIN top_sym t USING (category)
      ORDER BY b.usd DESC
      `,
      [],
    )) as { category: string; usd: number; top_symbol: string | null; sym_usd: number | null }[];
    return rows.map((r) => ({
      category: r.category,
      usd: r.usd,
      topSymbol: r.top_symbol,
      topSymbolUsd: r.sym_usd ?? 0,
    }));
  },
  [CACHE_VERSION, 'supply-class'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getCollateralByAssetClass = unstable_cache(
  async (): Promise<ClassSlice[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, collateral_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      classed AS (
        SELECT
          ${ASSET_CATEGORY_CASE('m.collateral_asset_symbol')} AS category,
          m.collateral_asset_symbol AS symbol,
          l.collateral_assets_usd::float8 AS usd
        FROM morpho_.markets m
        JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE m.collateral_asset_symbol IS NOT NULL
          AND l.collateral_assets_usd IS NOT NULL AND l.collateral_assets_usd > 0
      ),
      by_cat AS (SELECT category, SUM(usd)::float8 AS usd FROM classed GROUP BY category),
      top_sym AS (
        SELECT DISTINCT ON (category)
          category, symbol, SUM(usd) OVER (PARTITION BY category, symbol)::float8 AS sym_usd
        FROM classed ORDER BY category, sym_usd DESC
      )
      SELECT b.category, b.usd, t.symbol AS top_symbol, t.sym_usd
      FROM by_cat b LEFT JOIN top_sym t USING (category)
      ORDER BY b.usd DESC
      `,
      [],
    )) as { category: string; usd: number; top_symbol: string | null; sym_usd: number | null }[];
    return rows.map((r) => ({
      category: r.category,
      usd: r.usd,
      topSymbol: r.top_symbol,
      topSymbolUsd: r.sym_usd ?? 0,
    }));
  },
  [CACHE_VERSION, 'collateral-class'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getStablecoinBreakdown = unstable_cache(
  async (): Promise<StablecoinBreakdown> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT m.loan_asset_symbol AS symbol,
             SUM(l.supply_assets_usd)::float8 AS usd
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      WHERE UPPER(m.loan_asset_symbol) IN ${STABLECOIN_LIST}
        AND l.supply_assets_usd > 0
      GROUP BY m.loan_asset_symbol
      ORDER BY usd DESC
      `,
      [],
    )) as { symbol: string; usd: number }[];

    const ethenaSymbols = new Set(['USDE', 'SUSDE', 'USDTB']);
    const bars: StablecoinBar[] = rows.map((r) => ({
      symbol: r.symbol,
      supplyUsd: r.usd,
      isEthena: ethenaSymbols.has(r.symbol.toUpperCase()),
    }));
    const total = bars.reduce((s, b) => s + b.supplyUsd, 0);
    const ethena = bars.filter((b) => b.isEthena).reduce((s, b) => s + b.supplyUsd, 0);
    return {
      bars,
      ethenaCombinedUsd: ethena,
      ethenaSharePct: total > 0 ? ethena / total : 0,
      stablecoinTotalUsd: total,
    };
  },
  [CACHE_VERSION, 'stablecoins'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getTopCollateralAssets = unstable_cache(
  async (limit = 20): Promise<TopCollateralRow[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, borrow_assets_usd, utilization
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.collateral_asset_symbol                                              AS symbol,
        ${ASSET_CATEGORY_CASE('m.collateral_asset_symbol')}                    AS category,
        COUNT(DISTINCT m.chain_id)::int                                         AS chain_count,
        SUM(l.borrow_assets_usd)::float8                                        AS collateralizing,
        COUNT(*)::int                                                           AS market_count,
        MAX(m.lltv)::float8                                                     AS max_lltv,
        CASE WHEN SUM(l.supply_assets_usd) > 0
             THEN SUM(COALESCE(l.utilization, 0) * COALESCE(l.supply_assets_usd, 0)) / SUM(l.supply_assets_usd)::float8
             ELSE NULL END                                                       AS weighted_util
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      WHERE m.collateral_asset_symbol IS NOT NULL
      GROUP BY m.collateral_asset_symbol
      ORDER BY collateralizing DESC NULLS LAST
      LIMIT $1
      `,
      [limit],
    )) as {
      symbol: string; category: string; chain_count: number;
      collateralizing: number | null; market_count: number;
      max_lltv: number | null; weighted_util: number | null;
    }[];
    return rows.map((r) => ({
      symbol: r.symbol,
      category: r.category,
      chainCount: r.chain_count,
      collateralizingUsd: r.collateralizing ?? 0,
      marketCount: r.market_count,
      // lltv is stored as 1e18-scaled NUMERIC; convert to 0..1.
      maxLltvPct: r.max_lltv != null ? Number(r.max_lltv) : null,
      weightedUtil: r.weighted_util,
    }));
  },
  [CACHE_VERSION, 'top-collateral'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getAssetClassShareOverTime = unstable_cache(
  async (days = 365): Promise<ClassShareOverTimePoint[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH classed AS (
        SELECT
          s.snapshot_date::text AS date,
          ${ASSET_CATEGORY_CASE('m.loan_asset_symbol')} AS category,
          SUM(s.supply_assets_usd)::float8 AS supply_usd
        FROM morpho_.market_state_daily s
        JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
        WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
          AND s.supply_assets_usd IS NOT NULL AND s.supply_assets_usd > 0
        GROUP BY s.snapshot_date, ${ASSET_CATEGORY_CASE('m.loan_asset_symbol')}
      ),
      totals AS (SELECT date, SUM(supply_usd) AS total FROM classed GROUP BY date)
      SELECT c.date, c.category,
             (c.supply_usd / NULLIF(t.total, 0))::float8 AS share
      FROM classed c JOIN totals t USING (date)
      ORDER BY c.date ASC, c.category
      `,
      [days],
    )) as { date: string; category: string; share: number | null }[];

    // Pivot long → wide
    const byDate = new Map<string, ClassShareOverTimePoint>();
    for (const r of rows) {
      let p = byDate.get(r.date);
      if (!p) { p = { date: r.date }; byDate.set(r.date, p); }
      p[r.category] = r.share;
    }
    return [...byDate.values()];
  },
  [CACHE_VERSION, 'class-over-time'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getChainAssetMixMatrix = unstable_cache(
  async (topChains = 8): Promise<ChainMixMatrix> => {
    const sql = getDb();

    // Top chains by today's Morpho supply USD
    const chainsRows = (await sql`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT m.chain_id, ch.slug, ch.name, SUM(l.supply_assets_usd)::float8 AS total
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      GROUP BY m.chain_id, ch.slug, ch.name
      ORDER BY total DESC NULLS LAST
      LIMIT ${topChains}
    `) as { chain_id: number; slug: string; name: string; total: number }[];

    const chainIds = chainsRows.map((c) => c.chain_id);
    if (chainIds.length === 0) {
      return { chains: [], categories: [], cells: [], identityLines: [] };
    }

    const cellRows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        ch.slug                                                         AS chain_slug,
        ${ASSET_CATEGORY_CASE('m.collateral_asset_symbol')}             AS category,
        SUM(l.supply_assets_usd)::float8                                 AS usd
      FROM morpho_.markets m
      JOIN latest l   ON l.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE m.chain_id = ANY($1::int[])
        AND m.collateral_asset_symbol IS NOT NULL
        AND l.supply_assets_usd > 0
      GROUP BY ch.slug, ${ASSET_CATEGORY_CASE('m.collateral_asset_symbol')}
      `,
      [chainIds],
    )) as { chain_slug: string; category: string; usd: number }[];

    const categories = ['stablecoin', 'lst', 'lrt', 'btc', 'eth', 'rwa', 'other'];

    // Identity lines for the footer note: pick the dominant category per chain.
    const bySlug = new Map<string, { cats: Record<string, number>; total: number }>();
    for (const r of cellRows) {
      const e = bySlug.get(r.chain_slug) ?? { cats: {}, total: 0 };
      e.cats[r.category] = (e.cats[r.category] ?? 0) + r.usd;
      e.total += r.usd;
      bySlug.set(r.chain_slug, e);
    }
    const identityLines: { chainSlug: string; line: string }[] = [];
    for (const c of chainsRows) {
      const e = bySlug.get(c.slug);
      if (!e || e.total === 0) continue;
      const entries = Object.entries(e.cats).sort((a, b) => b[1] - a[1]);
      const [topCat, topUsd] = entries[0]!;
      const pct = (topUsd / e.total) * 100;
      const labels: Record<string, string> = {
        stablecoin: 'stablecoin-collateralized',
        lst: 'LST-collateralized',
        lrt: 'LRT-collateralized',
        btc: 'BTC-collateralized',
        eth: 'ETH-collateralized',
        rwa: 'RWA-collateralized',
        other: `${topCat}-heavy`,
      };
      identityLines.push({
        chainSlug: c.slug,
        line: `${c.name} is ${pct.toFixed(0)}% ${labels[topCat] ?? topCat}`,
      });
    }

    return {
      chains: chainsRows.map((c) => ({ slug: c.slug, name: c.name, totalUsd: c.total ?? 0 })),
      categories,
      cells: cellRows.map((r) => ({ chainSlug: r.chain_slug, category: r.category, supplyUsd: r.usd })),
      identityLines,
    };
  },
  [CACHE_VERSION, 'chain-mix'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getUncategorizedAssets = unstable_cache(
  async (minUsd = 10_000_000): Promise<UncategorizedAsset[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, collateral_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      loan_side AS (
        SELECT m.loan_asset_symbol AS symbol, 'loan' AS side,
               SUM(l.supply_assets_usd)::float8 AS usd,
               COUNT(*)::int AS markets
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE ${ASSET_CATEGORY_CASE('m.loan_asset_symbol')} = 'other'
        GROUP BY m.loan_asset_symbol
      ),
      coll_side AS (
        SELECT m.collateral_asset_symbol AS symbol, 'collateral' AS side,
               SUM(l.collateral_assets_usd)::float8 AS usd,
               COUNT(*)::int AS markets
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE m.collateral_asset_symbol IS NOT NULL
          AND ${ASSET_CATEGORY_CASE('m.collateral_asset_symbol')} = 'other'
        GROUP BY m.collateral_asset_symbol
      ),
      combined AS (SELECT * FROM loan_side UNION ALL SELECT * FROM coll_side)
      SELECT * FROM combined
      WHERE usd >= $1
      ORDER BY usd DESC
      LIMIT 30
      `,
      [minUsd],
    )) as { symbol: string; side: 'loan' | 'collateral'; usd: number; markets: number }[];
    return rows.map((r) => ({
      symbol: r.symbol,
      side: r.side,
      totalUsd: r.usd,
      marketCount: r.markets,
    }));
  },
  [CACHE_VERSION, 'uncategorized'],
  { revalidate: TTL, tags: ['assets'] },
);
