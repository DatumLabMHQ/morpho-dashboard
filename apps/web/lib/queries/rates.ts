// Rates-surface queries.
//
// Compares Morpho Blue's market-level rate environment against Aave V3 on the
// four core assets (USDC, USDT, DAI, WETH) across four chains where Morpho is
// largest (Ethereum, Base, Arbitrum, Polygon). Centerpiece is the Morpho-vs-
// Aave supply-APY spread series.

import { unstable_cache } from 'next/cache';

import { getDb } from '../db.js';

const CACHE_VERSION = 'rates-v1';
const TTL = 900;

// Canonical comparison universe. Asset symbols here must match both the
// loan_asset_symbol column on morpho_.markets AND the asset_symbol column on
// morpho_.aave_rates_daily.
export const RATES_ASSETS = ['USDC', 'USDT', 'DAI', 'WETH'] as const;
export const RATES_CHAINS = [
  { id: 1,     name: 'Ethereum' },
  { id: 8453,  name: 'Base' },
  { id: 42161, name: 'Arbitrum' },
  { id: 137,   name: 'Polygon' },
] as const;

// ---------- Types ----------

export interface RatesKpis {
  asOfDate: string | null;
  morphoSupplyApyWeighted: number | null;     // 0..1, across 4 target assets all chains
  aaveSupplyApyWeighted: number | null;
  spreadHeadlineBps: number | null;           // USDC Ethereum: Morpho - Aave
  morphoUsdcEthUtil: number | null;
  aaveUsdcEthUtil: number | null;
  badDebtEvents30d: number;
  totalBadDebtUsd: number;
}

export interface RateBucket {
  bucketLabel: string;         // "0–1%", "1–2%", …
  bucketLow: number;
  bucketHigh: number | null;   // null = open-ended top bucket
  marketCount: number;
  supplyUsd: number;
}

export interface SpreadPoint {
  date: string;
  morphoApy: number | null;
  aaveApy: number | null;
  spreadBps: number | null;     // morpho - aave, basis points
}

export interface SpreadSeries {
  asset: string;
  chainId: number;
  chainName: string;
  points: SpreadPoint[];
}

export interface ScatterPoint {
  marketKey: string;
  chainSlug: string;
  loanSymbol: string;
  collateralSymbol: string | null;
  category: string;
  utilization: number;
  supplyApy: number;
  supplyUsd: number;
  lltv: number | null;
}

export interface RiskRow {
  marketKey: string;
  chainSlug: string;
  pair: string;            // "cbBTC / USDC"
  supplyUsd: number;
  utilization: number;
  lltv: number;
  riskScore: number;       // supply_usd × utilization × lltv
  borrowApy: number | null;
  collateralCategory: string;
}

export interface BadDebtEvent {
  date: string;
  marketKey: string;
  chainSlug: string;
  pair: string;
  badDebtUsd: number;
  priorBadDebtUsd: number;
  deltaUsd: number;
}

// Sanity bound on supply_apy: clamp at 1.0 (100% APY). Morpho's IRM spikes
// to 418%–2980% on markets stuck at 100% utilization with degenerate oracles
// (BONDUSD/USR, K/USDC on Arbitrum, the HERMES/USDC family on Base, etc.).
// Nothing legitimate exceeds 100% supply APY in production — anything above
// is treated as a data artifact and excluded from rate aggregates.

// Identical CASE used elsewhere; duplicated locally so /rates can stand alone.
const ASSET_CASE = (col: string) => `
  CASE
    WHEN UPPER(${col}) IN (
      'USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD',
      'FDUSD','TUSD','MIM','BUIDL','RLUSD','USD0','USD0++','EUSD','MKUSD','FRXUSD','DEUSD','SDEUSD',
      'USDD','USDM','GUSD','USDX','USDY','USDTB','BOLD','GUSDC','SYRUPUSDC','AA_FALCONXUSDC','EURCV',
      'WSRUSD','AUSD','VBUSDC','VBUSDT','SIUSD','STCUSD','SUSDAT','STUSDS','USDT0','USD₮0','APXUSD',
      'MSUSD','VUSD'
    ) THEN 'stablecoin'
    WHEN UPPER(${col}) IN ('WSTETH','STETH','RETH','CBETH','SFRXETH','ETHX','SWETH','OSETH','ANKRETH','KHYPE','STHYPE','OETH') THEN 'lst'
    WHEN UPPER(${col}) IN ('WEETH','EZETH','RSETH','PUFETH','EETH','RSTETH','AMPHRETH','KINGETH','UNIETH') THEN 'lrt'
    WHEN UPPER(${col}) IN ('WBTC','CBBTC','LBTC','TBTC','EBTC','SOLVBTC','STBTC','FBTC','M-BTC','UNIBTC','ENZOBTC','KBTC','PUMPBTC','SOLVBTC.BBN','BTCB','XBTC','WBTC18','VBWBTC') THEN 'btc'
    WHEN UPPER(${col}) IN ('WETH','ETH','VBETH') THEN 'eth'
    WHEN UPPER(${col}) IN ('SDAI','PAXG','USTB','OUSG','UDUSD','SBUIDL','XAUT')
      OR UPPER(${col}) LIKE 'YT-%' OR UPPER(${col}) LIKE '%RWA%' THEN 'rwa'
    ELSE 'other'
  END
`;

// ---------- Queries ----------

export const getRatesKpis = unstable_cache(
  async (): Promise<RatesKpis> => {
    const sql = getDb();

    // Morpho-side: latest market_state per market, restricted to the 4 target
    // loan assets. Weighted by supply_assets_usd. Markets with supply_apy >=
    // APY_SANE (100%) are excluded as data artifacts (saturated-util IRM blow-ups).
    const morpho = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, borrow_assets_usd, supply_apy, utilization, snapshot_date
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        MAX(l.snapshot_date)::text                                              AS as_of,
        SUM(COALESCE(l.supply_apy, 0) * COALESCE(l.supply_assets_usd, 0))::float8
          / NULLIF(SUM(COALESCE(l.supply_assets_usd, 0)), 0)                    AS weighted_apy,
        SUM(CASE WHEN m.chain_id = 1 AND UPPER(m.loan_asset_symbol) = 'USDC'
                 THEN COALESCE(l.utilization, 0) * COALESCE(l.supply_assets_usd, 0) END)
          / NULLIF(SUM(CASE WHEN m.chain_id = 1 AND UPPER(m.loan_asset_symbol) = 'USDC'
                            THEN COALESCE(l.supply_assets_usd, 0) END), 0)      AS usdc_eth_util,
        SUM(CASE WHEN m.chain_id = 1 AND UPPER(m.loan_asset_symbol) = 'USDC'
                 THEN COALESCE(l.supply_apy, 0) * COALESCE(l.supply_assets_usd, 0) END)
          / NULLIF(SUM(CASE WHEN m.chain_id = 1 AND UPPER(m.loan_asset_symbol) = 'USDC'
                            THEN COALESCE(l.supply_assets_usd, 0) END), 0)      AS usdc_eth_apy
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      WHERE UPPER(m.loan_asset_symbol) IN ('USDC','USDT','DAI','WETH')
        AND m.chain_id IN (1, 8453, 42161, 137)
        AND l.supply_assets_usd > 0
        AND (l.supply_apy IS NULL OR l.supply_apy < 1.0)
      `,
      [],
    )) as { as_of: string | null; weighted_apy: number | null; usdc_eth_util: number | null; usdc_eth_apy: number | null }[];

    // Aave-side: latest snapshot per (chain, asset) across the same 4 assets.
    const aave = (await sql`
      WITH latest AS (
        SELECT DISTINCT ON (chain_id, asset_symbol)
          chain_id, asset_symbol, supply_apy, utilization, supply_usd
        FROM morpho_.aave_rates_daily ORDER BY chain_id, asset_symbol, snapshot_date DESC
      )
      SELECT
        SUM(COALESCE(supply_apy, 0) * COALESCE(supply_usd, 0))::float8
          / NULLIF(SUM(COALESCE(supply_usd, 0)), 0)             AS weighted_apy,
        SUM(CASE WHEN chain_id = 1 AND asset_symbol = 'USDC' THEN supply_apy END)
                                                                AS usdc_eth_apy,
        SUM(CASE WHEN chain_id = 1 AND asset_symbol = 'USDC' THEN utilization END)
                                                                AS usdc_eth_util
      FROM latest
    `) as { weighted_apy: number | null; usdc_eth_apy: number | null; usdc_eth_util: number | null }[];

    // Bad debt events in last 30 days. Event = market-day where unrealized
    // bad debt grew >5% over the prior day AND exceeds $1k absolute.
    const badDebt = (await sql`
      WITH events AS (
        SELECT
          market_unique_key,
          snapshot_date,
          bad_debt_assets_usd,
          LAG(bad_debt_assets_usd) OVER (
            PARTITION BY market_unique_key ORDER BY snapshot_date
          ) AS prior
        FROM morpho_.market_state_daily
        WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days'
      )
      SELECT
        (SELECT COUNT(*) FROM events
         WHERE bad_debt_assets_usd > 1000
           AND (prior IS NULL OR bad_debt_assets_usd > prior * 1.05))::int  AS event_count,
        (SELECT COALESCE(SUM(bad_debt_assets_usd), 0)
         FROM morpho_.market_state_daily
         WHERE bad_debt_assets_usd > 1000
           AND snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.market_state_daily)
        )::float8                                                            AS total_bad_debt
    `) as { event_count: number; total_bad_debt: number }[];

    const m = morpho[0]!;
    const a = aave[0]!;
    const bd = badDebt[0]!;

    const spreadHeadlineBps =
      m.usdc_eth_apy != null && a.usdc_eth_apy != null
        ? (m.usdc_eth_apy - a.usdc_eth_apy) * 10000
        : null;

    return {
      asOfDate: m.as_of,
      morphoSupplyApyWeighted: m.weighted_apy,
      aaveSupplyApyWeighted: a.weighted_apy,
      spreadHeadlineBps,
      morphoUsdcEthUtil: m.usdc_eth_util,
      aaveUsdcEthUtil: a.usdc_eth_util,
      badDebtEvents30d: bd.event_count,
      totalBadDebtUsd: bd.total_bad_debt,
    };
  },
  [CACHE_VERSION, 'kpis'],
  { revalidate: TTL, tags: ['rates'] },
);

// Supply APY distribution across all Morpho markets (latest day).
// Buckets: <2, 2–4, 4–6, 6–8, 8–12, 12–20, 20%+.
export const getSupplyApyHistogram = unstable_cache(
  async (): Promise<RateBucket[]> => {
    const sql = getDb();
    const rows = (await sql`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, supply_apy
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        CASE
          WHEN supply_apy < 0.02 THEN '0–2%'
          WHEN supply_apy < 0.04 THEN '2–4%'
          WHEN supply_apy < 0.06 THEN '4–6%'
          WHEN supply_apy < 0.08 THEN '6–8%'
          WHEN supply_apy < 0.12 THEN '8–12%'
          WHEN supply_apy < 0.20 THEN '12–20%'
          ELSE '20%+'
        END                                          AS bucket_label,
        CASE
          WHEN supply_apy < 0.02 THEN 0
          WHEN supply_apy < 0.04 THEN 2
          WHEN supply_apy < 0.06 THEN 4
          WHEN supply_apy < 0.08 THEN 6
          WHEN supply_apy < 0.12 THEN 8
          WHEN supply_apy < 0.20 THEN 12
          ELSE 20
        END                                          AS bucket_low,
        CASE
          WHEN supply_apy < 0.02 THEN 2
          WHEN supply_apy < 0.04 THEN 4
          WHEN supply_apy < 0.06 THEN 6
          WHEN supply_apy < 0.08 THEN 8
          WHEN supply_apy < 0.12 THEN 12
          WHEN supply_apy < 0.20 THEN 20
          ELSE NULL
        END                                          AS bucket_high,
        COUNT(*)::int                                AS market_count,
        SUM(COALESCE(supply_assets_usd, 0))::float8  AS supply_usd
      FROM latest
      WHERE supply_apy IS NOT NULL AND supply_apy < 1.0 AND supply_assets_usd > 0
      GROUP BY 1, 2, 3
      ORDER BY 2
    `) as { bucket_label: string; bucket_low: number; bucket_high: number | null; market_count: number; supply_usd: number }[];
    return rows.map((r) => ({
      bucketLabel: r.bucket_label,
      bucketLow: r.bucket_low,
      bucketHigh: r.bucket_high,
      marketCount: r.market_count,
      supplyUsd: r.supply_usd,
    }));
  },
  [CACHE_VERSION, 'apy-hist'],
  { revalidate: TTL, tags: ['rates'] },
);

// Utilization distribution across all Morpho markets (latest day).
export const getUtilizationHistogram = unstable_cache(
  async (): Promise<RateBucket[]> => {
    const sql = getDb();
    const rows = (await sql`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, utilization
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      bucketed AS (
        SELECT
          LEAST(FLOOR(COALESCE(utilization, 0) * 10), 9)::int AS b,
          supply_assets_usd
        FROM latest WHERE supply_assets_usd > 0
      )
      SELECT
        b,
        COUNT(*)::int                                AS market_count,
        SUM(COALESCE(supply_assets_usd, 0))::float8  AS supply_usd
      FROM bucketed GROUP BY b ORDER BY b
    `) as { b: number; market_count: number; supply_usd: number }[];

    return rows.map((r) => ({
      bucketLabel: `${r.b * 10}–${(r.b + 1) * 10}%`,
      bucketLow: r.b * 10,
      bucketHigh: (r.b + 1) * 10,
      marketCount: r.market_count,
      supplyUsd: r.supply_usd,
    }));
  },
  [CACHE_VERSION, 'util-hist'],
  { revalidate: TTL, tags: ['rates'] },
);

// Centerpiece: Morpho weighted supply APY vs Aave V3 supply APY, by (asset,
// chain), last `days` days. Aligned by snapshot_date.
export const getMorphoVsAaveSpread = unstable_cache(
  async (days = 180): Promise<SpreadSeries[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH morpho_daily AS (
        SELECT
          m.chain_id,
          UPPER(m.loan_asset_symbol) AS asset,
          s.snapshot_date::text       AS date,
          SUM(COALESCE(s.supply_apy, 0) * COALESCE(s.supply_assets_usd, 0))::float8
            / NULLIF(SUM(COALESCE(s.supply_assets_usd, 0)), 0) AS apy
        FROM morpho_.market_state_daily s
        JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
        WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
          AND m.chain_id IN (1, 8453, 42161, 137)
          AND UPPER(m.loan_asset_symbol) IN ('USDC','USDT','DAI','WETH')
          AND s.supply_assets_usd > 0
          AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
        GROUP BY m.chain_id, UPPER(m.loan_asset_symbol), s.snapshot_date
      ),
      aave_daily AS (
        SELECT chain_id, asset_symbol AS asset, snapshot_date::text AS date,
               supply_apy::float8 AS apy
        FROM morpho_.aave_rates_daily
        WHERE snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
      ),
      combined AS (
        SELECT
          COALESCE(m.chain_id, a.chain_id) AS chain_id,
          COALESCE(m.asset, a.asset)        AS asset,
          COALESCE(m.date, a.date)          AS date,
          m.apy                              AS morpho_apy,
          a.apy                              AS aave_apy
        FROM morpho_daily m
        FULL OUTER JOIN aave_daily a
          ON a.chain_id = m.chain_id AND a.asset = m.asset AND a.date = m.date
      )
      SELECT chain_id, asset, date, morpho_apy, aave_apy
      FROM combined
      ORDER BY chain_id, asset, date
      `,
      [days],
    )) as { chain_id: number; asset: string; date: string; morpho_apy: number | null; aave_apy: number | null }[];

    const chainName = new Map<number, string>([
      [1, 'Ethereum'], [8453, 'Base'], [42161, 'Arbitrum'], [137, 'Polygon'],
    ]);
    const grouped = new Map<string, SpreadSeries>();
    for (const r of rows) {
      const key = `${r.asset}|${r.chain_id}`;
      let s = grouped.get(key);
      if (!s) {
        s = {
          asset: r.asset,
          chainId: r.chain_id,
          chainName: chainName.get(r.chain_id) ?? `chain ${r.chain_id}`,
          points: [],
        };
        grouped.set(key, s);
      }
      const spreadBps =
        r.morpho_apy != null && r.aave_apy != null
          ? (r.morpho_apy - r.aave_apy) * 10000
          : null;
      s.points.push({
        date: r.date,
        morphoApy: r.morpho_apy,
        aaveApy: r.aave_apy,
        spreadBps,
      });
    }
    return [...grouped.values()];
  },
  [CACHE_VERSION, 'morpho-vs-aave'],
  { revalidate: TTL, tags: ['rates'] },
);

// Utilization vs supply APY scatter, one point per Morpho market with >$1M
// supply on the latest day. Color by collateral asset class, size by supply.
export const getUtilizationVsRateScatter = unstable_cache(
  async (): Promise<ScatterPoint[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, supply_apy, utilization
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.unique_key,
        ch.slug                                          AS chain_slug,
        m.loan_asset_symbol                              AS loan,
        m.collateral_asset_symbol                        AS collateral,
        ${ASSET_CASE('m.collateral_asset_symbol')}       AS category,
        l.utilization::float8                            AS util,
        l.supply_apy::float8                             AS apy,
        l.supply_assets_usd::float8                      AS supply,
        m.lltv::float8                                   AS lltv
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE l.supply_assets_usd > 1000000
        AND l.utilization IS NOT NULL
        AND l.supply_apy IS NOT NULL
        AND l.supply_apy < 1.0
      ORDER BY l.supply_assets_usd DESC
      LIMIT 400
      `,
      [],
    )) as { unique_key: string; chain_slug: string; loan: string; collateral: string | null;
           category: string; util: number; apy: number; supply: number; lltv: number | null }[];

    return rows.map((r) => ({
      marketKey: r.unique_key,
      chainSlug: r.chain_slug,
      loanSymbol: r.loan,
      collateralSymbol: r.collateral,
      category: r.category,
      utilization: r.util,
      supplyApy: r.apy,
      supplyUsd: r.supply,
      lltv: r.lltv,
    }));
  },
  [CACHE_VERSION, 'scatter'],
  { revalidate: TTL, tags: ['rates'] },
);

// Top 20 markets by risk_score = supply × utilization × lltv.
// High score = lots of capital, highly utilized, on a high-LTV market — i.e.
// where a liquidation cascade has the biggest blast radius.
export const getRiskSurface = unstable_cache(
  async (limit = 20): Promise<RiskRow[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, utilization, borrow_apy
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.unique_key,
        ch.slug                                                 AS chain_slug,
        m.collateral_asset_symbol                               AS collateral,
        m.loan_asset_symbol                                     AS loan,
        ${ASSET_CASE('m.collateral_asset_symbol')}              AS category,
        l.supply_assets_usd::float8                             AS supply,
        l.utilization::float8                                   AS util,
        m.lltv::float8                                          AS lltv,
        l.borrow_apy::float8                                    AS borrow_apy,
        (l.supply_assets_usd::float8 * COALESCE(l.utilization, 0) * COALESCE(m.lltv, 0))::float8
                                                                AS risk_score
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE l.supply_assets_usd > 0 AND m.lltv IS NOT NULL
      ORDER BY risk_score DESC NULLS LAST
      LIMIT $1
      `,
      [limit],
    )) as { unique_key: string; chain_slug: string; collateral: string | null; loan: string;
           category: string; supply: number; util: number; lltv: number; borrow_apy: number | null;
           risk_score: number }[];

    return rows.map((r) => ({
      marketKey: r.unique_key,
      chainSlug: r.chain_slug,
      pair: `${r.collateral ?? '—'} / ${r.loan}`,
      supplyUsd: r.supply,
      utilization: r.util ?? 0,
      lltv: r.lltv,
      riskScore: r.risk_score,
      borrowApy: r.borrow_apy,
      collateralCategory: r.category,
    }));
  },
  [CACHE_VERSION, 'risk'],
  { revalidate: TTL, tags: ['rates'] },
);

// Bad debt events (last 90 days). One row per market-day where bad debt rose
// by more than 5% over its prior day AND exceeds $1k absolute.
export const getBadDebtEvents = unstable_cache(
  async (days = 90, limit = 50): Promise<BadDebtEvent[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH lagged AS (
        SELECT
          s.market_unique_key,
          s.snapshot_date,
          COALESCE(s.bad_debt_assets_usd, 0)::float8 AS bd,
          LAG(COALESCE(s.bad_debt_assets_usd, 0)) OVER (
            PARTITION BY s.market_unique_key ORDER BY s.snapshot_date
          )::float8                                  AS prior
        FROM morpho_.market_state_daily s
        WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
      )
      SELECT
        l.snapshot_date::text                                   AS date,
        m.unique_key,
        ch.slug                                                 AS chain_slug,
        m.collateral_asset_symbol                               AS collateral,
        m.loan_asset_symbol                                     AS loan,
        l.bd                                                    AS bad_debt,
        l.prior                                                 AS prior_bad_debt,
        (l.bd - COALESCE(l.prior, 0))::float8                   AS delta
      FROM lagged l
      JOIN morpho_.markets m ON m.unique_key = l.market_unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE l.bd > 1000
        AND (l.prior IS NULL OR l.bd > l.prior * 1.05)
      ORDER BY l.bd DESC
      LIMIT $2
      `,
      [days, limit],
    )) as { date: string; unique_key: string; chain_slug: string; collateral: string | null;
           loan: string; bad_debt: number; prior_bad_debt: number | null; delta: number }[];

    return rows.map((r) => ({
      date: r.date,
      marketKey: r.unique_key,
      chainSlug: r.chain_slug,
      pair: `${r.collateral ?? '—'} / ${r.loan}`,
      badDebtUsd: r.bad_debt,
      priorBadDebtUsd: r.prior_bad_debt ?? 0,
      deltaUsd: r.delta,
    }));
  },
  [CACHE_VERSION, 'bad-debt'],
  { revalidate: TTL, tags: ['rates'] },
);
