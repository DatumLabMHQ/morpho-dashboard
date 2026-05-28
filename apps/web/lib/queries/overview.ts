// Overview-surface queries — Morpho-as-sector framing.
//
// Morpho is the unit of analysis; chains are its primary components and
// curators secondary. The Overview shows Morpho's "sector" the way a
// lending-sector terminal shows the lending sector: KPIs, a market-share
// chart, per-component cards, a flows Sankey, mix donuts, a top-markets
// table, and a small sector-position chart for context.
//
// No auto-generated narrative anywhere — numbers and structure tell it.

import { unstable_cache } from 'next/cache';

import {
  ALL_LENDING_SLUGS,
  LENDING_PROTOCOLS,
  collapseByBrand,
  type ProtocolMeta,
} from '../protocols/comparison-set.js';
import { getDb } from '../db.js';

const CACHE_VERSION = 'overview-v7';
const TTL = 900;

// Shared asset-class CASE (mirrors the rest of the dashboard).
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

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

export type DeltaKind = 'usd' | 'pp' | 'pct';
export interface Delta { label: string; kind: DeltaKind; value: number | null }
export interface SparkPoint { day: string; value: number }

export interface KpiCardData {
  /** Main value. For utilization / take-rate / spread this is a ratio or pp. */
  value: number | null;
  /** How the card formats the main value. */
  display: 'usd' | 'pct';
  caption: string;
  deltas: Delta[];
  sparkline: SparkPoint[];
}

export interface MorphoWideKpis {
  asOfDate: string;
  chainCount: number;
  curatorCount: number;
  marketCount: number;
  totalDeposits: KpiCardData;
  activeBorrows: KpiCardData;
  availableLiquidity: KpiCardData;
  utilization: KpiCardData;
  curatorFeeTakeRate: KpiCardData;
  realYieldSpread: KpiCardData;
  /** True when tbill_rates_daily has data (FRED key configured). */
  tbillAvailable: boolean;
}

export type ShareMetric = 'deposits' | 'borrows' | 'liquidity' | 'tvl' | 'utilization';

export type ShareSeriesPoint = { day: string } & Record<string, string | number>;

export interface MarketShareByChain {
  metric: ShareMetric;
  /** 'share' → stack to 100%; 'ratio' → overlay raw 0..1 (utilization). */
  mode: 'share' | 'ratio';
  chains: { slug: string; name: string }[];
  points: ShareSeriesPoint[];
}

export interface PerChainCard {
  chainId: number;
  slug: string;
  name: string;
  deposits: number;
  tvl: number;
  borrows: number;
  utilization: number | null;
  fees7d: number;
  revenue30d: number;
  netDeposits30d: number | null;
}

export interface SankeyNode {
  name: string;
  kind: 'inflow' | 'component' | 'outflow';
  /** Display value: inflow/outflow nodes carry their (positive) throughput;
   *  component nodes carry their signed net (incoming − outgoing). */
  usd: number;
}
export interface SankeyLink { source: number; target: number; value: number }
export interface NetSupplyFlows {
  view: 'chain' | 'curator';
  period: 'W' | 'M' | 'Q';
  nodes: SankeyNode[];
  links: SankeyLink[];
  netInflowUsd: number;
  netOutflowUsd: number;
}

export interface AssetSlice { symbol: string; usd: number }
export type MixPeriod = 'current' | 'week' | 'month' | 'quarter';
export interface MixDonuts {
  period: MixPeriod;
  asOfDate: string;
  collateralMix: AssetSlice[];
  collateralTotal: number;
  borrowMix: AssetSlice[];
  borrowTotal: number;
}

export type TopMarketsSort = 'supply' | 'borrows' | 'utilization' | 'supplyApy' | 'borrowApy' | 'liquidity';
export interface TopMarketRow {
  rank: number;
  uniqueKey: string;
  chainSlug: string | null;
  chainName: string | null;
  pair: string;
  supplyUsd: number;
  liquidityUsd: number;
  borrowUsd: number;
  utilization: number | null;
  supplyApy: number | null;
  borrowApy: number | null;
}

// Reused from the v2 spec — protocol comparison + ranking.
export interface ProtocolSeries {
  key: string; label: string; brand: string; legacy: boolean;
  points: { day: string; tvl: number }[];
}
export interface ProtocolComparisonResult {
  lending: ProtocolSeries[]; cdp: ProtocolSeries[]; collapsedLegacy: boolean;
}
export interface ProtocolRanking {
  allRanked: { slug: string; label: string; tvlUsd: number }[];
  morphoRank: number;
  morphoTvl: number;
  totalLendingProtocols: number;
  oneAbove: { slug: string; label: string; tvlUsd: number } | null;
  gapToOneAboveUsd: number | null;
}

// Back-compat bag (legacy callers / safety).
export interface OverviewKpis {
  morphoTvlUsd: number | null;
  marketCount: number;
  vaultCount: number;
  curatorCount: number;
  chainsLiveCount: number;
  asOfDate: string | null;
  hasData: boolean;
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function pickAnchor<T extends { day: string }>(series: T[], offsetFromEnd: number): T | null {
  if (series.length === 0) return null;
  const idx = series.length - 1 - offsetFromEnd;
  return idx >= 0 ? series[idx]! : null;
}

// ───────────────────────────────────────────────────────────────────────
// Back-compat 5-KPI bag
// ───────────────────────────────────────────────────────────────────────

export const getOverviewKpis = unstable_cache(
  async (): Promise<OverviewKpis> => {
    const sql = getDb();
    const tvlRows = (await sql`
      WITH latest AS (
        SELECT (MAX(snapshot_date) - INTERVAL '1 day')::date AS d
        FROM morpho_.protocol_tvl_daily WHERE protocol_slug = 'morpho-blue'
      )
      SELECT COALESCE(SUM(tvl_usd), 0)::float8 AS tvl, (SELECT d::text FROM latest) AS as_of
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = 'morpho-blue' AND snapshot_date = (SELECT d FROM latest)
    `) as { tvl: number; as_of: string | null }[];
    const counts = (await sql`
      SELECT
        (SELECT COUNT(*)::int FROM morpho_.markets)                 AS markets,
        (SELECT COUNT(*)::int FROM morpho_.vaults)                  AS vaults,
        (SELECT COUNT(*)::int FROM morpho_.curators)                AS curators,
        (SELECT COUNT(DISTINCT chain_id)::int FROM morpho_.markets) AS chains_live
    `) as { markets: number; vaults: number; curators: number; chains_live: number }[];
    const c = counts[0] ?? { markets: 0, vaults: 0, curators: 0, chains_live: 0 };
    const tvl = tvlRows[0]?.tvl ?? 0;
    return {
      morphoTvlUsd: tvl > 0 ? tvl : null,
      marketCount: c.markets, vaultCount: c.vaults, curatorCount: c.curators,
      chainsLiveCount: c.chains_live, asOfDate: tvlRows[0]?.as_of ?? null,
      hasData: c.markets > 0 || tvl > 0,
    };
  },
  ['overview-kpis-v2'],
  { revalidate: 900, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 1. Six Morpho-wide KPIs with 24h / MoM / YoY deltas + sparkline
// ───────────────────────────────────────────────────────────────────────

export const getMorphoWideKpis = unstable_cache(
  async (): Promise<MorphoWideKpis> => {
    const sql = getDb();

    const market = (await sql`
      WITH daily AS (
        SELECT
          s.snapshot_date::date AS day,
          SUM(COALESCE(s.supply_assets_usd, 0))::float8     AS supply,
          SUM(COALESCE(s.collateral_assets_usd, 0))::float8 AS collateral,
          SUM(COALESCE(s.borrow_assets_usd, 0))::float8     AS borrow,
          SUM(CASE WHEN UPPER(m.loan_asset_symbol) IN ('USDC','USDT','DAI')
                   THEN COALESCE(s.supply_apy, 0) * COALESCE(s.supply_assets_usd, 0) END)::float8 AS stable_apy_num,
          SUM(CASE WHEN UPPER(m.loan_asset_symbol) IN ('USDC','USDT','DAI')
                   THEN COALESCE(s.supply_assets_usd, 0) END)::float8 AS stable_supply
        FROM morpho_.market_state_daily s
        JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
        WHERE s.snapshot_date >= CURRENT_DATE - INTERVAL '400 days'
          AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
        GROUP BY s.snapshot_date::date
      )
      SELECT day::text, supply, collateral, borrow, stable_apy_num, stable_supply
      FROM daily ORDER BY day
    `) as { day: string; supply: number; collateral: number; borrow: number; stable_apy_num: number | null; stable_supply: number | null }[];

    const vault = (await sql`
      WITH dv AS (
        SELECT s.snapshot_date::date AS day,
          SUM(COALESCE(s.total_assets_usd, 0))::float8 AS auc,
          SUM(COALESCE(s.total_assets_usd, 0) * COALESCE(s.apy, 0) * COALESCE(s.fee_bps, 0) / 10000.0)::float8 AS fee_annual
        FROM morpho_.vault_state_daily s
        WHERE s.snapshot_date >= CURRENT_DATE - INTERVAL '400 days'
          AND COALESCE(s.apy, 0) < 1.0
        GROUP BY s.snapshot_date::date
      )
      SELECT day::text, auc, fee_annual FROM dv ORDER BY day
    `) as { day: string; auc: number; fee_annual: number }[];

    const tbill = (await sql`
      SELECT day::text, rate_pct::float8 AS rate
      FROM morpho_.tbill_rates_daily
      WHERE day >= CURRENT_DATE - INTERVAL '400 days'
      ORDER BY day
    `) as { day: string; rate: number }[];

    const counts = (await sql`
      SELECT
        (SELECT COUNT(DISTINCT chain_id)::int FROM morpho_.markets)                       AS chains,
        (SELECT COUNT(DISTINCT curator_id)::int FROM morpho_.vaults WHERE curator_id IS NOT NULL) AS curators,
        (SELECT COUNT(*)::int FROM morpho_.markets)                                       AS markets
    `) as { chains: number; curators: number; markets: number }[];

    const tbillByDay = new Map(tbill.map((t) => [t.day, t.rate]));
    const vaultByDay = new Map(vault.map((v) => [v.day, v]));

    // Build a per-day derived-metric series.
    type Row = {
      day: string;
      deposits: number; borrows: number; liquidity: number;
      utilization: number;          // 0..1
      takeRate: number | null;      // 0..1, annualized fee / AUC
      spreadPp: number | null;      // stable APY% − tbill%, in pp
    };
    const series: Row[] = market.map((m) => {
      const deposits = m.supply + m.collateral;
      const borrows = m.borrow;
      const liquidity = deposits - borrows;
      const utilization = deposits > 0 ? borrows / deposits : 0;
      const v = vaultByDay.get(m.day);
      const takeRate = v && v.auc > 0 ? v.fee_annual / v.auc : null;
      const stableApy = m.stable_supply && m.stable_supply > 0 && m.stable_apy_num != null
        ? m.stable_apy_num / m.stable_supply           // 0..1
        : null;
      const tb = tbillByDay.get(m.day);                 // percent (e.g. 5.25)
      const spreadPp = stableApy != null && tb != null ? stableApy * 100 - tb : null;
      return { day: m.day, deposits, borrows, liquidity, utilization, takeRate, spreadPp };
    });

    const last = series[series.length - 1];
    const d1 = pickAnchor(series, 1);
    const d30 = pickAnchor(series, 30);
    const d365 = pickAnchor(series, 365);

    const spark = (pick: (r: Row) => number): SparkPoint[] =>
      series.slice(-30).map((r) => ({ day: r.day, value: pick(r) }));

    const usdDelta = (cur: number, prior: number | null): number | null =>
      prior == null ? null : cur - prior;
    const ppDelta = (cur: number | null, prior: number | null, scale = 1): number | null =>
      cur == null || prior == null ? null : (cur - prior) * scale;

    const asOfDate = last?.day ?? new Date().toISOString().slice(0, 10);
    const c = counts[0] ?? { chains: 0, curators: 0, markets: 0 };

    return {
      asOfDate,
      chainCount: c.chains,
      curatorCount: c.curators,
      marketCount: c.markets,
      tbillAvailable: tbill.length > 0,

      totalDeposits: {
        value: last?.deposits ?? null, display: 'usd',
        caption: `deposits across ${c.chains} chains`,
        deltas: [
          { label: '24h', kind: 'usd', value: last ? usdDelta(last.deposits, d1?.deposits ?? null) : null },
          { label: 'MoM', kind: 'usd', value: last ? usdDelta(last.deposits, d30?.deposits ?? null) : null },
          { label: 'YoY', kind: 'usd', value: last ? usdDelta(last.deposits, d365?.deposits ?? null) : null },
        ],
        sparkline: spark((r) => r.deposits),
      },
      activeBorrows: {
        value: last?.borrows ?? null, display: 'usd',
        caption: 'outstanding debt principal',
        deltas: [
          { label: '24h', kind: 'usd', value: last ? usdDelta(last.borrows, d1?.borrows ?? null) : null },
          { label: 'MoM', kind: 'usd', value: last ? usdDelta(last.borrows, d30?.borrows ?? null) : null },
          { label: 'YoY', kind: 'usd', value: last ? usdDelta(last.borrows, d365?.borrows ?? null) : null },
        ],
        sparkline: spark((r) => r.borrows),
      },
      availableLiquidity: {
        value: last?.liquidity ?? null, display: 'usd',
        caption: 'unborrowed deposits',
        deltas: [
          { label: '24h', kind: 'usd', value: last ? usdDelta(last.liquidity, d1?.liquidity ?? null) : null },
          { label: 'MoM', kind: 'usd', value: last ? usdDelta(last.liquidity, d30?.liquidity ?? null) : null },
          { label: 'YoY', kind: 'usd', value: last ? usdDelta(last.liquidity, d365?.liquidity ?? null) : null },
        ],
        sparkline: spark((r) => r.liquidity),
      },
      utilization: {
        value: last?.utilization ?? null, display: 'pct',
        caption: 'borrows ÷ deposits',
        deltas: [
          { label: 'MoM', kind: 'pp', value: ppDelta(last?.utilization ?? null, d30?.utilization ?? null, 100) },
          { label: 'YoY', kind: 'pp', value: ppDelta(last?.utilization ?? null, d365?.utilization ?? null, 100) },
        ],
        sparkline: spark((r) => r.utilization),
      },
      curatorFeeTakeRate: {
        value: last?.takeRate ?? null, display: 'pct',
        caption: 'curator fees ÷ AUC, annualized',
        deltas: [
          { label: 'MoM', kind: 'pp', value: ppDelta(last?.takeRate ?? null, d30?.takeRate ?? null, 100) },
          { label: 'YoY', kind: 'pp', value: ppDelta(last?.takeRate ?? null, d365?.takeRate ?? null, 100) },
        ],
        sparkline: spark((r) => r.takeRate ?? 0),
      },
      realYieldSpread: {
        // value is in percentage points (already). display as pct shows "x.x%".
        value: last?.spreadPp != null ? last.spreadPp / 100 : null, display: 'pct',
        caption: 'stables APY vs 3M T-bill',
        deltas: [
          { label: 'MoM', kind: 'pp', value: ppDelta(last?.spreadPp ?? null, d30?.spreadPp ?? null) },
        ],
        sparkline: spark((r) => (r.spreadPp != null ? r.spreadPp / 100 : 0)),
      },
    };
  },
  [CACHE_VERSION, 'morpho-wide-kpis'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 2. Market share by chain (the anchor chart)
// ───────────────────────────────────────────────────────────────────────

const SHARE_TOP = 10;

export const getMarketShareByChain = unstable_cache(
  async (metric: ShareMetric = 'deposits', days = 730): Promise<MarketShareByChain> => {
    const sql = getDb();
    const isRatio = metric === 'utilization';

    // We always pull deposits + borrows per (day, chain); derive the metric.
    const rows = (await sql(
      `
      SELECT
        s.snapshot_date::date::text AS day,
        ch.slug AS chain_slug,
        ch.name AS chain_name,
        SUM(COALESCE(s.supply_assets_usd, 0) + COALESCE(s.collateral_assets_usd, 0))::float8 AS deposits,
        SUM(COALESCE(s.borrow_assets_usd, 0))::float8 AS borrows
      FROM morpho_.market_state_daily s
      JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
        AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
      GROUP BY s.snapshot_date::date, ch.slug, ch.name
      `,
      [days],
    )) as { day: string; chain_slug: string | null; chain_name: string | null; deposits: number; borrows: number }[];

    const valueOf = (deposits: number, borrows: number): number => {
      switch (metric) {
        case 'deposits':    return deposits;
        case 'borrows':     return borrows;
        case 'liquidity':   return deposits - borrows;
        case 'tvl':         return deposits - borrows;
        case 'utilization': return deposits > 0 ? borrows / deposits : 0;
      }
    };

    // Rank chains by latest-day metric value.
    const latestDay = rows.reduce((m, r) => (r.day > m ? r.day : m), '');
    const latestByChain = new Map<string, number>();
    const nameBySlug = new Map<string, string>();
    for (const r of rows) {
      if (r.chain_slug && r.chain_name) nameBySlug.set(r.chain_slug, r.chain_name);
      if (r.day === latestDay && r.chain_slug) {
        latestByChain.set(r.chain_slug, valueOf(r.deposits, r.borrows));
      }
    }
    const ranked = [...latestByChain.entries()].sort((a, b) => b[1] - a[1]);
    const topSlugs = new Set(ranked.slice(0, SHARE_TOP).map((x) => x[0]));

    const pointMap = new Map<string, ShareSeriesPoint>();
    for (const r of rows) {
      let p = pointMap.get(r.day);
      if (!p) { p = { day: r.day }; pointMap.set(r.day, p); }
      const v = valueOf(r.deposits, r.borrows);
      if (isRatio) {
        // ratio mode: only emit named top chains (overlay), skip Other.
        if (r.chain_slug && topSlugs.has(r.chain_slug)) {
          p[r.chain_slug] = ((p[r.chain_slug] as number) ?? 0) + v;
        }
      } else {
        const key = r.chain_slug && topSlugs.has(r.chain_slug) ? r.chain_slug : 'Other';
        p[key] = ((p[key] as number) ?? 0) + v;
      }
    }
    const points = [...pointMap.values()].sort((a, b) => a.day.localeCompare(b.day));

    const chains = ranked.slice(0, SHARE_TOP).map(([slug]) => ({ slug, name: nameBySlug.get(slug) ?? slug }));
    if (!isRatio && ranked.length > SHARE_TOP) chains.push({ slug: 'Other', name: 'Other chains' });

    return { metric, mode: isRatio ? 'ratio' : 'share', chains, points };
  },
  [CACHE_VERSION, 'market-share-by-chain'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 3. Per-chain cards (top 8 by current TVL)
// ───────────────────────────────────────────────────────────────────────

export const getPerChainCardData = unstable_cache(
  async (): Promise<PerChainCard[]> => {
    const sql = getDb();

    // Latest-day per-chain deposits/borrows (full current state).
    const snap = (await sql`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, collateral_assets_usd, borrow_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.chain_id, ch.slug, ch.name,
        SUM(COALESCE(l.supply_assets_usd,0) + COALESCE(l.collateral_assets_usd,0))::float8 AS deposits,
        SUM(COALESCE(l.borrow_assets_usd,0))::float8 AS borrows
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      GROUP BY m.chain_id, ch.slug, ch.name
    `) as { chain_id: number; slug: string | null; name: string | null; deposits: number; borrows: number }[];

    // Net deposits 30d: telescope the last 4 weeks of the asset-flows table
    // (week-over-week footprint deltas) per chain. This avoids the
    // single-30d-anchor trap — early backfill snapshots can record a market
    // at near-zero before indexing caught up, so a today-minus-30d-ago diff
    // wildly overstates inflow. Weekly deltas are bounded to recent,
    // well-covered weeks and telescope cleanly to a ~28-day net.
    const netFlow = (await sql`
      WITH recent AS (
        SELECT DISTINCT week_start FROM morpho_.morpho_asset_flows_weekly
        ORDER BY week_start DESC LIMIT 4
      )
      SELECT chain_id, SUM(net_flow_usd)::float8 AS net
      FROM morpho_.morpho_asset_flows_weekly
      WHERE week_start IN (SELECT week_start FROM recent)
      GROUP BY chain_id
    `) as { chain_id: number; net: number }[];
    const netByChain = new Map<number, number>(netFlow.map((r) => [r.chain_id, r.net]));

    // fees7d (latest week's borrow interest) + revenue30d (last ~4 weeks of
    // curation fees) from the materialized weekly table.
    const weekly = (await sql`
      WITH last_week AS (SELECT MAX(week_start) AS w FROM morpho_.overview_weekly_chain_metrics)
      SELECT
        chain_slug,
        SUM(borrow_interest_usd) FILTER (WHERE week_start = (SELECT w FROM last_week))::float8 AS fees_7d,
        SUM(curation_fees_usd) FILTER (WHERE week_start > (SELECT w FROM last_week) - INTERVAL '28 days')::float8 AS revenue_30d
      FROM morpho_.overview_weekly_chain_metrics
      GROUP BY chain_slug
    `) as { chain_slug: string; fees_7d: number | null; revenue_30d: number | null }[];
    const weeklyBySlug = new Map(weekly.map((w) => [w.chain_slug, w]));

    const cards: PerChainCard[] = snap
      .filter((r) => r.slug)
      .map((r) => {
        const deposits = r.deposits ?? 0;
        const borrows = r.borrows ?? 0;
        const tvl = deposits - borrows;
        const w = r.slug ? weeklyBySlug.get(r.slug) : undefined;
        return {
          chainId: r.chain_id,
          slug: r.slug!,
          name: r.name ?? r.slug!,
          deposits,
          tvl,
          borrows,
          utilization: deposits > 0 ? borrows / deposits : null,
          fees7d: w?.fees_7d ?? 0,
          revenue30d: w?.revenue_30d ?? 0,
          // ~28-day net from telescoped weekly asset-flow deltas.
          netDeposits30d: netByChain.has(r.chain_id) ? netByChain.get(r.chain_id)! : null,
        };
      })
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 8);

    return cards;
  },
  [CACHE_VERSION, 'per-chain-cards'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 4. Net supply flows (Sankey)
// ───────────────────────────────────────────────────────────────────────

const SANKEY_TOP_ASSETS = 15;
const SANKEY_TOP_COMPONENTS = 8;

/** Build Sankey nodes/links from per-(component, asset) net flows. */
function buildSankey(
  pairs: { component: string; asset: string; net: number }[],
): Omit<NetSupplyFlows, 'view' | 'period'> {
  // Asset-level + component-level totals.
  const assetTotal = new Map<string, number>();
  const compTotal = new Map<string, number>();
  for (const p of pairs) {
    assetTotal.set(p.asset, (assetTotal.get(p.asset) ?? 0) + p.net);
    compTotal.set(p.component, (compTotal.get(p.component) ?? 0) + p.net);
  }

  const inflowAssets = [...assetTotal.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const outflowAssets = [...assetTotal.entries()].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
  const topInflow = new Set(inflowAssets.slice(0, SANKEY_TOP_ASSETS).map((x) => x[0]));
  const topOutflow = new Set(outflowAssets.slice(0, SANKEY_TOP_ASSETS).map((x) => x[0]));
  const topComps = new Set(
    [...compTotal.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, SANKEY_TOP_COMPONENTS).map((x) => x[0]),
  );

  const inName = (a: string) => (topInflow.has(a) ? a : 'Other ▲');
  const outName = (a: string) => (topOutflow.has(a) ? a : 'Other ▼');
  const compName = (c: string) => (topComps.has(c) ? c : 'Other');

  // Node index registry.
  const nodes: SankeyNode[] = [];
  const idx = new Map<string, number>();
  const nodeId = (name: string, kind: SankeyNode['kind']): number => {
    const key = `${kind}:${name}`;
    let i = idx.get(key);
    if (i == null) { i = nodes.length; nodes.push({ name, kind, usd: 0 }); idx.set(key, i); }
    return i;
  };

  // Aggregate links.
  const linkAgg = new Map<string, number>();
  const addLink = (s: number, t: number, v: number) => {
    if (v <= 0) return;
    const k = `${s}>${t}`;
    linkAgg.set(k, (linkAgg.get(k) ?? 0) + v);
  };

  let netInflow = 0;
  let netOutflow = 0;
  for (const p of pairs) {
    const assetSide = (assetTotal.get(p.asset) ?? 0) >= 0 ? 'in' : 'out';
    if (p.net > 0 && assetSide === 'in') {
      const a = nodeId(inName(p.asset), 'inflow');
      const cc = nodeId(compName(p.component), 'component');
      addLink(a, cc, p.net);
    } else if (p.net < 0 && assetSide === 'out') {
      const cc = nodeId(compName(p.component), 'component');
      const a = nodeId(outName(p.asset), 'outflow');
      addLink(cc, a, -p.net);
    }
  }
  for (const [, v] of assetTotal) { if (v > 0) netInflow += v; else netOutflow += -v; }

  const links: SankeyLink[] = [...linkAgg.entries()].map(([k, value]) => {
    const [s, t] = k.split('>').map(Number);
    return { source: s!, target: t!, value };
  });

  // Per-node display value: inflow nodes = outgoing throughput, outflow nodes
  // = incoming throughput, component nodes = signed net (incoming − outgoing).
  const incoming = new Array(nodes.length).fill(0);
  const outgoing = new Array(nodes.length).fill(0);
  for (const l of links) {
    outgoing[l.source] += l.value;
    incoming[l.target] += l.value;
  }
  nodes.forEach((n, i) => {
    if (n.kind === 'inflow') n.usd = outgoing[i];
    else if (n.kind === 'outflow') n.usd = incoming[i];
    else n.usd = incoming[i] - outgoing[i]; // component signed net
  });

  return { nodes, links, netInflowUsd: netInflow, netOutflowUsd: netOutflow };
}

const PERIOD_WEEKS: Record<'W' | 'M' | 'Q', number> = { W: 1, M: 4, Q: 13 };
const PERIOD_DAYS: Record<'W' | 'M' | 'Q', number> = { W: 7, M: 30, Q: 91 };

export const getNetSupplyFlows = unstable_cache(
  async (period: 'W' | 'M' | 'Q' = 'W', view: 'chain' | 'curator' = 'chain'): Promise<NetSupplyFlows> => {
    const sql = getDb();

    if (view === 'chain') {
      // Sum the materialized weekly flows over the selected number of weeks.
      const weeks = PERIOD_WEEKS[period];
      const rows = (await sql(
        `
        WITH recent AS (
          SELECT DISTINCT week_start
          FROM morpho_.morpho_asset_flows_weekly
          ORDER BY week_start DESC LIMIT $1::int
        )
        SELECT ch.name AS component, f.asset_symbol AS asset, SUM(f.net_flow_usd)::float8 AS net
        FROM morpho_.morpho_asset_flows_weekly f
        LEFT JOIN morpho_.chains ch ON ch.chain_id = f.chain_id
        WHERE f.week_start IN (SELECT week_start FROM recent)
        GROUP BY ch.name, f.asset_symbol
        `,
        [weeks],
      )) as { component: string | null; asset: string; net: number }[];
      const pairs = rows
        .filter((r) => r.component && r.asset)
        .map((r) => ({ component: r.component!, asset: r.asset, net: r.net }));
      return { view, period, ...buildSankey(pairs) };
    }

    // BY CURATOR — compute live from vault_state_daily over the period window.
    // Net flow per (curator, vault asset) = footprint(end) − footprint(start).
    const days = PERIOD_DAYS[period];
    const rows = (await sql(
      `
      WITH window_states AS (
        SELECT
          s.chain_id, s.vault_address, s.snapshot_date::date AS day, s.total_assets_usd::float8 AS tvl,
          ROW_NUMBER() OVER (PARTITION BY s.chain_id, s.vault_address ORDER BY s.snapshot_date ASC)  AS rn_first,
          ROW_NUMBER() OVER (PARTITION BY s.chain_id, s.vault_address ORDER BY s.snapshot_date DESC) AS rn_last
        FROM morpho_.vault_state_daily s
        WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
      ),
      bounds AS (
        SELECT
          chain_id, vault_address,
          MAX(CASE WHEN rn_first = 1 THEN tvl END) AS start_tvl,
          MAX(CASE WHEN rn_last  = 1 THEN tvl END) AS end_tvl
        FROM window_states WHERE rn_first = 1 OR rn_last = 1
        GROUP BY chain_id, vault_address
      )
      SELECT
        COALESCE(cu.name, 'Unattributed') AS component,
        COALESCE(v.asset_symbol, '—')      AS asset,
        SUM(COALESCE(b.end_tvl,0) - COALESCE(b.start_tvl,0))::float8 AS net
      FROM bounds b
      JOIN morpho_.vaults v ON v.chain_id = b.chain_id AND v.address = b.vault_address
      LEFT JOIN morpho_.curators cu ON cu.id = v.curator_id
      GROUP BY COALESCE(cu.name, 'Unattributed'), COALESCE(v.asset_symbol, '—')
      `,
      [days],
    )) as { component: string; asset: string; net: number }[];
    return { view, period, ...buildSankey(rows.map((r) => ({ component: r.component, asset: r.asset, net: r.net }))) };
  },
  [CACHE_VERSION, 'net-supply-flows'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 5. Mix donuts (collateral + borrow)
// ───────────────────────────────────────────────────────────────────────

const DONUT_TOP = 7;

export const getMorphoMixDonuts = unstable_cache(
  async (period: 'current' | 'week' | 'month' | 'quarter' = 'current'): Promise<MixDonuts> => {
    const sql = getDb();
    const offsetDays = period === 'week' ? 7 : period === 'month' ? 30 : period === 'quarter' ? 91 : 0;

    const rows = (await sql(
      `
      WITH anchor AS (
        SELECT MAX(snapshot_date) - ($1::int || ' days')::interval AS d FROM morpho_.market_state_daily
      ),
      snap AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, collateral_assets_usd, borrow_assets_usd
        FROM morpho_.market_state_daily
        WHERE snapshot_date <= (SELECT d FROM anchor)
        ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.loan_asset_symbol AS loan, m.collateral_asset_symbol AS collateral,
        SUM(COALESCE(s.supply_assets_usd,0))::float8     AS supply,
        SUM(COALESCE(s.collateral_assets_usd,0))::float8 AS coll,
        SUM(COALESCE(s.borrow_assets_usd,0))::float8     AS borrow
      FROM morpho_.markets m
      JOIN snap s ON s.market_unique_key = m.unique_key
      GROUP BY m.loan_asset_symbol, m.collateral_asset_symbol
      `,
      [offsetDays],
    )) as { loan: string | null; collateral: string | null; supply: number; coll: number; borrow: number }[];

    // Collateral mix = supply attributed to loan asset + collateral attributed
    // to collateral asset (the deposit base, by asset).
    const collMap = new Map<string, number>();
    const borrowMap = new Map<string, number>();
    for (const r of rows) {
      if (r.loan) collMap.set(r.loan, (collMap.get(r.loan) ?? 0) + r.supply);
      if (r.collateral) collMap.set(r.collateral, (collMap.get(r.collateral) ?? 0) + r.coll);
      if (r.loan) borrowMap.set(r.loan, (borrowMap.get(r.loan) ?? 0) + r.borrow);
    }

    const topSlices = (m: Map<string, number>): { slices: AssetSlice[]; total: number } => {
      const all = [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      const total = all.reduce((s, [, v]) => s + v, 0);
      const top = all.slice(0, DONUT_TOP).map(([symbol, usd]) => ({ symbol, usd }));
      const rest = all.slice(DONUT_TOP).reduce((s, [, v]) => s + v, 0);
      if (rest > 0) top.push({ symbol: 'Other', usd: rest });
      return { slices: top, total };
    };

    const coll = topSlices(collMap);
    const borrow = topSlices(borrowMap);
    const asOf = (await sql`SELECT MAX(snapshot_date)::text AS d FROM morpho_.market_state_daily`) as { d: string }[];

    return {
      period,
      asOfDate: asOf[0]?.d ?? new Date().toISOString().slice(0, 10),
      collateralMix: coll.slices, collateralTotal: coll.total,
      borrowMix: borrow.slices, borrowTotal: borrow.total,
    };
  },
  [CACHE_VERSION, 'mix-donuts'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 6. Top markets across Morpho
// ───────────────────────────────────────────────────────────────────────

export type TopMarketsPeriod = 'current' | 'week' | 'month' | 'quarter';

/**
 * Full market snapshot for a period (all live markets, no sort/limit),
 * capped at 400 rows by supply to bound payload. The Overview's top-markets
 * table does view (top-10 sector / top-5 per-chain) and sort entirely
 * client-side from this list, so the period toggle is the only thing that
 * needs a server fetch.
 */
export const getOverviewMarketsByPeriod = unstable_cache(
  async (period: TopMarketsPeriod = 'current'): Promise<TopMarketRow[]> => {
    const sql = getDb();
    const offsetDays = period === 'week' ? 7 : period === 'month' ? 30 : period === 'quarter' ? 91 : 0;
    const rows = (await sql(
      `
      WITH anchor AS (
        SELECT MAX(snapshot_date) - ($1::int || ' days')::interval AS d FROM morpho_.market_state_daily
      ),
      snap AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, borrow_assets_usd, utilization, supply_apy, borrow_apy
        FROM morpho_.market_state_daily
        WHERE snapshot_date <= (SELECT d FROM anchor)
        ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.unique_key, ch.slug AS chain_slug, ch.name AS chain_name,
        m.collateral_asset_symbol AS coll, m.loan_asset_symbol AS loan,
        s.supply_assets_usd::float8 AS supply, s.borrow_assets_usd::float8 AS borrow,
        s.utilization::float8 AS util, s.supply_apy::float8 AS supply_apy, s.borrow_apy::float8 AS borrow_apy
      FROM morpho_.markets m
      JOIN snap s ON s.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE s.supply_assets_usd > 0
      ORDER BY s.supply_assets_usd DESC
      LIMIT 400
      `,
      [offsetDays],
    )) as {
      unique_key: string; chain_slug: string | null; chain_name: string | null;
      coll: string | null; loan: string; supply: number; borrow: number | null;
      util: number | null; supply_apy: number | null; borrow_apy: number | null;
    }[];
    const clampApy = (v: number | null) => (v != null && v < 1.0 ? v : null);
    return rows.map((r) => {
      const supply = r.supply ?? 0;
      const borrow = r.borrow ?? 0;
      return {
        rank: 0,
        uniqueKey: r.unique_key,
        chainSlug: r.chain_slug,
        chainName: r.chain_name,
        pair: `${r.coll ?? '—'} / ${r.loan}`,
        supplyUsd: supply,
        liquidityUsd: Math.max(0, supply - borrow),
        borrowUsd: borrow,
        utilization: r.util,
        supplyApy: clampApy(r.supply_apy),
        borrowApy: clampApy(r.borrow_apy),
      };
    });
  },
  [CACHE_VERSION, 'overview-markets-by-period'],
  { revalidate: TTL, tags: ['overview'] },
);

export const getTopMarketsAcrossMorpho = unstable_cache(
  async (
    period: 'current' | 'week' | 'month' | 'quarter' = 'current',
    view: 'sector' | 'perChain' = 'sector',
    sortBy: TopMarketsSort = 'supply',
  ): Promise<TopMarketRow[]> => {
    const sql = getDb();
    const offsetDays = period === 'week' ? 7 : period === 'month' ? 30 : period === 'quarter' ? 91 : 0;

    const rows = (await sql(
      `
      WITH anchor AS (
        SELECT MAX(snapshot_date) - ($1::int || ' days')::interval AS d FROM morpho_.market_state_daily
      ),
      snap AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, borrow_assets_usd, utilization, supply_apy, borrow_apy
        FROM morpho_.market_state_daily
        WHERE snapshot_date <= (SELECT d FROM anchor)
        ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.unique_key, ch.slug AS chain_slug, ch.name AS chain_name,
        m.collateral_asset_symbol AS coll, m.loan_asset_symbol AS loan,
        s.supply_assets_usd::float8 AS supply,
        s.borrow_assets_usd::float8 AS borrow,
        s.utilization::float8 AS util,
        s.supply_apy::float8 AS supply_apy,
        s.borrow_apy::float8 AS borrow_apy
      FROM morpho_.markets m
      JOIN snap s ON s.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE s.supply_assets_usd > 0
      `,
      [offsetDays],
    )) as {
      unique_key: string; chain_slug: string | null; chain_name: string | null;
      coll: string | null; loan: string;
      supply: number; borrow: number | null; util: number | null;
      supply_apy: number | null; borrow_apy: number | null;
    }[];

    const mapped: TopMarketRow[] = rows.map((r) => {
      const supply = r.supply ?? 0;
      const borrow = r.borrow ?? 0;
      const clampApy = (v: number | null) => (v != null && v < 1.0 ? v : null);
      return {
        rank: 0,
        uniqueKey: r.unique_key,
        chainSlug: r.chain_slug,
        chainName: r.chain_name,
        pair: `${r.coll ?? '—'} / ${r.loan}`,
        supplyUsd: supply,
        liquidityUsd: Math.max(0, supply - borrow),
        borrowUsd: borrow,
        utilization: r.util,
        supplyApy: clampApy(r.supply_apy),
        borrowApy: clampApy(r.borrow_apy),
      };
    });

    const sortVal = (m: TopMarketRow): number => {
      switch (sortBy) {
        case 'supply':      return m.supplyUsd;
        case 'borrows':     return m.borrowUsd;
        case 'utilization': return m.utilization ?? -1;
        case 'supplyApy':   return m.supplyApy ?? -1;
        case 'borrowApy':   return m.borrowApy ?? -1;
        case 'liquidity':   return m.liquidityUsd;
      }
    };
    mapped.sort((a, b) => sortVal(b) - sortVal(a));

    let result: TopMarketRow[];
    if (view === 'perChain') {
      // Top 5 per chain.
      const perChain = new Map<string, TopMarketRow[]>();
      for (const m of mapped) {
        const key = m.chainSlug ?? String(m.chainName ?? '?');
        const arr = perChain.get(key) ?? [];
        if (arr.length < 5) { arr.push(m); perChain.set(key, arr); }
      }
      result = [...perChain.values()].flat();
    } else {
      result = mapped.slice(0, 10);
    }
    return result.map((m, i) => ({ ...m, rank: i + 1 }));
  },
  [CACHE_VERSION, 'top-markets'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 7. Protocol TVL comparison + ranking (Section 8 — sector position)
// ───────────────────────────────────────────────────────────────────────

export interface ProtocolComparisonOpts {
  scope?: 'global' | { chain: string };
  days?: number;
  collapseLegacy?: boolean;
  includeCdp?: boolean;
}

export const getProtocolTvlComparison = unstable_cache(
  async (opts: ProtocolComparisonOpts = {}): Promise<ProtocolComparisonResult> => {
    const scope = opts.scope ?? 'global';
    const days = opts.days ?? 730;
    const collapse = Boolean(opts.collapseLegacy);
    const includeCdp = opts.includeCdp ?? false;
    const sql = getDb();
    const slugs: string[] = [...ALL_LENDING_SLUGS];
    const chainFilter = scope === 'global' ? '' : `AND chain_slug = $3::text`;
    const params: unknown[] = [days, slugs];
    if (scope !== 'global') params.push(scope.chain);

    const rows = (await sql(
      `
      SELECT protocol_slug, snapshot_date::text AS day, SUM(tvl_usd)::float8 AS tvl
      FROM morpho_.protocol_tvl_daily
      WHERE snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
        AND protocol_slug = ANY($2::text[])
        ${chainFilter}
      GROUP BY protocol_slug, snapshot_date
      ORDER BY protocol_slug, snapshot_date
      `,
      params,
    )) as { protocol_slug: string; day: string; tvl: number }[];

    const build = (protocols: readonly ProtocolMeta[]): ProtocolSeries[] => {
      if (!collapse) {
        return protocols.map((p) => ({
          key: p.slug, label: p.label, brand: p.brand, legacy: p.legacy,
          points: rows.filter((r) => r.protocol_slug === p.slug).map((r) => ({ day: r.day, tvl: r.tvl })),
        }));
      }
      return collapseByBrand(protocols).map((g) => {
        const byDay = new Map<string, number>();
        for (const r of rows) {
          if (!g.slugs.includes(r.protocol_slug)) continue;
          byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.tvl);
        }
        return {
          key: g.brand, label: g.label, brand: g.brand, legacy: false,
          points: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, tvl]) => ({ day, tvl })),
        };
      });
    };
    return {
      lending: build(LENDING_PROTOCOLS.overcollateralized),
      cdp: includeCdp ? build(LENDING_PROTOCOLS.cdp) : [],
      collapsedLegacy: collapse,
    };
  },
  [CACHE_VERSION, 'protocol-tvl-comparison'],
  { revalidate: TTL, tags: ['overview'] },
);

export const getProtocolRanking = unstable_cache(
  async (): Promise<ProtocolRanking> => {
    const sql = getDb();
    const slugs: string[] = LENDING_PROTOCOLS.overcollateralized.map((p) => p.slug);
    const slugToLabel = new Map<string, string>(
      LENDING_PROTOCOLS.overcollateralized.map((p) => [p.slug, p.label]),
    );
    const latest = (await sql(
      `
      WITH last_day AS (
        SELECT MAX(snapshot_date) AS d FROM morpho_.protocol_tvl_daily WHERE protocol_slug = ANY($1::text[])
      )
      SELECT protocol_slug, SUM(tvl_usd)::float8 AS tvl
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = ANY($1::text[]) AND snapshot_date = (SELECT d FROM last_day)
      GROUP BY protocol_slug
      `,
      [slugs],
    )) as { protocol_slug: string; tvl: number }[];

    const ranked = latest
      .map((r) => ({ slug: r.protocol_slug, label: slugToLabel.get(r.protocol_slug) ?? r.protocol_slug, tvlUsd: r.tvl }))
      .sort((a, b) => b.tvlUsd - a.tvlUsd);
    const idx = ranked.findIndex((r) => r.slug === 'morpho-blue');
    const morpho = idx >= 0 ? ranked[idx]! : { slug: 'morpho-blue', label: 'Morpho', tvlUsd: 0 };
    const oneAbove = idx > 0 ? ranked[idx - 1]! : null;
    return {
      allRanked: ranked,
      morphoRank: idx >= 0 ? idx + 1 : ranked.length + 1,
      morphoTvl: morpho.tvlUsd,
      totalLendingProtocols: ranked.length,
      oneAbove,
      gapToOneAboveUsd: oneAbove ? oneAbove.tvlUsd - morpho.tvlUsd : null,
    };
  },
  [CACHE_VERSION, 'protocol-ranking'],
  { revalidate: TTL, tags: ['overview'] },
);
