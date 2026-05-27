// Overview-surface queries.
//
// Powers the 12-section Overview rebuild. Every metric on the page is
// returned with both a current value and a time series; nothing on this
// page is a bare snapshot. Heavy weekly aggregates read from the
// `overview_weekly_chain_metrics` materialized table (built by the
// `aggregate-overview-weekly` worker job).

import { unstable_cache } from 'next/cache';

import {
  ALL_LENDING_SLUGS,
  LENDING_PROTOCOLS,
  collapseByBrand,
  type ProtocolMeta,
} from '../protocols/comparison-set.js';
import { getDb } from '../db.js';

const CACHE_VERSION = 'overview-v3';
const TTL = 900;

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

export interface SparklinePoint { day: string; value: number }

export interface KpiLens {
  /** Latest value, USD. */
  value: number;
  /** Value ~30 days ago for delta. */
  value30dAgo: number | null;
  /** Percent change vs 30d (decimal: 0.05 = +5%). null if no anchor. */
  delta30dPct: number | null;
  /** Last 30 daily points, oldest → newest, for the inline sparkline. */
  sparkline: SparklinePoint[];
}

export interface ProtocolKpis {
  asOfDate: string;
  totalDeposits: KpiLens;       // supply + collateral
  activeLoans: KpiLens;         // borrow
  tvl: KpiLens;                  // deposits - loans
  totalSupply: KpiLens;          // supply only (loan side)
  annualBorrowInterest: KpiLens; // Σ borrow_usd × borrow_apy, latest day, annualized
  annualCurationFees: KpiLens;   // Σ vault_tvl × pre-fee apy × fee_bps/10000, annualized
  assetsUnderCuration: KpiLens;  // Σ vault.total_assets_usd
}

export interface DepositsLoansPoint {
  day: string;
  totalDeposits: number;
  activeLoans: number;
  tvl: number;
}

export type ChainSeriesPoint = { day: string } & Record<string, string | number>;

export interface ChainSeries {
  chains: { slug: string; name: string }[];
  points: ChainSeriesPoint[];
  topChainSlug: string | null;
  topChainShareLatest: number;     // 0..1
  topChainShare12moAgo: number;     // 0..1
  totalLatestUsd: number;
}

export interface WeeklyChainBucket {
  weekStart: string;
  /** USD per chain slug. */
  byChain: Record<string, number>;
  total: number;
}

export interface WeeklyChainSeries {
  chains: { slug: string; name: string }[];
  buckets: WeeklyChainBucket[];
  lastWeekTopChain: string | null;
  lastWeekTopChainSharePct: number;
  lastWeekTotalUsd: number;
  annualRunRateUsd: number;
}

export interface ProtocolTvlPoint {
  day: string;
  /** Aggregate-key → USD. The key is either a slug (collapseLegacy=false)
   *  or a brand (collapseLegacy=true). */
  [key: string]: string | number;
}

export interface ProtocolSeries {
  key: string;
  label: string;
  brand: string;
  legacy: boolean;
  points: { day: string; tvl: number }[];
}

export interface ProtocolComparisonResult {
  lending: ProtocolSeries[];
  cdp: ProtocolSeries[];
  collapsedLegacy: boolean;
}

export interface ProtocolRanking {
  allRanked: { slug: string; label: string; tvlUsd: number }[];
  morphoRank: number;
  morphoTvl: number;
  totalLendingProtocols: number;
  oneAbove: { slug: string; label: string; tvlUsd: number } | null;
  oneBelow: { slug: string; label: string; tvlUsd: number } | null;
  gapToOneAboveUsd: number | null;
  /** Morpho TVL ÷ Aave V3 TVL, latest day. */
  morphoVsAaveV3Pct: number | null;
  /** Same ratio ~365 days ago. */
  morphoVsAaveV3Pct12moAgo: number | null;
}

export interface TopMarket {
  uniqueKey: string;
  chainSlug: string | null;
  pair: string;
  supplyUsd: number;
}

export interface TopVault {
  chainId: number;
  chainSlug: string | null;
  address: string;
  name: string | null;
  tvlUsd: number;
}

export interface TopCurator {
  id: string;
  name: string;
  tvlUsd: number;
}

export interface TopFiveSnapshots {
  topMarkets: TopMarket[];
  topVaults: TopVault[];
  topCurators: TopCurator[];
}

export interface RecentMarketLaunch {
  uniqueKey: string;
  chainSlug: string | null;
  chainName: string | null;
  pair: string;
  createdAt: string;
}

export interface RecentVaultLaunch {
  chainId: number;
  chainSlug: string | null;
  chainName: string | null;
  address: string;
  name: string;
  assetSymbol: string | null;
  createdAt: string;
}

export interface RecentLaunches {
  markets: RecentMarketLaunch[];
  vaults: RecentVaultLaunch[];
}

export interface EntityGrowthPoint {
  day: string;
  markets: number;
  vaults: number;
  curators: number;
}

// ───────────────────────────────────────────────────────────────────────
// Back-compat: original 5-KPI bag still used by legacy callers.
// ───────────────────────────────────────────────────────────────────────

export interface OverviewKpis {
  morphoTvlUsd: number | null;
  marketCount: number;
  vaultCount: number;
  curatorCount: number;
  chainsLiveCount: number;
  asOfDate: string | null;
  hasData: boolean;
}

export const getOverviewKpis = unstable_cache(
  async (): Promise<OverviewKpis> => {
    const sql = getDb();
    const tvlRows = (await sql`
      WITH latest AS (
        SELECT (MAX(snapshot_date) - INTERVAL '1 day')::date AS d
        FROM morpho_.protocol_tvl_daily WHERE protocol_slug = 'morpho-blue'
      )
      SELECT
        COALESCE(SUM(tvl_usd), 0)::float8 AS tvl,
        (SELECT d::text FROM latest)      AS as_of
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = 'morpho-blue'
        AND snapshot_date = (SELECT d FROM latest)
    `) as { tvl: number; as_of: string | null }[];

    const counts = (await sql`
      SELECT
        (SELECT COUNT(*)::int FROM morpho_.markets)                              AS markets,
        (SELECT COUNT(*)::int FROM morpho_.vaults)                               AS vaults,
        (SELECT COUNT(*)::int FROM morpho_.curators)                             AS curators,
        (SELECT COUNT(DISTINCT chain_id)::int FROM morpho_.markets)              AS chains_live
    `) as { markets: number; vaults: number; curators: number; chains_live: number }[];

    const c = counts[0] ?? { markets: 0, vaults: 0, curators: 0, chains_live: 0 };
    const tvl = tvlRows[0]?.tvl ?? 0;
    const asOf = tvlRows[0]?.as_of ?? null;
    return {
      morphoTvlUsd: tvl > 0 ? tvl : null,
      marketCount: c.markets,
      vaultCount: c.vaults,
      curatorCount: c.curators,
      chainsLiveCount: c.chains_live,
      asOfDate: asOf,
      hasData: c.markets > 0 || tvl > 0,
    };
  },
  ['overview-kpis-v2'],
  { revalidate: 900, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 1. Seven KPI lenses with 30d sparklines
// ───────────────────────────────────────────────────────────────────────

export const getProtocolKpis = unstable_cache(
  async (): Promise<ProtocolKpis> => {
    const sql = getDb();

    // Pull 35 days of per-day rolled-up totals across the protocol. The
    // sparkline trims to the last 30, and the 30-day-ago anchor for delta
    // uses the row exactly 30 days before the latest.
    const dailyMarket = (await sql`
      WITH per_day AS (
        SELECT
          s.snapshot_date::date AS day,
          SUM(COALESCE(s.supply_assets_usd, 0))::float8     AS supply,
          SUM(COALESCE(s.collateral_assets_usd, 0))::float8 AS collateral,
          SUM(COALESCE(s.borrow_assets_usd, 0))::float8     AS borrow,
          SUM(
            COALESCE(s.borrow_assets_usd, 0) * COALESCE(s.borrow_apy, 0)
          )::float8                                          AS borrow_interest_run_rate
        FROM morpho_.market_state_daily s
        WHERE s.snapshot_date >= (
              SELECT MAX(snapshot_date) - INTERVAL '35 days' FROM morpho_.market_state_daily
            )
          AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
        GROUP BY s.snapshot_date::date
      )
      SELECT day::text, supply, collateral, borrow, borrow_interest_run_rate
      FROM per_day ORDER BY day
    `) as {
      day: string;
      supply: number; collateral: number; borrow: number;
      borrow_interest_run_rate: number;
    }[];

    const dailyVault = (await sql`
      WITH per_day AS (
        SELECT
          s.snapshot_date::date AS day,
          SUM(COALESCE(s.total_assets_usd, 0))::float8 AS assets,
          SUM(
            COALESCE(s.total_assets_usd, 0)
              * COALESCE(s.apy, 0)
              * COALESCE(s.fee_bps, 0) / 10000.0
          )::float8 AS fee_run_rate
        FROM morpho_.vault_state_daily s
        WHERE s.snapshot_date >= (
              SELECT MAX(snapshot_date) - INTERVAL '35 days' FROM morpho_.vault_state_daily
            )
          AND COALESCE(s.apy, 0) < 1.0
        GROUP BY s.snapshot_date::date
      )
      SELECT day::text, assets, fee_run_rate FROM per_day ORDER BY day
    `) as { day: string; assets: number; fee_run_rate: number }[];

    // Build a unified per-day record set keyed by day.
    type Row = {
      day: string;
      deposits: number;
      loans: number;
      tvl: number;
      supply: number;
      borrowInterest: number;     // annualized $
      curationFees: number;       // annualized $
      assetsUnderCuration: number;
    };
    const byDay = new Map<string, Row>();
    for (const r of dailyMarket) {
      const deposits = r.supply + r.collateral;
      const loans = r.borrow;
      byDay.set(r.day, {
        day: r.day,
        deposits,
        loans,
        tvl: deposits - loans,
        supply: r.supply,
        borrowInterest: r.borrow_interest_run_rate,
        curationFees: 0,
        assetsUnderCuration: 0,
      });
    }
    for (const r of dailyVault) {
      const ex = byDay.get(r.day);
      if (ex) {
        ex.curationFees = r.fee_run_rate;
        ex.assetsUnderCuration = r.assets;
      } else {
        byDay.set(r.day, {
          day: r.day,
          deposits: 0, loans: 0, tvl: 0, supply: 0, borrowInterest: 0,
          curationFees: r.fee_run_rate,
          assetsUnderCuration: r.assets,
        });
      }
    }
    const series = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    if (series.length === 0) {
      const empty = (): KpiLens => ({ value: 0, value30dAgo: null, delta30dPct: null, sparkline: [] });
      return {
        asOfDate: new Date().toISOString().slice(0, 10),
        totalDeposits: empty(), activeLoans: empty(), tvl: empty(), totalSupply: empty(),
        annualBorrowInterest: empty(), annualCurationFees: empty(), assetsUnderCuration: empty(),
      };
    }

    const last = series[series.length - 1]!;
    const ago = series[Math.max(0, series.length - 31)]!;

    const buildLens = (latest: number, prior: number | null, picker: (r: Row) => number): KpiLens => {
      const sparkline = series.slice(-30).map((r) => ({ day: r.day, value: picker(r) }));
      const delta30dPct = prior != null && prior > 0 ? (latest - prior) / prior : null;
      return { value: latest, value30dAgo: prior, delta30dPct, sparkline };
    };

    return {
      asOfDate: last.day,
      totalDeposits: buildLens(last.deposits, ago.deposits, (r) => r.deposits),
      activeLoans:   buildLens(last.loans,    ago.loans,    (r) => r.loans),
      tvl:           buildLens(last.tvl,      ago.tvl,      (r) => r.tvl),
      totalSupply:   buildLens(last.supply,   ago.supply,   (r) => r.supply),
      annualBorrowInterest: buildLens(
        last.borrowInterest, ago.borrowInterest, (r) => r.borrowInterest,
      ),
      annualCurationFees: buildLens(
        last.curationFees, ago.curationFees, (r) => r.curationFees,
      ),
      assetsUnderCuration: buildLens(
        last.assetsUnderCuration, ago.assetsUnderCuration, (r) => r.assetsUnderCuration,
      ),
    };
  },
  [CACHE_VERSION, 'protocol-kpis'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 2. Deposits + Loans (+ derived TVL) — protocol-wide daily, 730d
// ───────────────────────────────────────────────────────────────────────

export const getDepositsAndLoansSeries = unstable_cache(
  async (days = 730): Promise<DepositsLoansPoint[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      SELECT
        s.snapshot_date::date::text AS day,
        SUM(COALESCE(s.supply_assets_usd, 0) + COALESCE(s.collateral_assets_usd, 0))::float8 AS deposits,
        SUM(COALESCE(s.borrow_assets_usd, 0))::float8 AS loans
      FROM morpho_.market_state_daily s
      WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
        AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
      GROUP BY s.snapshot_date::date
      ORDER BY day
      `,
      [days],
    )) as { day: string; deposits: number; loans: number }[];
    return rows.map((r) => ({
      day: r.day,
      totalDeposits: r.deposits,
      activeLoans: r.loans,
      tvl: r.deposits - r.loans,
    }));
  },
  [CACHE_VERSION, 'deposits-loans'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 3. Per-chain time series for deposits / loans / tvl / supply (730d).
//    Top 8 chains as named series; rest aggregated into "Other".
// ───────────────────────────────────────────────────────────────────────

export type ChainMetricKey = 'deposits' | 'loans' | 'tvl' | 'supply';

const CHAIN_SERIES_TOP = 8;

export const getMetricByChainSeries = unstable_cache(
  async (metric: ChainMetricKey, days = 730): Promise<ChainSeries> => {
    const sql = getDb();

    // Build the metric expression once.
    const expr = (() => {
      switch (metric) {
        case 'deposits': return 'COALESCE(s.supply_assets_usd, 0) + COALESCE(s.collateral_assets_usd, 0)';
        case 'loans':    return 'COALESCE(s.borrow_assets_usd, 0)';
        case 'supply':   return 'COALESCE(s.supply_assets_usd, 0)';
        case 'tvl':      return 'COALESCE(s.supply_assets_usd, 0) + COALESCE(s.collateral_assets_usd, 0) - COALESCE(s.borrow_assets_usd, 0)';
      }
    })();

    const rows = (await sql(
      `
      SELECT
        s.snapshot_date::date::text AS day,
        ch.slug                      AS chain_slug,
        ch.name                      AS chain_name,
        SUM(${expr})::float8         AS value
      FROM morpho_.market_state_daily s
      JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
        AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
      GROUP BY s.snapshot_date::date, ch.slug, ch.name
      `,
      [days],
    )) as { day: string; chain_slug: string | null; chain_name: string | null; value: number }[];

    // Determine the top N chains by latest-day value.
    const latestDay = rows.reduce((m, r) => (r.day > m ? r.day : m), '');
    const latestByChain = new Map<string, number>();
    for (const r of rows) {
      if (r.day === latestDay && r.chain_slug) {
        latestByChain.set(r.chain_slug, (latestByChain.get(r.chain_slug) ?? 0) + r.value);
      }
    }
    const ranked = [...latestByChain.entries()].sort((a, b) => b[1] - a[1]);
    const topChains = new Set(ranked.slice(0, CHAIN_SERIES_TOP).map((x) => x[0]));

    const nameBySlug = new Map<string, string>();
    for (const r of rows) {
      if (r.chain_slug && r.chain_name) nameBySlug.set(r.chain_slug, r.chain_name);
    }

    // Build the pivoted point list. Other = sum of everything not in topChains.
    const pointMap = new Map<string, ChainSeriesPoint>();
    for (const r of rows) {
      let p = pointMap.get(r.day);
      if (!p) { p = { day: r.day }; pointMap.set(r.day, p); }
      const key = r.chain_slug && topChains.has(r.chain_slug) ? r.chain_slug : 'Other';
      p[key] = ((p[key] as number) ?? 0) + r.value;
    }
    const points = [...pointMap.values()].sort((a, b) => a.day.localeCompare(b.day));

    const chains: { slug: string; name: string }[] = [
      ...ranked.slice(0, CHAIN_SERIES_TOP).map(([slug]) => ({
        slug, name: nameBySlug.get(slug) ?? slug,
      })),
    ];
    if (ranked.length > CHAIN_SERIES_TOP) chains.push({ slug: 'Other', name: 'Other chains' });

    const total = ranked.reduce((s, [, v]) => s + v, 0);
    const top = ranked[0];
    const topShare = total > 0 && top ? top[1] / total : 0;

    // 12-month-ago top-chain share.
    const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    let oldTotal = 0;
    let oldTop = 0;
    const candidateDays = rows
      .map((r) => r.day)
      .filter((d) => d <= cutoff)
      .sort();
    const oldestDay = candidateDays[candidateDays.length - 1];
    if (oldestDay && top) {
      for (const r of rows) {
        if (r.day !== oldestDay) continue;
        oldTotal += r.value;
        if (r.chain_slug === top[0]) oldTop += r.value;
      }
    }
    return {
      chains,
      points,
      topChainSlug: top?.[0] ?? null,
      topChainShareLatest: topShare,
      topChainShare12moAgo: oldTotal > 0 ? oldTop / oldTotal : 0,
      totalLatestUsd: total,
    };
  },
  [CACHE_VERSION, 'metric-by-chain'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 4+5. Weekly bar series (materialized table)
// ───────────────────────────────────────────────────────────────────────

async function readWeeklyMetric(
  column: 'borrow_interest_usd' | 'curation_fees_usd',
  weeks: number,
): Promise<WeeklyChainSeries> {
  const sql = getDb();
  const rows = (await sql(
    `
    WITH cutoff AS (
      SELECT date_trunc('week', CURRENT_DATE - ($1::int || ' weeks')::interval)::date AS d
    )
    SELECT
      w.week_start::text                                   AS week_start,
      w.chain_slug,
      ch.name                                              AS chain_name,
      w.${column}::float8                                  AS usd
    FROM morpho_.overview_weekly_chain_metrics w
    LEFT JOIN morpho_.chains ch ON ch.slug = w.chain_slug
    WHERE w.week_start >= (SELECT d FROM cutoff)
    ORDER BY w.week_start, w.chain_slug
    `,
    [weeks],
  )) as { week_start: string; chain_slug: string; chain_name: string | null; usd: number }[];

  // Group by week → byChain dict + total.
  const buckets = new Map<string, WeeklyChainBucket>();
  const allChains = new Map<string, string>();
  for (const r of rows) {
    let b = buckets.get(r.week_start);
    if (!b) { b = { weekStart: r.week_start, byChain: {}, total: 0 }; buckets.set(r.week_start, b); }
    b.byChain[r.chain_slug] = (b.byChain[r.chain_slug] ?? 0) + r.usd;
    b.total += r.usd;
    allChains.set(r.chain_slug, r.chain_name ?? r.chain_slug);
  }
  const ordered = [...buckets.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Last week summary stats for the auto-subtitle.
  const last = ordered[ordered.length - 1];
  let lastTopSlug: string | null = null;
  let lastTopShare = 0;
  if (last) {
    let topSlug = '';
    let topUsd = 0;
    for (const [slug, usd] of Object.entries(last.byChain)) {
      if (usd > topUsd) { topUsd = usd; topSlug = slug; }
    }
    lastTopSlug = topSlug || null;
    lastTopShare = last.total > 0 ? topUsd / last.total : 0;
  }

  // Annual run-rate: latest week × 52.
  const annualRunRate = (last?.total ?? 0) * 52;

  // Rank chains by all-time sum for legend order.
  const allTime = new Map<string, number>();
  for (const r of rows) allTime.set(r.chain_slug, (allTime.get(r.chain_slug) ?? 0) + r.usd);
  const chains = [...allChains.entries()]
    .sort((a, b) => (allTime.get(b[0]) ?? 0) - (allTime.get(a[0]) ?? 0))
    .map(([slug, name]) => ({ slug, name }));

  return {
    chains,
    buckets: ordered,
    lastWeekTopChain: lastTopSlug,
    lastWeekTopChainSharePct: lastTopShare,
    lastWeekTotalUsd: last?.total ?? 0,
    annualRunRateUsd: annualRunRate,
  };
}

export const getWeeklyBorrowInterestByChain = unstable_cache(
  async (weeks = 104): Promise<WeeklyChainSeries> => readWeeklyMetric('borrow_interest_usd', weeks),
  [CACHE_VERSION, 'weekly-borrow-interest'],
  { revalidate: TTL, tags: ['overview'] },
);

export const getWeeklyCurationFeesByChain = unstable_cache(
  async (weeks = 104): Promise<WeeklyChainSeries> => readWeeklyMetric('curation_fees_usd', weeks),
  [CACHE_VERSION, 'weekly-curation-fees'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 6. Protocol TVL comparison (lending + cdp)
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
    const includeCdp = opts.includeCdp ?? true;

    const sql = getDb();
    const slugs = ALL_LENDING_SLUGS;
    const chainFilter = scope === 'global' ? '' : `AND chain_slug = $3::text`;
    const params: unknown[] = [days, slugs];
    if (scope !== 'global') params.push(scope.chain);

    const rows = (await sql(
      `
      SELECT
        protocol_slug,
        snapshot_date::text AS day,
        SUM(tvl_usd)::float8 AS tvl
      FROM morpho_.protocol_tvl_daily
      WHERE snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
        AND protocol_slug = ANY($2::text[])
        ${chainFilter}
      GROUP BY protocol_slug, snapshot_date
      ORDER BY protocol_slug, snapshot_date
      `,
      params,
    )) as { protocol_slug: string; day: string; tvl: number }[];

    // Group rows by aggregate key.
    function buildSeries(protocols: readonly ProtocolMeta[]): ProtocolSeries[] {
      if (!collapse) {
        return protocols.map((p) => ({
          key: p.slug,
          label: p.label,
          brand: p.brand,
          legacy: p.legacy,
          points: rows
            .filter((r) => r.protocol_slug === p.slug)
            .map((r) => ({ day: r.day, tvl: r.tvl })),
        }));
      }
      // collapseLegacy: aggregate by brand.
      const groups = collapseByBrand(protocols);
      return groups.map((g) => {
        const byDay = new Map<string, number>();
        for (const r of rows) {
          if (!g.slugs.includes(r.protocol_slug)) continue;
          byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.tvl);
        }
        return {
          key: g.brand,
          label: g.label,
          brand: g.brand,
          legacy: false,
          points: [...byDay.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([day, tvl]) => ({ day, tvl })),
        };
      });
    }

    return {
      lending: buildSeries(LENDING_PROTOCOLS.overcollateralized),
      cdp: includeCdp ? buildSeries(LENDING_PROTOCOLS.cdp) : [],
      collapsedLegacy: collapse,
    };
  },
  [CACHE_VERSION, 'protocol-tvl-comparison'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 7. Protocol ranking + Morpho-vs-Aave-V3 share
// ───────────────────────────────────────────────────────────────────────

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
        SELECT MAX(snapshot_date) AS d
        FROM morpho_.protocol_tvl_daily
        WHERE protocol_slug = ANY($1::text[])
      )
      SELECT protocol_slug, SUM(tvl_usd)::float8 AS tvl
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = ANY($1::text[])
        AND snapshot_date = (SELECT d FROM last_day)
      GROUP BY protocol_slug
      `,
      [slugs],
    )) as { protocol_slug: string; tvl: number }[];

    const ranked = latest
      .map((r) => ({ slug: r.protocol_slug, label: slugToLabel.get(r.protocol_slug) ?? r.protocol_slug, tvlUsd: r.tvl }))
      .sort((a, b) => b.tvlUsd - a.tvlUsd);

    const morphoIdx = ranked.findIndex((r) => r.slug === 'morpho-blue');
    const morpho = morphoIdx >= 0 ? ranked[morphoIdx]! : { slug: 'morpho-blue', label: 'Morpho', tvlUsd: 0 };
    const oneAbove = morphoIdx > 0 ? ranked[morphoIdx - 1]! : null;
    const oneBelow = morphoIdx >= 0 && morphoIdx < ranked.length - 1 ? ranked[morphoIdx + 1]! : null;
    const gap = oneAbove ? oneAbove.tvlUsd - morpho.tvlUsd : null;

    // Morpho / AaveV3 ratio latest and 12mo ago.
    // Old-ratio subqueries pick the latest day on or before today-365 per
    // protocol, then SUM tvl across that day (the row is per chain). The
    // common Postgres footgun: `SUM(...) ... ORDER BY ... LIMIT 1` is
    // illegal because SUM collapses to one row already — so we pick the
    // anchor day in its own scalar subquery first.
    const compare = (await sql`
      WITH last_day AS (
        SELECT MAX(snapshot_date) AS d
        FROM morpho_.protocol_tvl_daily WHERE protocol_slug = 'aave-v3'
      ),
      morpho_old_day AS (
        SELECT MAX(snapshot_date) AS d
        FROM morpho_.protocol_tvl_daily
        WHERE protocol_slug = 'morpho-blue'
          AND snapshot_date <= (CURRENT_DATE - INTERVAL '365 days')::date
      ),
      aave_old_day AS (
        SELECT MAX(snapshot_date) AS d
        FROM morpho_.protocol_tvl_daily
        WHERE protocol_slug = 'aave-v3'
          AND snapshot_date <= (CURRENT_DATE - INTERVAL '365 days')::date
      )
      SELECT
        (SELECT SUM(tvl_usd)::float8 FROM morpho_.protocol_tvl_daily
          WHERE protocol_slug='morpho-blue' AND snapshot_date=(SELECT d FROM last_day))      AS morpho_now,
        (SELECT SUM(tvl_usd)::float8 FROM morpho_.protocol_tvl_daily
          WHERE protocol_slug='aave-v3'     AND snapshot_date=(SELECT d FROM last_day))      AS aave_now,
        (SELECT SUM(tvl_usd)::float8 FROM morpho_.protocol_tvl_daily
          WHERE protocol_slug='morpho-blue' AND snapshot_date=(SELECT d FROM morpho_old_day)) AS morpho_old,
        (SELECT SUM(tvl_usd)::float8 FROM morpho_.protocol_tvl_daily
          WHERE protocol_slug='aave-v3'     AND snapshot_date=(SELECT d FROM aave_old_day))   AS aave_old
    `) as { morpho_now: number | null; aave_now: number | null; morpho_old: number | null; aave_old: number | null }[];

    const c = compare[0]!;
    const ratio = (n: number | null, d: number | null) => (n != null && d != null && d > 0 ? n / d : null);
    return {
      allRanked: ranked,
      morphoRank: morphoIdx >= 0 ? morphoIdx + 1 : ranked.length + 1,
      morphoTvl: morpho.tvlUsd,
      totalLendingProtocols: ranked.length,
      oneAbove,
      oneBelow,
      gapToOneAboveUsd: gap,
      morphoVsAaveV3Pct: ratio(c.morpho_now, c.aave_now),
      morphoVsAaveV3Pct12moAgo: ratio(c.morpho_old, c.aave_old),
    };
  },
  [CACHE_VERSION, 'protocol-ranking'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 8. Top-5 snapshot panels
// ───────────────────────────────────────────────────────────────────────

export const getTopFiveSnapshots = unstable_cache(
  async (): Promise<TopFiveSnapshots> => {
    const sql = getDb();

    const markets = (await sql`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.unique_key, ch.slug AS chain_slug,
        m.collateral_asset_symbol AS coll, m.loan_asset_symbol AS loan,
        l.supply_assets_usd::float8 AS supply
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE l.supply_assets_usd > 0
      ORDER BY l.supply_assets_usd DESC LIMIT 5
    `) as { unique_key: string; chain_slug: string | null; coll: string | null; loan: string; supply: number }[];

    const vaults = (await sql`
      WITH latest AS (
        SELECT DISTINCT ON (chain_id, vault_address)
          chain_id, vault_address, total_assets_usd
        FROM morpho_.vault_state_daily ORDER BY chain_id, vault_address, snapshot_date DESC
      )
      SELECT
        v.chain_id, ch.slug AS chain_slug, v.address, v.name,
        l.total_assets_usd::float8 AS tvl
      FROM morpho_.vaults v
      JOIN latest l ON l.chain_id = v.chain_id AND l.vault_address = v.address
      LEFT JOIN morpho_.chains ch ON ch.chain_id = v.chain_id
      WHERE l.total_assets_usd > 0
      ORDER BY l.total_assets_usd DESC LIMIT 5
    `) as { chain_id: number; chain_slug: string | null; address: string; name: string | null; tvl: number }[];

    const curators = (await sql`
      WITH latest AS (
        SELECT DISTINCT ON (chain_id, vault_address)
          chain_id, vault_address, total_assets_usd
        FROM morpho_.vault_state_daily ORDER BY chain_id, vault_address, snapshot_date DESC
      )
      SELECT cu.id, cu.name, SUM(l.total_assets_usd)::float8 AS tvl
      FROM morpho_.vaults v
      JOIN latest l ON l.chain_id = v.chain_id AND l.vault_address = v.address
      JOIN morpho_.curators cu ON cu.id = v.curator_id
      WHERE l.total_assets_usd > 0
      GROUP BY cu.id, cu.name
      ORDER BY tvl DESC LIMIT 5
    `) as { id: string; name: string; tvl: number }[];

    return {
      topMarkets: markets.map((r) => ({
        uniqueKey: r.unique_key,
        chainSlug: r.chain_slug,
        pair: `${r.coll ?? '—'} / ${r.loan}`,
        supplyUsd: r.supply,
      })),
      topVaults: vaults.map((r) => ({
        chainId: r.chain_id, chainSlug: r.chain_slug,
        address: r.address, name: r.name, tvlUsd: r.tvl,
      })),
      topCurators: curators.map((r) => ({ id: r.id, name: r.name, tvlUsd: r.tvl })),
    };
  },
  [CACHE_VERSION, 'top-five'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 9. Recent launches
// ───────────────────────────────────────────────────────────────────────

export const getRecentLaunches = unstable_cache(
  async (days = 30): Promise<RecentLaunches> => {
    const sql = getDb();
    const markets = (await sql(
      `
      SELECT m.unique_key, ch.slug AS chain_slug, ch.name AS chain_name,
             m.collateral_asset_symbol AS coll, m.loan_asset_symbol AS loan,
             m.created_at
      FROM morpho_.markets m
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE m.created_at >= NOW() - ($1::int || ' days')::interval
      ORDER BY m.created_at DESC LIMIT 10
      `,
      [days],
    )) as { unique_key: string; chain_slug: string | null; chain_name: string | null;
            coll: string | null; loan: string; created_at: Date | string }[];

    const vaults = (await sql(
      `
      SELECT v.chain_id, ch.slug AS chain_slug, ch.name AS chain_name, v.address,
             COALESCE(v.name, v.symbol, v.address) AS name,
             v.asset_symbol, v.created_at
      FROM morpho_.vaults v
      LEFT JOIN morpho_.chains ch ON ch.chain_id = v.chain_id
      WHERE v.created_at >= NOW() - ($1::int || ' days')::interval
      ORDER BY v.created_at DESC LIMIT 10
      `,
      [days],
    )) as { chain_id: number; chain_slug: string | null; chain_name: string | null;
            address: string; name: string; asset_symbol: string | null; created_at: Date | string }[];

    const toIso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString());
    return {
      markets: markets.map((r) => ({
        uniqueKey: r.unique_key,
        chainSlug: r.chain_slug,
        chainName: r.chain_name,
        pair: `${r.coll ?? '—'} / ${r.loan}`,
        createdAt: toIso(r.created_at),
      })),
      vaults: vaults.map((r) => ({
        chainId: r.chain_id,
        chainSlug: r.chain_slug,
        chainName: r.chain_name,
        address: r.address,
        name: r.name,
        assetSymbol: r.asset_symbol,
        createdAt: toIso(r.created_at),
      })),
    };
  },
  [CACHE_VERSION, 'recent-launches'],
  { revalidate: TTL, tags: ['overview'] },
);

// ───────────────────────────────────────────────────────────────────────
// 10. Entity growth (markets / vaults / curators) over time
// ───────────────────────────────────────────────────────────────────────

export const getEntityGrowthSeries = unstable_cache(
  async (days = 730): Promise<EntityGrowthPoint[]> => {
    const sql = getDb();
    // Markets + vaults: count rows with state on each day (non-null,
    // non-zero state = active). Curators: distinct curator_id across active
    // vaults on that day. Done in three subqueries joined on day.
    const rows = (await sql(
      `
      WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - ($1::int || ' days')::interval)::date,
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS day
      ),
      m AS (
        SELECT s.snapshot_date::date AS day, COUNT(DISTINCT s.market_unique_key)::int AS n
        FROM morpho_.market_state_daily s
        WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
          AND (COALESCE(s.supply_assets_usd, 0) + COALESCE(s.collateral_assets_usd, 0) + COALESCE(s.borrow_assets_usd, 0)) > 0
        GROUP BY s.snapshot_date::date
      ),
      vs AS (
        SELECT s.snapshot_date::date AS day,
               COUNT(DISTINCT (s.chain_id, s.vault_address))::int AS n,
               COUNT(DISTINCT v.curator_id) FILTER (WHERE v.curator_id IS NOT NULL)::int AS c
        FROM morpho_.vault_state_daily s
        LEFT JOIN morpho_.vaults v
          ON v.chain_id = s.chain_id AND v.address = s.vault_address
        WHERE s.snapshot_date >= CURRENT_DATE - ($1::int || ' days')::interval
          AND COALESCE(s.total_assets_usd, 0) > 0
        GROUP BY s.snapshot_date::date
      )
      SELECT d.day::text AS day,
             COALESCE(m.n, 0)  AS markets,
             COALESCE(vs.n, 0) AS vaults,
             COALESCE(vs.c, 0) AS curators
      FROM days d
      LEFT JOIN m  ON m.day  = d.day
      LEFT JOIN vs ON vs.day = d.day
      ORDER BY d.day
      `,
      [days],
    )) as { day: string; markets: number; vaults: number; curators: number }[];
    return rows;
  },
  [CACHE_VERSION, 'entity-growth'],
  { revalidate: TTL, tags: ['overview'] },
);
