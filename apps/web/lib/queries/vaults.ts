// Vault directory queries.
//
// Caching strategy: cache the full unfiltered row set (one network roundtrip,
// ~500 rows × ~10 columns < 100KB). Filter / sort / paginate happen in memory
// after the cache hit, so the cache key stays small.

import { unstable_cache } from 'next/cache';

import { getDb } from '../db.js';

const CACHE_VERSION = 'vaults-dir-v2';
const TTL = 900;

// ---------- Public types ----------

export interface VaultRow {
  chainId: number;
  chainSlug: string | null;
  chainName: string | null;
  address: string;
  name: string | null;
  symbol: string | null;
  assetSymbol: string | null;
  assetCategory: string;       // stablecoin / lst / lrt / btc / eth / rwa / other
  curatorId: string | null;
  curatorName: string | null;
  tvlUsd: number;
  tvl30dAgoUsd: number | null;
  netApy: number | null;
  feeBps: number | null;
  utilization: number | null;  // null until vault_allocations_daily backfills
  createdAt: string | null;     // ISO
}

export interface VaultsKpis {
  totalTvlUsd: number;
  activeVaultCount: number;
  weightedNetApy: number | null;
  topVaultTvlUsd: number;
  topVaultName: string | null;
  launched30d: number;
  chainCount: number;
  asOfDate: string | null;
}

export interface TopVaultBar {
  name: string;
  chainSlug: string | null;
  tvlUsd: number;
  netApy: number | null;
}

export interface TvlHistogramBucket {
  bucketLabel: string;
  bucketLow: number;       // USD lower bound
  bucketHigh: number | null;
  vaultCount: number;
  totalUsd: number;
}

export type VaultSortKey =
  | 'tvl' | 'netApy' | 'fee' | 'tvl30d' | 'utilization'
  | 'name' | 'chain' | 'curator' | 'asset';

export interface VaultsDirectoryFilters {
  chain?: string[];               // chain slugs
  assetClass?: string[];          // stablecoin/lst/...
  curator?: string[];             // curator ids
  minTvl?: number;
  search?: string;
}

export interface VaultsDirectorySort {
  key: VaultSortKey;
  dir: 'asc' | 'desc';
}

export interface VaultsDirectoryResult {
  rows: VaultRow[];
  totalRows: number;
  pageCount: number;
}

// Shared inline CASE — mirrors lib/queries/assets.ts so categorization is
// consistent across the dashboard.
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

// ---------- Base query (cached) ----------

// Returns every vault with its latest state-day row + 30-day-ago lookback.
const getAllVaults = unstable_cache(
  async (): Promise<VaultRow[]> => {
    const sql = getDb();
    const rows = (await sql(
      `
      WITH latest AS (
        SELECT DISTINCT ON (chain_id, vault_address)
          chain_id, vault_address, total_assets_usd, net_apy, fee_bps, snapshot_date
        FROM morpho_.vault_state_daily
        ORDER BY chain_id, vault_address, snapshot_date DESC
      ),
      ago AS (
        SELECT DISTINCT ON (chain_id, vault_address)
          chain_id, vault_address, total_assets_usd
        FROM morpho_.vault_state_daily
        WHERE snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY chain_id, vault_address, snapshot_date DESC
      )
      SELECT
        v.chain_id,
        ch.slug                AS chain_slug,
        ch.name                AS chain_name,
        v.address,
        v.name,
        v.symbol,
        v.asset_symbol,
        ${ASSET_CASE('v.asset_symbol')} AS asset_category,
        v.curator_id,
        cu.name                AS curator_name,
        v.performance_fee_bps  AS fee_bps,
        l.total_assets_usd::float8 AS tvl,
        l.net_apy::float8          AS net_apy,
        a.total_assets_usd::float8 AS tvl_30d,
        v.created_at
      FROM morpho_.vaults v
      LEFT JOIN morpho_.chains ch ON ch.chain_id = v.chain_id
      LEFT JOIN morpho_.curators cu ON cu.id = v.curator_id
      LEFT JOIN latest l ON l.chain_id = v.chain_id AND l.vault_address = v.address
      LEFT JOIN ago a    ON a.chain_id = v.chain_id AND a.vault_address = v.address
      `,
      [],
    )) as {
      chain_id: number; chain_slug: string | null; chain_name: string | null;
      address: string; name: string | null; symbol: string | null;
      asset_symbol: string | null; asset_category: string;
      curator_id: string | null; curator_name: string | null;
      fee_bps: number | null;
      tvl: number | null; net_apy: number | null; tvl_30d: number | null;
      created_at: Date | string | null;
    }[];

    return rows.map((r) => ({
      chainId: r.chain_id,
      chainSlug: r.chain_slug,
      chainName: r.chain_name,
      address: r.address,
      name: r.name,
      symbol: r.symbol,
      assetSymbol: r.asset_symbol,
      assetCategory: r.asset_category,
      curatorId: r.curator_id,
      curatorName: r.curator_name,
      tvlUsd: r.tvl ?? 0,
      tvl30dAgoUsd: r.tvl_30d,
      // Same 100% APY clamp as /rates and /markets: vault.net_apy derives from
      // underlying market APYs, so saturated-util markets (BONDUSD, K/USDC,
      // HERMES family) bleed multi-hundred-percent rates into the vault numbers.
      // Anything >= 100% APY is treated as a data artifact and nulled.
      netApy: r.net_apy != null && r.net_apy < 1.0 ? r.net_apy : null,
      feeBps: r.fee_bps,
      utilization: null,        // vault_allocations_daily not backfilled
      createdAt: r.created_at
        ? (typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString())
        : null,
    }));
  },
  [CACHE_VERSION, 'all-vaults'],
  { revalidate: TTL, tags: ['vaults'] },
);

// ---------- In-memory filter / sort / paginate ----------

export const PAGE_SIZE = 50;

const sortRows = (rows: VaultRow[], sort: VaultsDirectorySort): VaultRow[] => {
  const m = sort.dir === 'asc' ? 1 : -1;
  const cmp = (a: VaultRow, b: VaultRow): number => {
    const key = sort.key;
    const get = (r: VaultRow): string | number | null => {
      switch (key) {
        case 'tvl':         return r.tvlUsd;
        case 'netApy':      return r.netApy;
        case 'fee':         return r.feeBps;
        case 'utilization': return r.utilization;
        case 'tvl30d': {
          if (r.tvl30dAgoUsd == null || r.tvl30dAgoUsd === 0) return null;
          return (r.tvlUsd - r.tvl30dAgoUsd) / r.tvl30dAgoUsd;
        }
        case 'name':    return (r.name ?? r.symbol ?? '').toLowerCase();
        case 'chain':   return r.chainName?.toLowerCase() ?? '';
        case 'curator': return r.curatorName?.toLowerCase() ?? '';
        case 'asset':   return r.assetSymbol?.toLowerCase() ?? '';
      }
    };
    const av = get(a); const bv = get(b);
    // Nulls always sink to the bottom regardless of direction.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return -1 * m;
    if (av > bv) return 1 * m;
    return 0;
  };
  return [...rows].sort(cmp);
};

const filterRows = (rows: VaultRow[], f: VaultsDirectoryFilters): VaultRow[] => {
  let out = rows;
  if (f.chain && f.chain.length > 0) {
    const want = new Set(f.chain);
    out = out.filter((r) => r.chainSlug != null && want.has(r.chainSlug));
  }
  if (f.assetClass && f.assetClass.length > 0) {
    const want = new Set(f.assetClass);
    out = out.filter((r) => want.has(r.assetCategory));
  }
  if (f.curator && f.curator.length > 0) {
    const want = new Set(f.curator);
    out = out.filter((r) => r.curatorId != null && want.has(r.curatorId));
  }
  if (f.minTvl != null && f.minTvl > 0) {
    out = out.filter((r) => r.tvlUsd >= f.minTvl!);
  }
  if (f.search && f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    out = out.filter((r) =>
      (r.name?.toLowerCase().includes(q) ?? false) ||
      (r.symbol?.toLowerCase().includes(q) ?? false) ||
      (r.assetSymbol?.toLowerCase().includes(q) ?? false) ||
      r.address.toLowerCase().includes(q),
    );
  }
  return out;
};

export async function getVaultsDirectory(
  filters: VaultsDirectoryFilters,
  sort: VaultsDirectorySort,
  page: number,
): Promise<VaultsDirectoryResult> {
  const all = await getAllVaults();
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

// ---------- KPI strip / top-10 / histogram ----------

export const getVaultsKpis = unstable_cache(
  async (): Promise<VaultsKpis> => {
    const all = await getAllVaults();
    const live = all.filter((r) => r.tvlUsd > 0);
    const total = live.reduce((s, r) => s + r.tvlUsd, 0);
    const chains = new Set(live.map((r) => r.chainSlug ?? r.chainId));
    // Weighted (by TVL) net APY, ignoring nulls.
    const wPairs = live.filter((r) => r.netApy != null);
    const wTot = wPairs.reduce((s, r) => s + r.tvlUsd, 0);
    const wApy = wTot > 0
      ? wPairs.reduce((s, r) => s + (r.netApy ?? 0) * r.tvlUsd, 0) / wTot
      : null;
    const top = live.length > 0
      ? live.reduce((m, r) => (r.tvlUsd > m.tvlUsd ? r : m))
      : null;
    // Vaults launched in the last 30 days.
    const now = Date.now();
    const launched30d = all.filter((r) => {
      if (!r.createdAt) return false;
      return now - Date.parse(r.createdAt) <= 30 * 86_400_000;
    }).length;

    // Latest snapshot date drives the "as of" — pull from the underlying cache
    // by inspecting any non-zero TVL row's freshness is impossible client-side
    // so fall back to today.
    const today = new Date().toISOString().slice(0, 10);

    return {
      totalTvlUsd: total,
      activeVaultCount: live.length,
      weightedNetApy: wApy,
      topVaultTvlUsd: top?.tvlUsd ?? 0,
      topVaultName: top?.name ?? top?.symbol ?? null,
      launched30d,
      chainCount: chains.size,
      asOfDate: today,
    };
  },
  [CACHE_VERSION, 'kpis'],
  { revalidate: TTL, tags: ['vaults'] },
);

export const getVaultsTopTen = unstable_cache(
  async (): Promise<TopVaultBar[]> => {
    const all = await getAllVaults();
    return [...all]
      .filter((r) => r.tvlUsd > 0)
      .sort((a, b) => b.tvlUsd - a.tvlUsd)
      .slice(0, 10)
      .map((r) => ({
        name: r.name ?? r.symbol ?? r.address.slice(0, 8),
        chainSlug: r.chainSlug,
        tvlUsd: r.tvlUsd,
        netApy: r.netApy,
      }));
  },
  [CACHE_VERSION, 'top-ten'],
  { revalidate: TTL, tags: ['vaults'] },
);

// 8 log-scaled buckets from $100K → $1B+.
const TVL_BUCKETS: { low: number; high: number | null; label: string }[] = [
  { low: 0,           high: 100_000,     label: '<$100K' },
  { low: 100_000,     high: 1_000_000,   label: '$100K–$1M' },
  { low: 1_000_000,   high: 5_000_000,   label: '$1M–$5M' },
  { low: 5_000_000,   high: 25_000_000,  label: '$5M–$25M' },
  { low: 25_000_000,  high: 100_000_000, label: '$25M–$100M' },
  { low: 100_000_000, high: 250_000_000, label: '$100M–$250M' },
  { low: 250_000_000, high: 1_000_000_000, label: '$250M–$1B' },
  { low: 1_000_000_000, high: null,      label: '$1B+' },
];

export const getVaultsTvlHistogram = unstable_cache(
  async (): Promise<TvlHistogramBucket[]> => {
    const all = await getAllVaults();
    return TVL_BUCKETS.map((b) => {
      const inBucket = all.filter(
        (r) => r.tvlUsd >= b.low && (b.high == null || r.tvlUsd < b.high),
      );
      return {
        bucketLabel: b.label,
        bucketLow: b.low,
        bucketHigh: b.high,
        vaultCount: inBucket.length,
        totalUsd: inBucket.reduce((s, r) => s + r.tvlUsd, 0),
      };
    });
  },
  [CACHE_VERSION, 'tvl-hist'],
  { revalidate: TTL, tags: ['vaults'] },
);

// Options for the filter controls (computed from the cached base).
export const getVaultsFilterOptions = unstable_cache(
  async () => {
    const all = await getAllVaults();
    const chains = new Map<string, string>();
    const curators = new Map<string, string>();
    for (const r of all) {
      if (r.chainSlug) chains.set(r.chainSlug, r.chainName ?? r.chainSlug);
      if (r.curatorId) curators.set(r.curatorId, r.curatorName ?? r.curatorId);
    }
    return {
      chains: [...chains.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
      curators: [...curators.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    };
  },
  [CACHE_VERSION, 'filter-options'],
  { revalidate: TTL, tags: ['vaults'] },
);
