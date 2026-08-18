// Market directory queries.
//
// Same caching pattern as vaults: pull the unfiltered row set once, then
// filter/sort/paginate in memory. ~1000 markets × ~12 columns < 200KB,
// comfortably within Next's cache value limits.

import { unstable_cache } from 'next/cache';

import { getDb } from '../db.js';

const CACHE_VERSION = 'markets-dir-v3';
const TTL = 900;

// ---------- Public types ----------

export interface MarketRow {
  uniqueKey: string;
  chainId: number;
  chainSlug: string | null;
  chainName: string | null;
  loanSymbol: string;
  loanCategory: string;
  collateralSymbol: string | null;
  collateralCategory: string;
  lltv: number | null;            // 0..1
  supplyUsd: number;
  borrowUsd: number;              // active loans
  borrowInterest: number;          // borrowUsd × clamped borrow APY (annualized $)
  badDebtUsd: number;             // stored unrealized bad debt
  utilization: number | null;     // 0..1
  supplyApy: number | null;        // 0..1 (already clamped. See APY_SANE)
  borrowApy: number | null;        // 0..1
  ageDays: number | null;
  createdAt: string | null;
  /** True iff the original supply_apy was >= 100% (saturated-util IRM blow-up).
   *  These rows still appear in the table (we want them visible as risk
   *  signal) but are excluded from weighted-aggregate KPIs. */
  apyClamped: boolean;
}

export interface MarketsKpis {
  activeMarketCount: number;
  launched30d: number;
  totalSupplyUsd: number;
  totalBorrowUsd: number;          // total active loans
  totalBorrowInterest: number;     // annualized
  medianLltv: number | null;       // supply-weighted
  medianUtilization: number | null; // supply-weighted
  weightedUtilization: number | null;
  // Largest market by active loans
  largestMarketLabel: string | null;
  largestMarketChain: string | null;
  largestMarketActiveLoans: number;
  // Stress signals
  at90Count: number;
  at90SupplyUsd: number;
  badDebtCount: number;
  badDebtTotalUsd: number;
  chainCount: number;
  asOfDate: string | null;
}

export interface LltvBucket {
  bucketLabel: string;
  bucketLow: number;       // %
  bucketHigh: number;      // %
  marketCount: number;
  supplyUsd: number;       // share-of-supply weight
  dominantClass: string | null;   // collateral class with most supply in this bracket
}

export type MarketSortKey =
  | 'supply' | 'borrow' | 'borrowInterest' | 'utilization' | 'supplyApy' | 'borrowApy'
  | 'lltv' | 'age' | 'chain' | 'loan' | 'collateral';

export interface MarketScatterPoint {
  pair: string;          // "LOAN / COLLATERAL"
  util: number;          // 0..1
  borrowApy: number;     // 0..1
  supplyUsd: number;
  collateralClass: 'stablecoin' | 'lst' | 'lrt' | 'btc' | 'eth' | 'rwa' | 'other';
}

export interface TopMarketBar {
  label: string;         // "LOAN / COLLATERAL"
  chainSlug: string | null;
  chainName: string | null;
  activeLoans: number;
  utilization: number | null;
  collateralClass: string;
}

export interface RiskSurfaceRow {
  rank: number;
  label: string;
  chainName: string | null;
  supplyUsd: number;
  utilization: number | null;
  lltv: number | null;
  borrowApy: number | null;
  riskScore: number;     // supply × util × lltv
  badDebtUsd: number;
}
export interface RiskSurface {
  rows: RiskSurfaceRow[];
  largestRiskMarket: string | null;
  largestRiskPct: number | null;     // top market's share of top-N risk score
  topChain: string | null;
  topChainCount: number;
}

export interface MarketLaunch {
  date: string;
  loanSymbol: string;
  collateralSymbol: string | null;
  lltv: number | null;
  chainSlug: string | null;
  chainName: string | null;
  initialSupplyUsd: number | null;
}

export interface MarketsDirectoryFilters {
  chain?: string[];
  loanAssetClass?: string[];
  collateralAssetClass?: string[];
  minSupply?: number;
  lltvRange?: [number | null, number | null];   // % inclusive
  utilRange?: [number | null, number | null];   // % inclusive
  search?: string;
}

export interface MarketsDirectorySort {
  key: MarketSortKey;
  dir: 'asc' | 'desc';
}

export interface MarketsDirectoryResult {
  rows: MarketRow[];
  totalRows: number;
  pageCount: number;
}

const ASSET_CASE = (col: string) => `
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
          OR UPPER(${col}) LIKE 'PT-TBTC%' OR UPPER(${col}) LIKE 'PT-EBTC%' THEN 'btc'
        ELSE 'other'
      END
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

// ---------- Base query (cached) ----------

const getAllMarkets = unstable_cache(
  async (): Promise<MarketRow[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, borrow_assets_usd, bad_debt_assets_usd,
          utilization, supply_apy, borrow_apy, snapshot_date
        FROM morpho_.market_state_daily
        ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        m.unique_key,
        m.chain_id,
        ch.slug                                                AS chain_slug,
        ch.name                                                AS chain_name,
        m.loan_asset_symbol                                    AS loan,
        ${ASSET_CASE('m.loan_asset_symbol')}                   AS loan_cat,
        m.collateral_asset_symbol                              AS collateral,
        ${ASSET_CASE('m.collateral_asset_symbol')}             AS coll_cat,
        m.lltv::float8                                         AS lltv,
        l.supply_assets_usd::float8                            AS supply,
        l.borrow_assets_usd::float8                            AS borrow,
        l.bad_debt_assets_usd::float8                          AS bad_debt,
        l.utilization::float8                                  AS util,
        l.supply_apy::float8                                   AS supply_apy,
        l.borrow_apy::float8                                   AS borrow_apy,
        m.created_at
      FROM morpho_.markets m
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      LEFT JOIN latest l ON l.market_unique_key = m.unique_key
      `,
      [],
    )) as {
      unique_key: string; chain_id: number; chain_slug: string | null; chain_name: string | null;
      loan: string; loan_cat: string;
      collateral: string | null; coll_cat: string;
      lltv: number | null;
      supply: number | null; borrow: number | null; bad_debt: number | null;
      util: number | null; supply_apy: number | null; borrow_apy: number | null;
      created_at: Date | string | null;
    }[];

    const now = Date.now();
    return rows.map((r) => {
      const createdAt = r.created_at
        ? (typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString())
        : null;
      const ageDays = createdAt
        ? Math.max(0, Math.floor((now - Date.parse(createdAt)) / 86_400_000))
        : null;
      // Apply the same 100% APY clamp /rates uses. Saturated-util IRM
      // blow-ups (BONDUSD/USR, K/USDC Arbitrum, HERMES/USDC, etc.) report
      // 418%-2980% APY which is data garbage, not a usable rate. Nulled here
      // so the table and KPI aggregates don't display nonsense.
      const apyClamped = r.supply_apy != null && r.supply_apy >= 1.0;
      const supplyApy = apyClamped || r.supply_apy == null ? null : r.supply_apy;
      const borrowApy =
        r.borrow_apy != null && r.borrow_apy < 1.0 ? r.borrow_apy : null;
      const borrowUsd = r.borrow ?? 0;
      return {
        uniqueKey: r.unique_key,
        chainId: r.chain_id,
        chainSlug: r.chain_slug,
        chainName: r.chain_name,
        loanSymbol: r.loan,
        loanCategory: r.loan_cat,
        collateralSymbol: r.collateral,
        collateralCategory: r.coll_cat,
        lltv: r.lltv,
        supplyUsd: r.supply ?? 0,
        borrowUsd,
        borrowInterest: borrowApy != null ? borrowUsd * borrowApy : 0,
        badDebtUsd: r.bad_debt ?? 0,
        utilization: r.util,
        supplyApy,
        borrowApy,
        ageDays,
        createdAt,
        apyClamped,
      };
    });
  },
  [CACHE_VERSION, 'all-markets'],
  { revalidate: TTL, tags: ['markets'] },
);

// ---------- Filter / sort / paginate ----------

export const PAGE_SIZE = 15;

const sortRows = (rows: MarketRow[], s: MarketsDirectorySort): MarketRow[] => {
  const m = s.dir === 'asc' ? 1 : -1;
  const get = (r: MarketRow): string | number | null => {
    switch (s.key) {
      case 'supply':      return r.supplyUsd;
      case 'borrow':      return r.borrowUsd;
      case 'borrowInterest': return r.borrowInterest;
      case 'utilization': return r.utilization;
      case 'supplyApy':   return r.supplyApy;
      case 'borrowApy':   return r.borrowApy;
      case 'lltv':        return r.lltv;
      case 'age':         return r.ageDays;
      case 'chain':       return r.chainName?.toLowerCase() ?? '';
      case 'loan':        return r.loanSymbol.toLowerCase();
      case 'collateral':  return r.collateralSymbol?.toLowerCase() ?? '';
    }
  };
  return [...rows].sort((a, b) => {
    const av = get(a); const bv = get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -1 * m;
    if (av > bv) return 1 * m;
    return 0;
  });
};

const filterRows = (rows: MarketRow[], f: MarketsDirectoryFilters): MarketRow[] => {
  let out = rows;
  if (f.chain && f.chain.length > 0) {
    const want = new Set(f.chain);
    out = out.filter((r) => r.chainSlug != null && want.has(r.chainSlug));
  }
  if (f.loanAssetClass && f.loanAssetClass.length > 0) {
    const want = new Set(f.loanAssetClass);
    out = out.filter((r) => want.has(r.loanCategory));
  }
  if (f.collateralAssetClass && f.collateralAssetClass.length > 0) {
    const want = new Set(f.collateralAssetClass);
    out = out.filter((r) => want.has(r.collateralCategory));
  }
  if (f.minSupply != null && f.minSupply > 0) {
    out = out.filter((r) => r.supplyUsd >= f.minSupply!);
  }
  if (f.lltvRange) {
    const [lo, hi] = f.lltvRange;
    out = out.filter((r) => {
      if (r.lltv == null) return false;
      const pct = r.lltv * 100;
      if (lo != null && pct < lo) return false;
      if (hi != null && pct > hi) return false;
      return true;
    });
  }
  if (f.utilRange) {
    const [lo, hi] = f.utilRange;
    out = out.filter((r) => {
      if (r.utilization == null) return false;
      const pct = r.utilization * 100;
      if (lo != null && pct < lo) return false;
      if (hi != null && pct > hi) return false;
      return true;
    });
  }
  if (f.search && f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    out = out.filter((r) =>
      r.loanSymbol.toLowerCase().includes(q) ||
      (r.collateralSymbol?.toLowerCase().includes(q) ?? false) ||
      r.uniqueKey.toLowerCase().includes(q),
    );
  }
  return out;
};

export async function getMarketsDirectory(
  filters: MarketsDirectoryFilters,
  sort: MarketsDirectorySort,
  page: number,
): Promise<MarketsDirectoryResult> {
  const all = await getAllMarkets();
  const filtered = filterRows(all, filters);
  const sorted = sortRows(filtered, sort);
  const totalRows = sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  return {
    rows: sorted.slice(start, start + PAGE_SIZE),
    totalRows,
    pageCount,
  };
}

// ---------- KPIs + LLTV histogram ----------

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

// Supply-USD-weighted median: the value at which cumulative weight crosses 50%.
const weightedMedian = (pairs: { value: number; weight: number }[]): number | null => {
  const valid = pairs.filter((p) => p.weight > 0).sort((a, b) => a.value - b.value);
  const total = valid.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return null;
  let cum = 0;
  for (const p of valid) {
    cum += p.weight;
    if (cum >= total / 2) return p.value;
  }
  return valid[valid.length - 1]?.value ?? null;
};

export const getMarketsKpis = unstable_cache(
  async (): Promise<MarketsKpis> => {
    const all = await getAllMarkets();
    // "Active" = non-null supply > 0 OR borrow > 0 (basically any live market).
    const live = all.filter((r) => r.supplyUsd > 0 || r.borrowUsd > 0);
    // For supply/borrow totals: exclude APY-clamped phantom markets (BONDUSD,
    // K/USDC Arbitrum, PAXG/USDC, sdeUSD/USDC, HERMES/USDC family). Including
    // them inflates "total supply" by ~$5B of essentially-stuck capital that
    // isn't real productive lending.
    const sane = live.filter((r) => !r.apyClamped);
    const totalSupply = sane.reduce((s, r) => s + r.supplyUsd, 0);
    const totalBorrow = sane.reduce((s, r) => s + r.borrowUsd, 0);
    const totalBorrowInterest = sane.reduce((s, r) => s + r.borrowInterest, 0);
    // Utilization weighted by supply USD, ignoring null utilizations AND
    // clamped phantom markets (which all sit at 100% util).
    const wPairs = sane.filter((r) => r.utilization != null);
    const wTot = wPairs.reduce((s, r) => s + r.supplyUsd, 0);
    const wUtil = wTot > 0
      ? wPairs.reduce((s, r) => s + (r.utilization ?? 0) * r.supplyUsd, 0) / wTot
      : null;
    // Supply-weighted medians.
    const medLltv = weightedMedian(
      sane.filter((r) => r.lltv != null).map((r) => ({ value: r.lltv!, weight: r.supplyUsd })),
    );
    const medUtil = weightedMedian(
      wPairs.map((r) => ({ value: r.utilization!, weight: r.supplyUsd })),
    );
    // Largest market by active loans.
    const largest = sane.length > 0 ? sane.reduce((m, r) => (r.borrowUsd > m.borrowUsd ? r : m)) : null;
    // Stress: util ≥ 90%.
    const at90 = sane.filter((r) => r.utilization != null && r.utilization >= 0.9);
    // Bad debt (across all live markets, not just sane. Bad debt is real exposure).
    const withBadDebt = live.filter((r) => r.badDebtUsd > 1000);
    const now = Date.now();
    const launched30d = all.filter((r) => r.createdAt && now - Date.parse(r.createdAt) <= 30 * 86_400_000).length;
    const chains = new Set(live.map((r) => r.chainSlug ?? r.chainId));
    return {
      activeMarketCount: live.length,
      launched30d,
      totalSupplyUsd: totalSupply,
      totalBorrowUsd: totalBorrow,
      totalBorrowInterest,
      medianLltv: medLltv,
      medianUtilization: medUtil,
      weightedUtilization: wUtil,
      largestMarketLabel: largest ? `${largest.loanSymbol} / ${largest.collateralSymbol ?? 'N/A'}` : null,
      largestMarketChain: largest?.chainName ?? largest?.chainSlug ?? null,
      largestMarketActiveLoans: largest?.borrowUsd ?? 0,
      at90Count: at90.length,
      at90SupplyUsd: at90.reduce((s, r) => s + r.supplyUsd, 0),
      badDebtCount: withBadDebt.length,
      badDebtTotalUsd: withBadDebt.reduce((s, r) => s + r.badDebtUsd, 0),
      chainCount: chains.size,
      asOfDate: new Date().toISOString().slice(0, 10),
    };
  },
  [CACHE_VERSION, 'kpis'],
  { revalidate: TTL, tags: ['markets'] },
);

// LLTV distribution weighted by supply USD. 6 fixed buckets per the spec.
const LLTV_BUCKETS: { low: number; high: number; label: string }[] = [
  { low: 0,  high: 50, label: '0-50%' },
  { low: 50, high: 70, label: '50-70%' },
  { low: 70, high: 80, label: '70-80%' },
  { low: 80, high: 90, label: '80-90%' },
  { low: 90, high: 95, label: '90-95%' },
  { low: 95, high: 101, label: '95%+' },   // 101 keeps lltv=1.0 in bucket
];

export const getLltvHistogram = unstable_cache(
  async (): Promise<LltvBucket[]> => {
    const all = await getAllMarkets();
    // Exclude APY-clamped phantom markets so the weighted histogram reflects
    // where real supply actually sits (consistent with getMarketsKpis).
    const sane = all.filter((r) => !r.apyClamped);
    return LLTV_BUCKETS.map((b) => {
      const inBucket = sane.filter((r) => {
        if (r.lltv == null) return false;
        const pct = r.lltv * 100;
        return pct >= b.low && pct < b.high;
      });
      // Dominant collateral class by supply USD within this bracket.
      const byClass = new Map<string, number>();
      for (const r of inBucket) byClass.set(r.collateralCategory, (byClass.get(r.collateralCategory) ?? 0) + r.supplyUsd);
      const dominant = [...byClass.entries()].sort((a, b2) => b2[1] - a[1])[0]?.[0] ?? null;
      return {
        bucketLabel: b.label,
        bucketLow: b.low,
        bucketHigh: b.high,
        marketCount: inBucket.length,
        supplyUsd: inBucket.reduce((s, r) => s + r.supplyUsd, 0),
        dominantClass: dominant,
      };
    });
  },
  [CACHE_VERSION, 'lltv-hist'],
  { revalidate: TTL, tags: ['markets'] },
);

export const getMarketsFilterOptions = unstable_cache(
  async () => {
    const all = await getAllMarkets();
    const chains = new Map<string, string>();
    for (const r of all) {
      if (r.chainSlug) chains.set(r.chainSlug, r.chainName ?? r.chainSlug);
    }
    return {
      chains: [...chains.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    };
  },
  [CACHE_VERSION, 'filter-options'],
  { revalidate: TTL, tags: ['markets'] },
);

// ---------- Top 10 by active loans ----------

export const getMarketsTopTenByActiveLoans = unstable_cache(
  async (): Promise<TopMarketBar[]> => {
    const all = await getAllMarkets();
    return all
      .filter((r) => !r.apyClamped && r.borrowUsd > 0)
      .sort((a, b) => b.borrowUsd - a.borrowUsd)
      .slice(0, 10)
      .map((r) => ({
        label: `${r.loanSymbol} / ${r.collateralSymbol ?? 'N/A'}`,
        chainSlug: r.chainSlug,
        chainName: r.chainName,
        activeLoans: r.borrowUsd,
        utilization: r.utilization,
        collateralClass: r.collateralCategory,
      }));
  },
  [CACHE_VERSION, 'top-ten-loans'],
  { revalidate: TTL, tags: ['markets'] },
);

// ---------- Utilization × borrow APY scatter ----------

export const getMarketsScatterData = unstable_cache(
  async (): Promise<MarketScatterPoint[]> => {
    const all = await getAllMarkets();
    return all
      .filter((r) => !r.apyClamped && r.borrowApy != null && r.utilization != null && r.supplyUsd > 0)
      .map((r) => ({
        pair: `${r.loanSymbol} / ${r.collateralSymbol ?? 'N/A'}`,
        util: r.utilization!,
        borrowApy: r.borrowApy!,
        supplyUsd: r.supplyUsd,
        collateralClass: r.collateralCategory as MarketScatterPoint['collateralClass'],
      }));
  },
  [CACHE_VERSION, 'scatter'],
  { revalidate: TTL, tags: ['markets'] },
);

// ---------- Risk surface (blast radius = supply × util × LLTV) ----------

export const getMarketsRiskSurface = unstable_cache(
  async (limit = 20): Promise<RiskSurface> => {
    const all = await getAllMarkets();
    const scored = all
      .filter((r) => !r.apyClamped && r.supplyUsd > 0 && r.utilization != null && r.lltv != null)
      .map((r) => ({
        r,
        score: r.supplyUsd * (r.utilization ?? 0) * (r.lltv ?? 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const rows: RiskSurfaceRow[] = scored.map((s, i) => ({
      rank: i + 1,
      label: `${s.r.loanSymbol} / ${s.r.collateralSymbol ?? 'N/A'}`,
      chainName: s.r.chainName ?? s.r.chainSlug ?? null,
      supplyUsd: s.r.supplyUsd,
      utilization: s.r.utilization,
      lltv: s.r.lltv,
      borrowApy: s.r.borrowApy,
      riskScore: s.score,
      badDebtUsd: s.r.badDebtUsd,
    }));
    const totalScore = rows.reduce((s, r) => s + r.riskScore, 0);
    // Top chain among the top-N.
    const byChain = new Map<string, number>();
    for (const r of rows) {
      const k = r.chainName ?? 'N/A';
      byChain.set(k, (byChain.get(k) ?? 0) + 1);
    }
    const topChainEntry = [...byChain.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    return {
      rows,
      largestRiskMarket: rows[0]?.label ?? null,
      largestRiskPct: totalScore > 0 && rows[0] ? rows[0].riskScore / totalScore : null,
      topChain: topChainEntry?.[0] ?? null,
      topChainCount: topChainEntry?.[1] ?? 0,
    };
  },
  [CACHE_VERSION, 'risk-surface'],
  { revalidate: TTL, tags: ['markets'] },
);

// ---------- Recent market launches ----------

export const getRecentMarketLaunches = unstable_cache(
  async (days = 30): Promise<MarketLaunch[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH first_state AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd
        FROM morpho_.market_state_daily
        ORDER BY market_unique_key, snapshot_date ASC
      )
      SELECT
        m.loan_asset_symbol AS loan, m.collateral_asset_symbol AS collateral,
        m.lltv::float8 AS lltv, ch.slug AS chain_slug, ch.name AS chain_name,
        m.created_at, fs.supply_assets_usd::float8 AS initial_supply
      FROM morpho_.markets m
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      LEFT JOIN first_state fs ON fs.market_unique_key = m.unique_key
      WHERE m.created_at IS NOT NULL
        AND m.created_at >= NOW() - ($1::int || ' days')::interval
      ORDER BY m.created_at DESC
      LIMIT 10
      `,
      [days],
    )) as {
      loan: string; collateral: string | null; lltv: number | null;
      chain_slug: string | null; chain_name: string | null;
      created_at: Date | string; initial_supply: number | null;
    }[];
    return rows.map((r) => ({
      date: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
      loanSymbol: r.loan,
      collateralSymbol: r.collateral,
      lltv: r.lltv,
      chainSlug: r.chain_slug,
      chainName: r.chain_name,
      initialSupplyUsd: r.initial_supply,
    }));
  },
  [CACHE_VERSION, 'recent-launches'],
  { revalidate: TTL, tags: ['markets'] },
);
