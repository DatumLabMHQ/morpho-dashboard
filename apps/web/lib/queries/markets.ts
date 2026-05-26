// Market directory queries.
//
// Same caching pattern as vaults: pull the unfiltered row set once, then
// filter/sort/paginate in memory. ~1000 markets × ~12 columns < 200KB,
// comfortably within Next's cache value limits.

import { unstable_cache } from 'next/cache';

import { getDb } from '../db.js';

const CACHE_VERSION = 'markets-dir-v2';
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
  borrowUsd: number;
  utilization: number | null;     // 0..1
  supplyApy: number | null;        // 0..1 (already clamped — see APY_SANE)
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
  totalSupplyUsd: number;
  totalBorrowUsd: number;
  medianLltv: number | null;
  weightedUtilization: number | null;
  chainCount: number;
  asOfDate: string | null;
}

export interface LltvBucket {
  bucketLabel: string;
  bucketLow: number;       // %
  bucketHigh: number;      // %
  marketCount: number;
  supplyUsd: number;       // share-of-supply weight
}

export type MarketSortKey =
  | 'supply' | 'borrow' | 'utilization' | 'supplyApy' | 'borrowApy'
  | 'lltv' | 'age' | 'chain' | 'loan' | 'collateral';

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
          market_unique_key, supply_assets_usd, borrow_assets_usd,
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
      supply: number | null; borrow: number | null;
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
      // Apply the same 100% APY clamp /rates uses — saturated-util IRM
      // blow-ups (BONDUSD/USR, K/USDC Arbitrum, HERMES/USDC, etc.) report
      // 418%–2980% APY which is data garbage, not a usable rate. Nulled here
      // so the table and KPI aggregates don't display nonsense.
      const apyClamped = r.supply_apy != null && r.supply_apy >= 1.0;
      const supplyApy = apyClamped || r.supply_apy == null ? null : r.supply_apy;
      const borrowApy =
        r.borrow_apy != null && r.borrow_apy < 1.0 ? r.borrow_apy : null;
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
        borrowUsd: r.borrow ?? 0,
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

export const PAGE_SIZE = 50;

const sortRows = (rows: MarketRow[], s: MarketsDirectorySort): MarketRow[] => {
  const m = s.dir === 'asc' ? 1 : -1;
  const get = (r: MarketRow): string | number | null => {
    switch (s.key) {
      case 'supply':      return r.supplyUsd;
      case 'borrow':      return r.borrowUsd;
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
    const lltvs = sane.map((r) => r.lltv).filter((x): x is number => x != null);
    // Utilization weighted by supply USD, ignoring null utilizations AND
    // clamped phantom markets (which all sit at 100% util).
    const wPairs = sane.filter((r) => r.utilization != null);
    const wTot = wPairs.reduce((s, r) => s + r.supplyUsd, 0);
    const wUtil = wTot > 0
      ? wPairs.reduce((s, r) => s + (r.utilization ?? 0) * r.supplyUsd, 0) / wTot
      : null;
    const chains = new Set(live.map((r) => r.chainSlug ?? r.chainId));
    return {
      activeMarketCount: live.length,
      totalSupplyUsd: totalSupply,
      totalBorrowUsd: totalBorrow,
      medianLltv: median(lltvs),
      weightedUtilization: wUtil,
      chainCount: chains.size,
      asOfDate: new Date().toISOString().slice(0, 10),
    };
  },
  [CACHE_VERSION, 'kpis'],
  { revalidate: TTL, tags: ['markets'] },
);

// LLTV distribution weighted by supply USD. 6 fixed buckets per the spec.
const LLTV_BUCKETS: { low: number; high: number; label: string }[] = [
  { low: 0,  high: 50, label: '0–50%' },
  { low: 50, high: 70, label: '50–70%' },
  { low: 70, high: 80, label: '70–80%' },
  { low: 80, high: 90, label: '80–90%' },
  { low: 90, high: 95, label: '90–95%' },
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
      return {
        bucketLabel: b.label,
        bucketLow: b.low,
        bucketHigh: b.high,
        marketCount: inBucket.length,
        supplyUsd: inBucket.reduce((s, r) => s + r.supplyUsd, 0),
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
