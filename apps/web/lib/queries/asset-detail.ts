// Per-asset detail page (/assets/[symbol]). Case-insensitive symbol matching.
// All numbers from markets × market_state_daily; degenerate-IRM markets
// (APY > 100%) excluded, APYs clamped at 100% as a backstop.

import { unstable_cache } from 'next/cache';

import { categorizeAsset } from '../assets/asset-class.js';
import { getDb } from '../db.js';

const CACHE_VERSION = 'asset-detail-v1';
const TTL = 900;

// NOTE: the exclude condition is inlined literally in every query below . 
// it cannot be a `${const}` because neon parameter-binds interpolated strings.

function growth30d(now: number, ago: number | null): number | null {
  if (ago == null || ago <= 0) return null;
  return (now - ago) / ago;
}
function doublingTimeDays(rate: number | null): number | null {
  if (rate == null || rate <= 0) return null;
  const d = (Math.log(2) / Math.log(1 + rate)) * 30;
  return Number.isFinite(d) && d > 0 ? d : null;
}

// ---------- Types ----------

export interface AssetHeader {
  symbol: string;
  name: string | null;
  assetClass: string;
  chainCount: number;
  loanMarketCount: number;
  collateralMarketCount: number;
}

export interface AssetKpis {
  totalSupply: number;
  totalCollateral: number;
  borrowInterestGen: number;
  lenderYieldDelivered: number;
  weightedSupplyApy: number | null;
  weightedUtilization: number | null;
  supply30dAgo: number | null;
  supply30dDeltaPct: number | null;
  doublingTimeDays: number | null;
}

export interface AssetChainSeriesPoint { date: string; [chain: string]: string | number | null }
export interface AssetChainSeries {
  chains: { slug: string; name: string; color: string }[];
  supply: AssetChainSeriesPoint[];
  collateral: AssetChainSeriesPoint[];
}

export interface AssetLoanMarketRow { uniqueKey: string; chainSlug: string | null; collateralSymbol: string | null; supplyUsd: number; borrowUsd: number; utilization: number | null; supplyApy: number | null; borrowApy: number | null; }
export interface AssetCollateralMarketRow { uniqueKey: string; chainSlug: string | null; loanSymbol: string; collateralUsd: number; lltvPct: number | null; utilization: number | null; }
export interface AssetMarketsBothSides { loanSide: AssetLoanMarketRow[]; collateralSide: AssetCollateralMarketRow[]; }

export interface AssetCuratorRow { curatorId: string; curatorName: string; vaultCount: number; aumInAssetUsd: number; weightedNetApy: number | null; feeTakeRate: number | null; }
export interface AssetChainBreakdownRow { chainSlug: string; chainName: string; supplyUsd: number; collateralUsd: number; marketCount: number; borrowInterestGen: number; rankOnChain: number | null; }
export interface AssetWeeklyFlowPoint { weekStart: string; [chain: string]: string | number; }

const PALETTE = ['#6b85ff', '#34d399', '#fbbf24', '#b97aff', '#38bdf8', '#74adff', '#f472b6', '#818cf8'];

// ---------- Resolver ----------

async function resolveSymbol(slug: string): Promise<string | null> {
  const sql = getDb();
  const rows = (await sql`
    SELECT sym FROM (
      SELECT loan_asset_symbol AS sym FROM morpho_.markets WHERE UPPER(loan_asset_symbol) = UPPER(${slug})
      UNION
      SELECT collateral_asset_symbol AS sym FROM morpho_.markets WHERE UPPER(collateral_asset_symbol) = UPPER(${slug})
    ) q WHERE sym IS NOT NULL LIMIT 1
  `) as { sym: string }[];
  return rows[0]?.sym ?? null;
}

// ---------- Queries ----------

export const getAssetHeader = unstable_cache(
  async (slug: string): Promise<AssetHeader | null> => {
    const sql = getDb();
    const symbol = await resolveSymbol(slug);
    if (!symbol) return null;
    const rows = (await sql`
      WITH lm AS (SELECT chain_id FROM morpho_.markets WHERE UPPER(loan_asset_symbol) = UPPER(${symbol})),
           cm AS (SELECT chain_id FROM morpho_.markets WHERE UPPER(collateral_asset_symbol) = UPPER(${symbol}))
      SELECT
        (SELECT COUNT(*)::int FROM lm) AS loan_markets,
        (SELECT COUNT(*)::int FROM cm) AS coll_markets,
        (SELECT COUNT(DISTINCT chain_id)::int FROM (SELECT chain_id FROM lm UNION SELECT chain_id FROM cm) x) AS chains,
        (SELECT name FROM morpho_.assets WHERE UPPER(symbol) = UPPER(${symbol}) LIMIT 1) AS name
    `) as { loan_markets: number; coll_markets: number; chains: number; name: string | null }[];
    const r = rows[0]!;
    return {
      symbol, name: r.name, assetClass: categorizeAsset(symbol),
      chainCount: r.chains, loanMarketCount: r.loan_markets, collateralMarketCount: r.coll_markets,
    };
  },
  [CACHE_VERSION, 'header'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getAssetKpis = unstable_cache(
  async (symbol: string): Promise<AssetKpis> => {
    const sql = getDb();
    const rows = (await sql`
      WITH ls AS (
        SELECT m.loan_asset_symbol, m.collateral_asset_symbol,
               s.supply_assets_usd::float8 AS sup, s.borrow_assets_usd::float8 AS bor,
               s.collateral_assets_usd::float8 AS col,
               LEAST(s.supply_apy, 1.0)::float8 AS sapy, LEAST(s.borrow_apy, 1.0)::float8 AS bapy,
               s.utilization::float8 AS util
        FROM morpho_.markets m
        JOIN LATERAL (SELECT * FROM morpho_.market_state_daily x WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
        WHERE (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0) AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      ),
      ls30 AS (
        SELECT m.loan_asset_symbol, s.b
        FROM morpho_.markets m
        JOIN LATERAL (SELECT supply_assets_usd::float8 AS b, supply_apy, borrow_apy FROM morpho_.market_state_daily x WHERE x.market_unique_key = m.unique_key AND x.snapshot_date <= CURRENT_DATE - INTERVAL '30 days' ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
        WHERE (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0) AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      )
      SELECT
        COALESCE(SUM(ls.sup) FILTER (WHERE UPPER(ls.loan_asset_symbol) = UPPER(${symbol})), 0)::float8 AS supply,
        COALESCE(SUM(ls.col) FILTER (WHERE UPPER(ls.collateral_asset_symbol) = UPPER(${symbol})), 0)::float8 AS collateral,
        COALESCE(SUM(ls.bor * ls.bapy) FILTER (WHERE UPPER(ls.loan_asset_symbol) = UPPER(${symbol})), 0)::float8 AS borrow_interest,
        COALESCE(SUM(ls.sup * ls.sapy) FILTER (WHERE UPPER(ls.loan_asset_symbol) = UPPER(${symbol})), 0)::float8 AS lender_yield,
        SUM(ls.sup * ls.sapy) FILTER (WHERE UPPER(ls.loan_asset_symbol) = UPPER(${symbol}))::float8 AS sapy_num,
        SUM(ls.util * ls.sup) FILTER (WHERE UPPER(ls.loan_asset_symbol) = UPPER(${symbol}))::float8 AS util_num,
        SUM(ls.sup) FILTER (WHERE UPPER(ls.loan_asset_symbol) = UPPER(${symbol}))::float8 AS sup_den,
        (SELECT COALESCE(SUM(b), 0)::float8 FROM ls30 WHERE UPPER(loan_asset_symbol) = UPPER(${symbol})) AS supply30
      FROM ls
    `) as { supply: number; collateral: number; borrow_interest: number; lender_yield: number; sapy_num: number | null; util_num: number | null; sup_den: number | null; supply30: number | null }[];
    const r = rows[0]!;
    const delta = growth30d(r.supply, r.supply30 && r.supply30 > 0 ? r.supply30 : null);
    return {
      totalSupply: r.supply, totalCollateral: r.collateral,
      borrowInterestGen: r.borrow_interest, lenderYieldDelivered: r.lender_yield,
      weightedSupplyApy: r.sup_den && r.sup_den > 0 && r.sapy_num != null ? r.sapy_num / r.sup_den : null,
      weightedUtilization: r.sup_den && r.sup_den > 0 && r.util_num != null ? r.util_num / r.sup_den : null,
      supply30dAgo: r.supply30, supply30dDeltaPct: delta, doublingTimeDays: doublingTimeDays(delta),
    };
  },
  [CACHE_VERSION, 'kpis'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getAssetSupplyAndCollateralByChainSeries = unstable_cache(
  async (symbol: string, days = 365): Promise<AssetChainSeries> => {
    const sql = getDb();
    const rows = (await sql`
      SELECT s.snapshot_date::text AS date, ch.slug AS chain_slug, ch.name AS chain_name,
        SUM(s.supply_assets_usd) FILTER (WHERE UPPER(m.loan_asset_symbol) = UPPER(${symbol}))::float8 AS supply,
        SUM(s.collateral_assets_usd) FILTER (WHERE UPPER(m.collateral_asset_symbol) = UPPER(${symbol}))::float8 AS collateral
      FROM morpho_.market_state_daily s
      JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE s.snapshot_date >= CURRENT_DATE - (${days} * INTERVAL '1 day')
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0) AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
        AND (UPPER(m.loan_asset_symbol) = UPPER(${symbol}) OR UPPER(m.collateral_asset_symbol) = UPPER(${symbol}))
      GROUP BY s.snapshot_date, ch.slug, ch.name
      ORDER BY s.snapshot_date ASC
    `) as { date: string; chain_slug: string; chain_name: string; supply: number | null; collateral: number | null }[];

    const chainSet = new Map<string, string>();
    const supply = new Map<string, AssetChainSeriesPoint>();
    const collateral = new Map<string, AssetChainSeriesPoint>();
    const ens = (m: Map<string, AssetChainSeriesPoint>, d: string) => { let p = m.get(d); if (!p) { p = { date: d }; m.set(d, p); } return p; };
    for (const r of rows) {
      if (!chainSet.has(r.chain_slug)) chainSet.set(r.chain_slug, r.chain_name);
      if (r.supply) ens(supply, r.date)[r.chain_slug] = r.supply;
      if (r.collateral) ens(collateral, r.date)[r.chain_slug] = r.collateral;
    }
    const chains = [...chainSet.entries()].map(([slug, name], i) => ({ slug, name, color: PALETTE[i % PALETTE.length]! }));
    const sortD = (m: Map<string, AssetChainSeriesPoint>) => [...m.values()].sort((a, b) => (a.date as string).localeCompare(b.date as string));
    return { chains, supply: sortD(supply), collateral: sortD(collateral) };
  },
  [CACHE_VERSION, 'chain-series'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getAssetMarketsBothSides = unstable_cache(
  async (symbol: string): Promise<AssetMarketsBothSides> => {
    const sql = getDb();
    const loan = (await sql`
      SELECT m.unique_key, ch.slug AS chain_slug, m.collateral_asset_symbol AS col,
        s.supply_assets_usd::float8 AS supply, s.borrow_assets_usd::float8 AS borrow, s.utilization::float8 AS util,
        LEAST(s.supply_apy, 1.0)::float8 AS sapy, LEAST(s.borrow_apy, 1.0)::float8 AS bapy
      FROM morpho_.markets m
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      JOIN LATERAL (SELECT * FROM morpho_.market_state_daily x WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
      WHERE UPPER(m.loan_asset_symbol) = UPPER(${symbol}) AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0) AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0) AND s.supply_assets_usd > 0
      ORDER BY s.supply_assets_usd DESC LIMIT 10
    `) as { unique_key: string; chain_slug: string | null; col: string | null; supply: number; borrow: number; util: number | null; sapy: number | null; bapy: number | null }[];
    const coll = (await sql`
      SELECT m.unique_key, ch.slug AS chain_slug, m.loan_asset_symbol AS loan,
        s.collateral_assets_usd::float8 AS collateral, (m.lltv::numeric / 1e18)::float8 AS lltv, s.utilization::float8 AS util
      FROM morpho_.markets m
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      JOIN LATERAL (SELECT * FROM morpho_.market_state_daily x WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
      WHERE UPPER(m.collateral_asset_symbol) = UPPER(${symbol}) AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0) AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0) AND s.collateral_assets_usd > 0
      ORDER BY s.collateral_assets_usd DESC LIMIT 10
    `) as { unique_key: string; chain_slug: string | null; loan: string; collateral: number; lltv: number | null; util: number | null }[];
    return {
      loanSide: loan.map((r) => ({ uniqueKey: r.unique_key, chainSlug: r.chain_slug, collateralSymbol: r.col, supplyUsd: r.supply, borrowUsd: r.borrow, utilization: r.util, supplyApy: r.sapy, borrowApy: r.bapy })),
      collateralSide: coll.map((r) => ({ uniqueKey: r.unique_key, chainSlug: r.chain_slug, loanSymbol: r.loan, collateralUsd: r.collateral, lltvPct: r.lltv != null ? r.lltv * 100 : null, utilization: r.util })),
    };
  },
  [CACHE_VERSION, 'markets'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getAssetCuratorsHolding = unstable_cache(
  async (symbol: string): Promise<AssetCuratorRow[]> => {
    const sql = getDb();
    const rows = (await sql`
      WITH lv AS (
        SELECT v.curator_id, s.total_assets_usd::float8 AS tvl, s.apy::float8 AS apy, s.net_apy::float8 AS net_apy, s.fee_bps
        FROM morpho_.vaults v
        JOIN LATERAL (SELECT total_assets_usd, apy, net_apy, fee_bps FROM morpho_.vault_state_daily x WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
        WHERE v.curator_id IS NOT NULL AND UPPER(v.asset_symbol) = UPPER(${symbol})
          AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0) AND s.total_assets_usd > 0
      )
      SELECT lv.curator_id, c.name,
        COUNT(*)::int AS vaults, SUM(lv.tvl)::float8 AS aum,
        CASE WHEN SUM(lv.tvl) > 0 THEN (SUM(lv.tvl * lv.net_apy) / SUM(lv.tvl))::float8 ELSE NULL END AS net_apy,
        SUM(lv.tvl * LEAST(COALESCE(lv.apy, lv.net_apy / NULLIF(1 - (lv.fee_bps::numeric/10000),0)), 1.0))::float8 AS bi,
        SUM(lv.tvl * LEAST(COALESCE(lv.apy, lv.net_apy / NULLIF(1 - (lv.fee_bps::numeric/10000),0)), 1.0) * (lv.fee_bps::numeric/10000))::float8 AS fees
      FROM lv LEFT JOIN morpho_.curators c ON c.id = lv.curator_id
      GROUP BY lv.curator_id, c.name ORDER BY aum DESC
    `) as { curator_id: string; name: string | null; vaults: number; aum: number; net_apy: number | null; bi: number; fees: number }[];
    return rows.map((r) => ({ curatorId: r.curator_id, curatorName: r.name ?? r.curator_id, vaultCount: r.vaults, aumInAssetUsd: r.aum, weightedNetApy: r.net_apy, feeTakeRate: r.bi > 0 ? r.fees / r.bi : null }));
  },
  [CACHE_VERSION, 'curators'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getAssetChainBreakdown = unstable_cache(
  async (symbol: string): Promise<AssetChainBreakdownRow[]> => {
    const sql = getDb();
    const rows = (await sql`
      SELECT ch.slug AS chain_slug, ch.name AS chain_name,
        COALESCE(SUM(s.supply_assets_usd) FILTER (WHERE UPPER(m.loan_asset_symbol) = UPPER(${symbol})), 0)::float8 AS supply,
        COALESCE(SUM(s.collateral_assets_usd) FILTER (WHERE UPPER(m.collateral_asset_symbol) = UPPER(${symbol})), 0)::float8 AS collateral,
        COUNT(*) FILTER (WHERE UPPER(m.loan_asset_symbol) = UPPER(${symbol}) OR UPPER(m.collateral_asset_symbol) = UPPER(${symbol}))::int AS markets,
        COALESCE(SUM(s.borrow_assets_usd * LEAST(s.borrow_apy, 1.0)) FILTER (WHERE UPPER(m.loan_asset_symbol) = UPPER(${symbol})), 0)::float8 AS bi
      FROM morpho_.markets m
      JOIN LATERAL (SELECT * FROM morpho_.market_state_daily x WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1) s ON TRUE
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0) AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0) AND (UPPER(m.loan_asset_symbol) = UPPER(${symbol}) OR UPPER(m.collateral_asset_symbol) = UPPER(${symbol}))
      GROUP BY ch.slug, ch.name
      ORDER BY (COALESCE(SUM(s.supply_assets_usd) FILTER (WHERE UPPER(m.loan_asset_symbol) = UPPER(${symbol})), 0)
              + COALESCE(SUM(s.collateral_assets_usd) FILTER (WHERE UPPER(m.collateral_asset_symbol) = UPPER(${symbol})), 0)) DESC
    `) as { chain_slug: string; chain_name: string; supply: number; collateral: number; markets: number; bi: number }[];
    return rows.map((r, i) => ({ chainSlug: r.chain_slug, chainName: r.chain_name, supplyUsd: r.supply, collateralUsd: r.collateral, marketCount: r.markets, borrowInterestGen: r.bi, rankOnChain: i + 1 }));
  },
  [CACHE_VERSION, 'chain-breakdown'],
  { revalidate: TTL, tags: ['assets'] },
);

export const getAssetWeeklyFlows = unstable_cache(
  async (symbol: string, weeks = 13): Promise<{ chains: string[]; points: AssetWeeklyFlowPoint[] }> => {
    const sql = getDb();
    const days = (weeks + 1) * 7;
    const rows = (await sql`
      SELECT s.snapshot_date::text AS date, ch.slug AS chain_slug,
        SUM(s.supply_assets_usd)::float8 AS supply
      FROM morpho_.market_state_daily s
      JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE UPPER(m.loan_asset_symbol) = UPPER(${symbol})
        AND s.snapshot_date >= CURRENT_DATE - (${days} * INTERVAL '1 day')
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0) AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      GROUP BY s.snapshot_date, ch.slug ORDER BY s.snapshot_date ASC
    `) as { date: string; chain_slug: string; supply: number }[];
    // bucket to last obs per ISO week, per chain
    const byChainWeek = new Map<string, Map<string, number>>(); // chain → week → supply
    const chainSet = new Set<string>();
    for (const r of rows) {
      chainSet.add(r.chain_slug);
      const d = new Date(r.date + 'T00:00:00Z');
      const day = (d.getUTCDay() + 6) % 7;
      const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - day);
      const wk = monday.toISOString().slice(0, 10);
      if (!byChainWeek.has(r.chain_slug)) byChainWeek.set(r.chain_slug, new Map());
      byChainWeek.get(r.chain_slug)!.set(wk, r.supply);
    }
    const allWeeks = [...new Set([...byChainWeek.values()].flatMap((m) => [...m.keys()]))].sort();
    const chains = [...chainSet];
    const points: AssetWeeklyFlowPoint[] = [];
    for (let i = 1; i < allWeeks.length; i++) {
      const wk = allWeeks[i]!, prev = allWeeks[i - 1]!;
      const p: AssetWeeklyFlowPoint = { weekStart: wk };
      for (const ch of chains) {
        const cur = byChainWeek.get(ch)?.get(wk) ?? byChainWeek.get(ch)?.get(prev) ?? 0;
        const old = byChainWeek.get(ch)?.get(prev) ?? cur;
        p[ch] = cur - old;
      }
      points.push(p);
    }
    return { chains, points: points.slice(-weeks) };
  },
  [CACHE_VERSION, 'weekly-flows'],
  { revalidate: TTL, tags: ['assets'] },
);
