// Assets-surface queries.
//
// All composition is derived from `markets` × `market_state_daily` because
// vault_allocations_daily is empty. Every Morpho market has both a
// loan_asset (the "supply side") and a collateral_asset (the "collateral side"),
// so a chain-aware aggregate over the latest market_state row per market
// gives us total supply / borrow / collateral by asset class.

import { unstable_cache } from 'next/cache';

import { getDb } from '../db.js';

const CACHE_VERSION = 'assets-v2';
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
          -- Round 3. Pendle PTs of USD-pegged yield stables (apyUSD, reUSD, apxUSD).
          OR UPPER(${col}) LIKE 'PT-APYUSD%' OR UPPER(${col}) LIKE 'PT-REUSD%' OR UPPER(${col}) LIKE 'PT-APXUSD%'
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
      -- Round 2. Added after sanity-bondusd.ts surfaced these as the next
      -- 30 uncategorized symbols >$10M. Wrapped USDC/USDT family (vb*, USDT0,
      -- USD₮0), credit-bearing stable derivatives (syrupUSDC, AA_FalconXUSDC,
      -- siUSD, stcUSD, sUSDat, wsrUSD), MakerDAO stUSDS, Aave AUSD, Anchorage
      -- EURCV, msUSD/vUSD/apxUSD stable mints.
      'SYRUPUSDC','AA_FALCONXUSDC','EURCV','WSRUSD','AUSD','VBUSDC','VBUSDT',
      'SIUSD','STCUSD','SUSDAT','STUSDS','USDT0','USD₮0','APXUSD','MSUSD','VUSD',
      -- Round 3. Uncategorized >$10M sweep (sources in comments):
      -- EURC: Circle's euro stablecoin (fiat-backed). apyUSD: Aphelion yield USD.
      -- reUSD: Resupply USD. savUSD: Sapien/Savings USD. USN/sUSN: Noon USN +
      -- its staked form. upGAMMAusdc: Gamma Strategies USDC LP wrapper (USDC-denom).
      'EURC','APYUSD','REUSD','SAVUSD','USN','SUSN','UPGAMMAUSDC'
    ) THEN 'stablecoin'
    WHEN UPPER(${col}) IN (
      'WSTETH','STETH','RETH','CBETH','SFRXETH','ETHX','SWETH','OSETH','ANKRETH',
      -- Round 2. Hyperliquid staked HYPE variants behave as LSTs of their L1
      -- gas token; Origin's OETH is a stETH-style yield wrapper.
      'KHYPE','STHYPE','OETH'
    ) THEN 'lst'
    WHEN UPPER(${col}) IN ('WEETH','EZETH','RSETH','PUFETH','EETH','RSTETH','AMPHRETH','KINGETH','UNIETH')
      THEN 'lrt'
    WHEN UPPER(${col}) IN (
      'WBTC','CBBTC','LBTC','TBTC','EBTC','SOLVBTC','STBTC','FBTC','M-BTC','UNIBTC','ENZOBTC','KBTC',
      'PUMPBTC','SOLVBTC.BBN','BTCB','XBTC','WBTC18',
      -- Round 2. Venus / Binance-bridged WBTC clone on BNB/Hyper.
      'VBWBTC'
    ) THEN 'btc'
    WHEN UPPER(${col}) IN (
      'WETH','ETH',
      -- Round 2. Venus / Binance-bridged WETH clone.
      'VBETH',
      -- Round 3. MsETH (Metronome synth ETH), yvvbETH (Yearn vault of bridged ETH).
      'MSETH','YVVBETH'
    ) THEN 'eth'
    WHEN UPPER(${col}) IN (
      'SDAI','PAXG','USTB','OUSG','UDUSD','SBUIDL',
      -- Round 2. Tether Gold ticker.
      'XAUT',
      -- Round 3. MuBOND (tokenized bond), mF-ONE (Midas tokenized fund). Both RWA.
      'MUBOND','MF-ONE'
    )
      OR UPPER(${col}) LIKE 'YT-%'
      OR UPPER(${col}) LIKE '%RWA%'
      THEN 'rwa'
    -- Round 3. Reviewed and intentionally left 'other' (no thematic bucket fits):
    -- WHYPE/HYPE & aHYPER (Hyperliquid native gas token + an aHYPER wrapper),
    -- cbXRP (Coinbase-wrapped XRP. Volatile alt), PRIME (Echelon Prime gaming
    -- token), msY (Metalswap/unclassified yield token), dCOMP (Compound-linked
    -- derivative, ambiguous). These are genuinely-other, not unreviewed.
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
  'SIUSD','STCUSD','SUSDAT','STUSDS','USDT0','USD₮0','APXUSD','MSUSD','VUSD',
  -- Round 3 (see ASSET_CATEGORY_CASE)
  'EURC','APYUSD','REUSD','SAVUSD','USN','SUSN','UPGAMMAUSDC'
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
    // Latest market state per market. Both today and ~30d ago.
    const rows = (await sql`
      WITH latest AS (
        -- Exclude degenerate-IRM markets (latest APY > 100% ⇒ bad oracle that
        -- also inflates USD figures, e.g. BONDUSD's phantom $3B borrow).
        SELECT * FROM (
          SELECT DISTINCT ON (market_unique_key)
            market_unique_key, supply_assets_usd, borrow_assets_usd, collateral_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
        ) q WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
      ),
      ago AS (
        SELECT * FROM (
          SELECT DISTINCT ON (market_unique_key)
            market_unique_key, supply_assets_usd, borrow_assets_usd, collateral_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily
          WHERE snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY market_unique_key, snapshot_date DESC
        ) q WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
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
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
          WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
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
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, collateral_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
          WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
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
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
          WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
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
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, borrow_assets_usd, utilization, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
          WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
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
          AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0) AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
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
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
          WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
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
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
          WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
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
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, collateral_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
          WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
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

// ===========================================================================
// PART B. Balance-sheet framing for the /assets redesign.
//
// Loan-asset side (supply): Total Supply, Borrow Interest (Σ borrow × LEAST(
// borrow_apy,1.0)), Net Lender Yield (Σ supply × LEAST(supply_apy,1.0)).
// Collateral side: Total Collateral, # markets, weighted LLTV.
// Degenerate-IRM markets (APY>100%) excluded; LEAST as a defensive backstop.
// ===========================================================================

const LB_CACHE = 'assets-balancesheet-v2';

// Latest non-degenerate market state per market (full column set).
const LATEST_FULL = `latest AS (
  SELECT * FROM (SELECT DISTINCT ON (market_unique_key)
    market_unique_key, supply_assets_usd, borrow_assets_usd, collateral_assets_usd,
    supply_apy, borrow_apy, utilization, bad_debt_assets_usd
  FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
  WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0))`;
const LATEST_30 = `latest30 AS (
  SELECT * FROM (SELECT DISTINCT ON (market_unique_key)
    market_unique_key, supply_assets_usd, collateral_assets_usd, supply_apy, borrow_apy
  FROM morpho_.market_state_daily WHERE snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
  ORDER BY market_unique_key, snapshot_date DESC) q
  WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0))`;

function growth30d(now: number, ago: number | null): number | null {
  if (ago == null || ago <= 0) return null;
  return (now - ago) / ago;
}
function doublingTimeDays(rate: number | null): number | null {
  if (rate == null || rate <= 0) return null;
  const d = (Math.log(2) / Math.log(1 + rate)) * 30;
  return Number.isFinite(d) && d > 0 ? d : null;
}

export interface AssetClassEconomics {
  category: string;
  totalSupply: number;
  totalCollateral: number;
  borrowInterestGen: number;     // annualized
  netLenderYield: number;
  avgUtilization: number | null; // supply-weighted
  avgSupplyApy: number | null;   // supply-weighted, clamped
  supply30dAgo: number | null;
  supply30dDeltaPct: number | null;
  doublingTimeDays: number | null;
}

export const getAssetClassEconomicsHeatmap = unstable_cache(
  async (): Promise<AssetClassEconomics[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH ${LATEST_FULL}, ${LATEST_30},
      loan AS (
        SELECT ${ASSET_CATEGORY_CASE('m.loan_asset_symbol')} AS cat,
          SUM(l.supply_assets_usd)::float8 AS supply,
          SUM(l.borrow_assets_usd * LEAST(l.borrow_apy, 1.0))::float8 AS borrow_interest,
          SUM(l.supply_assets_usd * LEAST(l.supply_apy, 1.0))::float8 AS lender_yield,
          SUM(COALESCE(l.utilization, 0) * COALESCE(l.supply_assets_usd, 0))::float8 AS util_num,
          SUM(l.supply_assets_usd * LEAST(l.supply_apy, 1.0))::float8 AS sapy_num
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE l.supply_assets_usd > 0 GROUP BY 1
      ),
      loan30 AS (
        SELECT ${ASSET_CATEGORY_CASE('m.loan_asset_symbol')} AS cat, SUM(l.supply_assets_usd)::float8 AS supply30
        FROM morpho_.markets m JOIN latest30 l ON l.market_unique_key = m.unique_key
        WHERE l.supply_assets_usd > 0 GROUP BY 1
      ),
      coll AS (
        SELECT ${ASSET_CATEGORY_CASE('m.collateral_asset_symbol')} AS cat, SUM(l.collateral_assets_usd)::float8 AS collateral
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE m.collateral_asset_symbol IS NOT NULL AND l.collateral_assets_usd > 0 GROUP BY 1
      )
      SELECT COALESCE(loan.cat, coll.cat) AS cat,
        COALESCE(loan.supply, 0) AS supply, COALESCE(coll.collateral, 0) AS collateral,
        COALESCE(loan.borrow_interest, 0) AS borrow_interest, COALESCE(loan.lender_yield, 0) AS lender_yield,
        loan.util_num, loan.sapy_num, loan30.supply30
      FROM loan FULL OUTER JOIN coll USING (cat) LEFT JOIN loan30 USING (cat)
      `,
      [],
    )) as { cat: string; supply: number; collateral: number; borrow_interest: number; lender_yield: number; util_num: number | null; sapy_num: number | null; supply30: number | null }[];
    return rows.map((r) => {
      const delta = growth30d(r.supply, r.supply30);
      return {
        category: r.cat,
        totalSupply: r.supply,
        totalCollateral: r.collateral,
        borrowInterestGen: r.borrow_interest,
        netLenderYield: r.lender_yield,
        avgUtilization: r.supply > 0 && r.util_num != null ? r.util_num / r.supply : null,
        avgSupplyApy: r.supply > 0 && r.sapy_num != null ? r.sapy_num / r.supply : null,
        supply30dAgo: r.supply30,
        supply30dDeltaPct: delta,
        doublingTimeDays: doublingTimeDays(delta),
      };
    }).sort((a, b) => b.totalSupply - a.totalSupply);
  },
  [LB_CACHE, 'class-economics'],
  { revalidate: TTL, tags: ['assets'] },
);

// ---------- Per-asset aggregation (for KPIs, velocity, risk) ----------

export interface AssetAgg {
  symbol: string;
  category: string;
  totalSupply: number;
  borrowInterestGen: number;
  avgUtilization: number | null;
  supply30dAgo: number | null;
  supply30dDeltaPct: number | null;
  marketCount: number;
}

async function loadLoanAssetAgg(sql: ReturnType<typeof getDb>): Promise<AssetAgg[]> {
  const rows = (await sql(
    `
    WITH ${LATEST_FULL}, ${LATEST_30},
    cur AS (
      SELECT m.loan_asset_symbol AS sym, ${ASSET_CATEGORY_CASE('m.loan_asset_symbol')} AS cat,
        SUM(l.supply_assets_usd)::float8 AS supply,
        SUM(l.borrow_assets_usd * LEAST(l.borrow_apy, 1.0))::float8 AS borrow_interest,
        SUM(COALESCE(l.utilization, 0) * COALESCE(l.supply_assets_usd, 0))::float8 AS util_num,
        COUNT(*)::int AS markets
      FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
      WHERE l.supply_assets_usd > 0 GROUP BY m.loan_asset_symbol
    ),
    ago AS (
      SELECT m.loan_asset_symbol AS sym, SUM(l.supply_assets_usd)::float8 AS supply30
      FROM morpho_.markets m JOIN latest30 l ON l.market_unique_key = m.unique_key
      WHERE l.supply_assets_usd > 0 GROUP BY m.loan_asset_symbol
    )
    SELECT cur.*, ago.supply30 FROM cur LEFT JOIN ago USING (sym) ORDER BY cur.supply DESC
    `,
    [],
  )) as { sym: string; cat: string; supply: number; borrow_interest: number; util_num: number | null; markets: number; supply30: number | null }[];
  return rows.map((r) => {
    const delta = growth30d(r.supply, r.supply30);
    return {
      symbol: r.sym, category: r.cat, totalSupply: r.supply, borrowInterestGen: r.borrow_interest,
      avgUtilization: r.supply > 0 && r.util_num != null ? r.util_num / r.supply : null,
      supply30dAgo: r.supply30, supply30dDeltaPct: delta, marketCount: r.markets,
    };
  });
}

export interface AssetSuperlative { key: string; label: string; value: string; caption: string; symbol: string | null; }

export const getAssetsHeadlineKpis = unstable_cache(
  async (): Promise<AssetSuperlative[]> => {
    const sql = getDb();
    const [loanAgg, classEcon, collClass] = await Promise.all([
      loadLoanAssetAgg(sql), getAssetClassEconomicsHeatmap(), getCollateralByAssetClass(),
    ]);
    const totalSupply = loanAgg.reduce((s, a) => s + a.totalSupply, 0);
    const totalCollateral = collClass.reduce((s, c) => s + c.usd, 0);
    // Compact USD with B/M rollover (matches fmtUsd compact elsewhere).
    const usd = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(v);
    const pick = <T,>(arr: T[], f: (t: T) => number | null) => arr.reduce<T | null>((b, t) => (f(t) != null && Number.isFinite(f(t)!) && (b == null || f(t)! > f(b)!) ? t : b), null);

    const largestSupply = loanAgg[0] ?? null;
    const topInterest = pick(loanAgg, (a) => a.borrowInterestGen);
    const material = loanAgg.filter((a) => a.totalSupply >= 5_000_000);
    const fastest = pick(material.length ? material : loanAgg, (a) => a.supply30dDeltaPct);
    const topUtil = pick(material.length ? material : loanAgg, (a) => a.avgUtilization);
    // largest collateral asset (symbol)
    const largestColl = await getAssetsKpis();
    // most concentrated collateral class
    const topCollClass = collClass[0] ?? null;

    const labelClass: Record<string, string> = { stablecoin: 'Stablecoin', lst: 'LST', lrt: 'LRT', btc: 'BTC', eth: 'ETH', rwa: 'RWA', other: 'Other' };
    return [
      { key: 'largest-supply', label: 'Largest Supply Asset', symbol: largestSupply?.symbol ?? null, value: largestSupply?.symbol ?? 'N/A', caption: largestSupply ? `${usd(largestSupply.totalSupply)} · ${(totalSupply > 0 ? (largestSupply.totalSupply / totalSupply) * 100 : 0).toFixed(1)}% of supply` : 'N/A' },
      { key: 'largest-collateral', label: 'Largest Collateral Asset', symbol: largestColl.largestCollateralSymbol, value: largestColl.largestCollateralSymbol ?? 'N/A', caption: usd(largestColl.largestCollateralUsd) },
      { key: 'highest-borrow-interest', label: 'Highest Borrow Interest Generated', symbol: topInterest?.symbol ?? null, value: topInterest?.symbol ?? 'N/A', caption: topInterest ? `${usd(topInterest.borrowInterestGen)} annualized` : 'N/A' },
      { key: 'fastest-supply-growth', label: 'Fastest Supply Growth 30d', symbol: fastest?.symbol ?? null, value: fastest?.symbol ?? 'N/A', caption: fastest?.supply30dDeltaPct != null ? `+${(fastest.supply30dDeltaPct * 100).toFixed(1)}% over 30d` : 'no baseline' },
      { key: 'most-concentrated-class', label: 'Most Concentrated Collateral Class', symbol: null, value: topCollClass ? (labelClass[topCollClass.category] ?? topCollClass.category) : 'N/A', caption: topCollClass && totalCollateral > 0 ? `${((topCollClass.usd / totalCollateral) * 100).toFixed(1)}% of collateral` : 'N/A' },
      { key: 'highest-utilization', label: 'Highest Utilization Asset', symbol: topUtil?.symbol ?? null, value: topUtil?.symbol ?? 'N/A', caption: topUtil?.avgUtilization != null ? `${(topUtil.avgUtilization * 100).toFixed(1)}% utilized` : 'N/A' },
    ];
  },
  [LB_CACHE, 'headline-kpis'],
  { revalidate: TTL, tags: ['assets'] },
);

// ---------- Asset class composition over time (3 toggles) ----------

export type AssetMixMetric = 'SUPPLY' | 'COLLATERAL' | 'BORROW_INTEREST';
export interface AssetCompositionPoint { date: string; [cat: string]: string | number | null; }
export interface AssetCompositionPayload {
  defaultMetric: AssetMixMetric;
  categories: string[];
  byMetric: Record<AssetMixMetric, AssetCompositionPoint[]>;
  subtitle: { stableSupplyNow: number; stableSupply12mo: number | null; btcCollNow: number; btcColl12mo: number | null };
}

export const getAssetClassCompositionSeries = unstable_cache(
  async (days = 365): Promise<AssetCompositionPayload> => {
    const sql = getDb();
    const rows = (await sql(
      `
      SELECT s.snapshot_date::text AS date,
        ${ASSET_CATEGORY_CASE('m.loan_asset_symbol')} AS loan_cat,
        ${ASSET_CATEGORY_CASE('m.collateral_asset_symbol')} AS coll_cat,
        SUM(s.supply_assets_usd)::float8 AS supply,
        SUM(s.collateral_assets_usd)::float8 AS collateral,
        SUM(s.borrow_assets_usd * LEAST(s.borrow_apy, 1.0))::float8 AS borrow_interest
      FROM morpho_.market_state_daily s
      JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
      WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0) AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      GROUP BY s.snapshot_date, loan_cat, coll_cat
      `,
      [days],
    )) as { date: string; loan_cat: string; coll_cat: string; supply: number | null; collateral: number | null; borrow_interest: number | null }[];

    const supply = new Map<string, AssetCompositionPoint>();
    const collateral = new Map<string, AssetCompositionPoint>();
    const interest = new Map<string, AssetCompositionPoint>();
    const ens = (m: Map<string, AssetCompositionPoint>, d: string) => { let p = m.get(d); if (!p) { p = { date: d }; m.set(d, p); } return p; };
    for (const r of rows) {
      const sp = ens(supply, r.date); sp[r.loan_cat] = ((sp[r.loan_cat] as number) ?? 0) + (r.supply ?? 0);
      const ip = ens(interest, r.date); ip[r.loan_cat] = ((ip[r.loan_cat] as number) ?? 0) + (r.borrow_interest ?? 0);
      const cp = ens(collateral, r.date); cp[r.coll_cat] = ((cp[r.coll_cat] as number) ?? 0) + (r.collateral ?? 0);
    }
    const sortD = (m: Map<string, AssetCompositionPoint>) => [...m.values()].sort((a, b) => (a.date as string).localeCompare(b.date as string));
    const supA = sortD(supply), colA = sortD(collateral);
    const shareOf = (arr: AssetCompositionPoint[], cat: string, idx: number) => {
      const p = arr[idx]; if (!p) return 0; const total = Object.entries(p).filter(([k]) => k !== 'date').reduce((s, [, v]) => s + (Number(v) || 0), 0);
      return total > 0 ? (Number(p[cat]) || 0) / total : 0;
    };
    const idx12 = Math.max(0, supA.length - 365);
    return {
      defaultMetric: 'SUPPLY',
      categories: ['stablecoin', 'lst', 'lrt', 'btc', 'eth', 'rwa', 'other'],
      byMetric: { SUPPLY: supA, COLLATERAL: colA, BORROW_INTEREST: sortD(interest) },
      subtitle: {
        stableSupplyNow: shareOf(supA, 'stablecoin', supA.length - 1),
        stableSupply12mo: supA.length > 365 ? shareOf(supA, 'stablecoin', idx12) : null,
        btcCollNow: shareOf(colA, 'btc', colA.length - 1),
        btcColl12mo: colA.length > 365 ? shareOf(colA, 'btc', idx12) : null,
      },
    };
  },
  [LB_CACHE, 'composition-series'],
  { revalidate: TTL, tags: ['assets'] },
);

// ---------- Stablecoin deep dive ----------

export interface StablecoinDeepRow { symbol: string; supplyUsd: number; borrowInterestGen: number; avgSupplyApy: number | null; marketCount: number; supply30dDeltaPct: number | null; isEthena: boolean; }
export interface StablecoinDeepDive {
  rows: StablecoinDeepRow[];
  totalUsd: number;
  ethenaCombinedUsd: number;
  ethenaSharePct: number;
  tbillRatePct: number | null;       // risk-free 3M, as a fraction (e.g. 0.0525)
}

export const getStablecoinDeepDive = unstable_cache(
  async (): Promise<StablecoinDeepDive> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH ${LATEST_FULL}, ${LATEST_30},
      cur AS (
        SELECT m.loan_asset_symbol AS sym,
          SUM(l.supply_assets_usd)::float8 AS supply,
          SUM(l.borrow_assets_usd * LEAST(l.borrow_apy, 1.0))::float8 AS borrow_interest,
          SUM(l.supply_assets_usd * LEAST(l.supply_apy, 1.0))::float8 AS sapy_num,
          COUNT(*)::int AS markets
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE UPPER(m.loan_asset_symbol) IN ${STABLECOIN_LIST} AND l.supply_assets_usd > 0
        GROUP BY m.loan_asset_symbol
      ),
      ago AS (
        SELECT m.loan_asset_symbol AS sym, SUM(l.supply_assets_usd)::float8 AS supply30
        FROM morpho_.markets m JOIN latest30 l ON l.market_unique_key = m.unique_key
        WHERE UPPER(m.loan_asset_symbol) IN ${STABLECOIN_LIST} AND l.supply_assets_usd > 0
        GROUP BY m.loan_asset_symbol
      )
      SELECT cur.*, ago.supply30 FROM cur LEFT JOIN ago USING (sym) ORDER BY cur.supply DESC
      `,
      [],
    )) as { sym: string; supply: number; borrow_interest: number; sapy_num: number | null; markets: number; supply30: number | null }[];

    const tbillRows = (await sql`SELECT rate_pct::float8 AS r FROM morpho_.tbill_rates_daily ORDER BY day DESC LIMIT 1`) as { r: number | null }[];
    const tbill = tbillRows[0]?.r != null ? tbillRows[0]!.r! / 100 : null;

    const ethena = new Set(['USDE', 'SUSDE', 'USDTB']);
    const deep: StablecoinDeepRow[] = rows.map((r) => ({
      symbol: r.sym, supplyUsd: r.supply, borrowInterestGen: r.borrow_interest,
      avgSupplyApy: r.supply > 0 && r.sapy_num != null ? r.sapy_num / r.supply : null,
      marketCount: r.markets, supply30dDeltaPct: growth30d(r.supply, r.supply30),
      isEthena: ethena.has(r.sym.toUpperCase()),
    }));
    const total = deep.reduce((s, b) => s + b.supplyUsd, 0);
    const ethenaUsd = deep.filter((b) => b.isEthena).reduce((s, b) => s + b.supplyUsd, 0);
    return { rows: deep, totalUsd: total, ethenaCombinedUsd: ethenaUsd, ethenaSharePct: total > 0 ? ethenaUsd / total : 0, tbillRatePct: tbill };
  },
  [LB_CACHE, 'stablecoin-deep'],
  { revalidate: TTL, tags: ['assets'] },
);

// ---------- Collateral deep dive ----------

export interface CollateralDeepRow { symbol: string; category: string; collateralUsd: number; marketCount: number; chainCount: number; maxLltvPct: number | null; weightedUtil: number | null; collateral30dDeltaPct: number | null; }
export interface CollateralDeepDive {
  rows: CollateralDeepRow[];
  totalCollateral: number;
  btc: { cbBTC: number; WBTC: number; LBTC: number; otherBtc: number; combined: number; sharePct: number };
  lstLrt: { lstTotal: number; wstEthUsd: number; wstEthShare: number; lrtTotal: number };
}

export const getCollateralDeepDive = unstable_cache(
  async (limit = 20): Promise<CollateralDeepDive> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH ${LATEST_FULL}, ${LATEST_30},
      cur AS (
        SELECT m.collateral_asset_symbol AS sym, ${ASSET_CATEGORY_CASE('m.collateral_asset_symbol')} AS cat,
          SUM(l.collateral_assets_usd)::float8 AS collateral,
          COUNT(*)::int AS markets, COUNT(DISTINCT m.chain_id)::int AS chains,
          MAX(m.lltv)::float8 AS max_lltv,
          SUM(COALESCE(l.utilization, 0) * COALESCE(l.collateral_assets_usd, 0))::float8 AS util_num,
          SUM(l.collateral_assets_usd)::float8 AS util_den
        FROM morpho_.markets m JOIN latest l ON l.market_unique_key = m.unique_key
        WHERE m.collateral_asset_symbol IS NOT NULL AND l.collateral_assets_usd > 0
        GROUP BY m.collateral_asset_symbol
      ),
      ago AS (
        SELECT m.collateral_asset_symbol AS sym, SUM(l.collateral_assets_usd)::float8 AS coll30
        FROM morpho_.markets m JOIN latest30 l ON l.market_unique_key = m.unique_key
        WHERE m.collateral_asset_symbol IS NOT NULL AND l.collateral_assets_usd > 0
        GROUP BY m.collateral_asset_symbol
      )
      SELECT cur.*, ago.coll30 FROM cur LEFT JOIN ago USING (sym) ORDER BY cur.collateral DESC
      `,
      [],
    )) as { sym: string; cat: string; collateral: number; markets: number; chains: number; max_lltv: number | null; util_num: number | null; util_den: number | null; coll30: number | null }[];

    const all: CollateralDeepRow[] = rows.map((r) => ({
      symbol: r.sym, category: r.cat, collateralUsd: r.collateral, marketCount: r.markets, chainCount: r.chains,
      maxLltvPct: r.max_lltv != null ? Number(r.max_lltv) : null,
      weightedUtil: r.util_den && r.util_den > 0 && r.util_num != null ? r.util_num / r.util_den : null,
      collateral30dDeltaPct: growth30d(r.collateral, r.coll30),
    }));
    const total = all.reduce((s, r) => s + r.collateralUsd, 0);
    const find = (sym: string) => all.find((r) => r.symbol.toUpperCase() === sym)?.collateralUsd ?? 0;
    const btcRows = all.filter((r) => r.category === 'btc');
    const btcCombined = btcRows.reduce((s, r) => s + r.collateralUsd, 0);
    const cbBTC = find('CBBTC'), WBTC = find('WBTC'), LBTC = find('LBTC');
    const lstRows = all.filter((r) => r.category === 'lst');
    const lstTotal = lstRows.reduce((s, r) => s + r.collateralUsd, 0);
    const wstEth = find('WSTETH');
    const lrtTotal = all.filter((r) => r.category === 'lrt').reduce((s, r) => s + r.collateralUsd, 0);
    return {
      rows: all.slice(0, limit), totalCollateral: total,
      btc: { cbBTC, WBTC, LBTC, otherBtc: btcCombined - cbBTC - WBTC - LBTC, combined: btcCombined, sharePct: total > 0 ? btcCombined / total : 0 },
      lstLrt: { lstTotal, wstEthUsd: wstEth, wstEthShare: lstTotal > 0 ? wstEth / lstTotal : 0, lrtTotal },
    };
  },
  [LB_CACHE, 'collateral-deep'],
  { revalidate: TTL, tags: ['assets'] },
);

// ---------- Per-chain asset mix matrix (+ borrow interest) ----------

export interface PerChainMixRow { chainSlug: string; chainName: string; totalSupply: number; borrowInterestGen: number; byClass: Record<string, number>; }

export const getPerChainAssetMixMatrix = unstable_cache(
  async (topChains = 8): Promise<{ chains: PerChainMixRow[]; categories: string[] }> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH ${LATEST_FULL}
      SELECT ch.slug AS chain_slug, ch.name AS chain_name,
        ${ASSET_CATEGORY_CASE('m.collateral_asset_symbol')} AS cat,
        SUM(l.collateral_assets_usd)::float8 AS collateral,
        SUM(l.borrow_assets_usd * LEAST(l.borrow_apy, 1.0))::float8 AS borrow_interest,
        SUM(l.supply_assets_usd)::float8 AS supply
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE m.collateral_asset_symbol IS NOT NULL
      GROUP BY ch.slug, ch.name, cat
      `,
      [],
    )) as { chain_slug: string; chain_name: string; cat: string; collateral: number | null; borrow_interest: number | null; supply: number | null }[];

    const categories = ['stablecoin', 'lst', 'lrt', 'btc', 'eth', 'rwa', 'other'];
    const byChain = new Map<string, PerChainMixRow>();
    for (const r of rows) {
      if (!byChain.has(r.chain_slug)) byChain.set(r.chain_slug, { chainSlug: r.chain_slug, chainName: r.chain_name, totalSupply: 0, borrowInterestGen: 0, byClass: {} });
      const e = byChain.get(r.chain_slug)!;
      e.byClass[r.cat] = (e.byClass[r.cat] ?? 0) + (r.collateral ?? 0);
      e.totalSupply += r.supply ?? 0;
      e.borrowInterestGen += r.borrow_interest ?? 0;
    }
    const chains = [...byChain.values()].sort((a, b) => b.totalSupply - a.totalSupply).slice(0, topChains);
    return { chains, categories };
  },
  [LB_CACHE, 'perchain-mix'],
  { revalidate: TTL, tags: ['assets'] },
);

// ---------- Asset velocity scatter ----------

export interface AssetVelocityPoint { symbol: string; category: string; supply30dDeltaPct: number | null; totalSupply: number; marketCount: number; supplyDeltaUsd: number; quadrant: string; annotate: boolean; }

export const getAssetVelocityScatter = unstable_cache(
  async (): Promise<AssetVelocityPoint[]> => {
    const sql = getDb();
    const agg = (await loadLoanAssetAgg(sql)).filter((a) => a.totalSupply >= 5_000_000 && a.supply30dDeltaPct != null);
    const withDelta = agg.map((a) => ({ ...a, supplyDeltaUsd: a.supply30dAgo != null ? a.totalSupply - a.supply30dAgo : 0 }));
    const median = (() => { const s = [...withDelta].map((a) => a.totalSupply).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : 0; })();
    const topGrowers = new Set([...withDelta].filter((a) => a.supplyDeltaUsd > 0).sort((a, b) => b.supplyDeltaUsd - a.supplyDeltaUsd).slice(0, 5).map((a) => a.symbol));
    const topShrinkers = new Set([...withDelta].filter((a) => a.supplyDeltaUsd < 0).sort((a, b) => a.supplyDeltaUsd - b.supplyDeltaUsd).slice(0, 3).map((a) => a.symbol));
    return withDelta.map((a) => {
      const growing = (a.supply30dDeltaPct ?? 0) >= 0;
      const big = a.totalSupply >= median;
      const quadrant = growing && big ? 'growing whales' : growing && !big ? 'rising challengers' : !growing && big ? 'shrinking incumbents' : 'declining minor';
      return { symbol: a.symbol, category: a.category, supply30dDeltaPct: a.supply30dDeltaPct, totalSupply: a.totalSupply, marketCount: a.marketCount, supplyDeltaUsd: a.supplyDeltaUsd, quadrant, annotate: topGrowers.has(a.symbol) || topShrinkers.has(a.symbol) };
    });
  },
  [LB_CACHE, 'velocity'],
  { revalidate: TTL, tags: ['assets'] },
);

// (Asset risk-profile table removed. Its weighted-LLTV computation was
// unreliable for loan-side aggregation and the section was dropped per review.)
