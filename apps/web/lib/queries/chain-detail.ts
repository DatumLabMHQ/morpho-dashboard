// Per-chain detail page queries. All read from Neon only. No external API
// calls at render time. Each function cached via unstable_cache(900).

import { unstable_cache } from 'next/cache';

import { categorizeAsset } from '../assets/asset-class.js';
import { tokens } from '../brand/tokens.js';
import { getDb } from '../db.js';

const CACHE_VERSION = 'chain-detail-v6';
const TTL = 900;

// Network classification. Small inline map; the chains table doesn't carry
// L1/L2/rollup metadata. Fall back to "EVM CHAIN".
const NETWORK_LABELS: Record<string, string> = {
  Ethereum: 'Ethereum L1',
  Base: 'OP Stack L2',
  Arbitrum: 'Optimistic Rollup',
  Optimism: 'OP Stack L2',
  Polygon: 'Polygon PoS',
  Unichain: 'OP Stack L2',
  'World Chain': 'OP Stack L2',
  Scroll: 'ZK Rollup',
  Fraxtal: 'OP Stack L2',
  Ink: 'OP Stack L2',
  Mode: 'OP Stack L2',
  Sonic: 'Sonic L1',
  Plume: 'Plume L1',
  Katana: 'Polygon CDK',
  'Hyperliquid L1': 'Hyperliquid L1',
  Lisk: 'OP Stack L2',
  Etherlink: 'Tezos L2',
  Plasma: 'Plasma L1',
  Monad: 'Monad L1',
  Linea: 'ZK Rollup',
  Soneium: 'OP Stack L2',
  Sei: 'Sei L1',
  Flare: 'Flare L1',
};

// Fold raw (symbol, valueUsd) rows into per-category slices with a top symbol.
function aggregateMix(rows: { symbol: string | null; value_usd: number | null }[]): AssetMixSlice[] {
  const byCat = new Map<string, number>();
  const bySym = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const v = r.value_usd;
    if (v == null || v <= 0) continue;
    const cat = categorizeAsset(r.symbol);
    byCat.set(cat, (byCat.get(cat) ?? 0) + v);
    if (!bySym.has(cat)) bySym.set(cat, new Map());
    const m = bySym.get(cat)!;
    const sym = r.symbol ?? 'N/A';
    m.set(sym, (m.get(sym) ?? 0) + v);
  }
  return [...byCat.entries()]
    .map(([category, supplyUsd]) => {
      let topSymbol: string | null = null;
      let topSymbolUsd = 0;
      for (const [sym, usd] of bySym.get(category) ?? []) {
        if (usd > topSymbolUsd) { topSymbolUsd = usd; topSymbol = sym; }
      }
      return { category, supplyUsd, topSymbol, topSymbolUsd };
    })
    .sort((a, b) => b.supplyUsd - a.supplyUsd);
}

// ---------- Shape ----------

export interface ChainHeader {
  chainSlug: string;
  chainName: string;
  networkLabel: string;
  morphoLiveSince: string | null;  // ISO month e.g. "2024-06"
  morphoRank: number | null;
  totalProtocolsOnChain: number;
}

export interface ChainKpis {
  // Loan-book-first metrics (lead with these).
  activeLoansUsd: number;
  activeLoans30dAgoUsd: number | null;
  activeLoans30dDeltaPct: number | null;
  borrowInterestUsd: number;        // annualized
  nim: number | null;               // weighted borrow APY − weighted supply APY
  utilization: number | null;       // active loans ÷ total deposits
  totalDepositsUsd: number;
  totalSupplyUsd: number;
  // Sector-compat (TVL/share). De-emphasized.
  morphoTvlUsd: number;
  morphoTvl30dAgoUsd: number | null;
  morphoSharePct: number;
  morphoShare30dAgoPct: number | null;
  marketCount: number;
  vaultCount: number;
  curatorCount: number;
  asOfDate: string;
}

export interface TvlSharePoint {
  date: string;
  activeLoansUsd: number | null;     // Σ borrow_assets_usd on the chain that day
  morphoTvlUsd: number | null;
  chainLendingTvlUsd: number | null;
  morphoSharePct: number | null;
}

export interface CompetitorPoint {
  date: string;
  // dynamic per-slug keys → tvl_usd
  [slug: string]: string | number | null;
}

export interface CompetitorMeta {
  protocolSlug: string;
  name: string;
  color: string;
  isMorpho: boolean;
}

export interface MarketRow {
  uniqueKey: string;
  collateralSymbol: string | null;
  loanSymbol: string;
  lltvPct: number | null;
  supplyUsd: number;
  borrowUsd: number;
  utilization: number | null;
  supplyApy: number | null;
  borrowApy: number | null;
}

export interface VaultRow {
  chainId: number;
  address: string;
  name: string | null;
  curatorName: string | null;
  assetSymbol: string | null;
  tvlUsd: number;
  netApy: number | null;
  feeBps: number | null;
  delta30dTvlUsd: number | null;
  curatorFees30dUsd: number | null;   // 30-day curator fee accrual
}

export interface CuratorRow {
  curatorId: string;
  curatorName: string | null;
  vaultCount: number;
  tvlOnChainUsd: number;
  weightedNetApy: number | null;
  globalTvlUsd: number;
  curatorFeesAnnualUsd: number;   // annualized fees this curator earns on this chain
}

export interface AssetMixSlice {
  category: string;          // stablecoin / lst / lrt / btc / eth / rwa / other
  supplyUsd: number;         // USD value of this slice (loan-side or collateral-side)
  topSymbol: string | null;
  topSymbolUsd: number;
}

export interface ChainAssetMixResult {
  supply: AssetMixSlice[];      // by loan asset. What Morpho lends out on this chain
  collateral: AssetMixSlice[];  // by collateral asset. What backs those loans
}

// ---------- Helpers ----------

async function resolveChain(slug: string) {
  const sql = getDb();
  const rows = (await sql`
    SELECT chain_id, slug, name
    FROM morpho_.chains
    WHERE LOWER(slug) = LOWER(${slug})
    LIMIT 1
  `) as { chain_id: number; slug: string; name: string }[];
  return rows[0] ?? null;
}

// ---------- Queries ----------

export const getChainHeader = unstable_cache(
  async (slug: string): Promise<ChainHeader | null> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return null;

    // Deployment date = first day Morpho had >0 TVL on this chain
    const liveRows = (await sql`
      SELECT MIN(snapshot_date)::text AS d
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = 'morpho-blue'
        AND chain_slug    = ${chain.slug}
        AND tvl_usd > 0
    `) as { d: string | null }[];
    const liveDay = liveRows[0]?.d ?? null;
    const morphoLiveSince = liveDay ? liveDay.slice(0, 7) : null;

    // Rank: position of morpho-blue by TVL on latest day
    const rankRows = (await sql`
      WITH latest_day AS (
        SELECT MAX(snapshot_date) AS d
        FROM morpho_.protocol_tvl_daily WHERE chain_slug = ${chain.slug}
      ),
      ranked AS (
        SELECT t.protocol_slug, t.tvl_usd,
               RANK() OVER (ORDER BY t.tvl_usd DESC) AS rnk
        FROM morpho_.protocol_tvl_daily t
        JOIN morpho_.defillama_protocols_snapshot s USING (protocol_slug)
        WHERE t.chain_slug = ${chain.slug}
          AND t.snapshot_date = (SELECT d FROM latest_day)
          AND s.category IN ('Lending','CDP')
          AND t.tvl_usd > 0
      )
      SELECT
        (SELECT rnk::int FROM ranked WHERE protocol_slug = 'morpho-blue') AS morpho_rank,
        (SELECT COUNT(*)::int FROM ranked) AS total
    `) as { morpho_rank: number | null; total: number }[];

    return {
      chainSlug: chain.slug,
      chainName: chain.name,
      networkLabel: NETWORK_LABELS[chain.slug] ?? 'EVM Chain',
      morphoLiveSince,
      morphoRank: rankRows[0]?.morpho_rank ?? null,
      totalProtocolsOnChain: rankRows[0]?.total ?? 0,
    };
  },
  [CACHE_VERSION, 'header'],
  { revalidate: TTL, tags: ['chains'] },
);

export const getChainKpis = unstable_cache(
  async (slug: string): Promise<ChainKpis | null> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return null;

    const tvlRows = (await sql`
      WITH latest AS (
        SELECT (MAX(snapshot_date) - INTERVAL '1 day')::date AS d
        FROM morpho_.chain_lending_tvl_daily WHERE chain_slug = ${chain.slug}
      )
      SELECT
        (SELECT d::text FROM latest)                                       AS as_of,
        (SELECT tvl_usd::float8 FROM morpho_.protocol_tvl_daily
         WHERE chain_slug = ${chain.slug} AND protocol_slug = 'morpho-blue'
         AND snapshot_date = (SELECT d FROM latest))                       AS morpho_tvl,
        (SELECT tvl_usd::float8 FROM morpho_.protocol_tvl_daily
         WHERE chain_slug = ${chain.slug} AND protocol_slug = 'morpho-blue'
         AND snapshot_date = (SELECT d FROM latest) - INTERVAL '30 days')  AS morpho_tvl_30,
        (SELECT lending_tvl_usd::float8 FROM morpho_.chain_lending_tvl_daily
         WHERE chain_slug = ${chain.slug} AND snapshot_date = (SELECT d FROM latest)) AS lending_tvl,
        (SELECT lending_tvl_usd::float8 FROM morpho_.chain_lending_tvl_daily
         WHERE chain_slug = ${chain.slug} AND snapshot_date = (SELECT d FROM latest) - INTERVAL '30 days') AS lending_tvl_30
    `) as {
      as_of: string;
      morpho_tvl: number | null;
      morpho_tvl_30: number | null;
      lending_tvl: number | null;
      lending_tvl_30: number | null;
    }[];

    const r = tvlRows[0]!;
    const share = r.morpho_tvl != null && r.lending_tvl ? r.morpho_tvl / r.lending_tvl : 0;
    const share30 =
      r.morpho_tvl_30 != null && r.lending_tvl_30 && r.lending_tvl_30 > 0
        ? r.morpho_tvl_30 / r.lending_tvl_30
        : null;

    const counts = (await sql`
      SELECT
        (SELECT COUNT(*)::int FROM morpho_.markets WHERE chain_id = ${chain.chain_id}) AS markets,
        (SELECT COUNT(*)::int FROM morpho_.vaults  WHERE chain_id = ${chain.chain_id}) AS vaults,
        (SELECT COUNT(DISTINCT curator_id)::int FROM morpho_.vaults
         WHERE chain_id = ${chain.chain_id} AND curator_id IS NOT NULL)                 AS curators
    `) as { markets: number; vaults: number; curators: number }[];

    // Loan-book metrics from latest market state on this chain (+ 30d-ago loans).
    const lb = (await sql`
      WITH ls AS (
        SELECT s.borrow_assets_usd::float8 AS b, s.supply_assets_usd::float8 AS sup,
               s.collateral_assets_usd::float8 AS col,
               LEAST(s.borrow_apy, 1.0)::float8 AS bapy, LEAST(s.supply_apy, 1.0)::float8 AS sapy
        FROM morpho_.markets m
        JOIN LATERAL (
          SELECT * FROM morpho_.market_state_daily x
          WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE m.chain_id = ${chain.chain_id}
          AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
          AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      ),
      ls30 AS (
        SELECT s.b FROM morpho_.markets m
        JOIN LATERAL (
          SELECT borrow_assets_usd::float8 AS b, borrow_apy, supply_apy FROM morpho_.market_state_daily x
          WHERE x.market_unique_key = m.unique_key AND x.snapshot_date <= (CURRENT_DATE - INTERVAL '30 days')
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE m.chain_id = ${chain.chain_id}
          AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
          AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      )
      SELECT
        COALESCE(SUM(b), 0)::float8                AS active_loans,
        COALESCE(SUM(b * bapy), 0)::float8         AS borrow_interest,
        COALESCE(SUM(sup), 0)::float8              AS total_supply,
        COALESCE(SUM(col), 0)::float8              AS total_collateral,
        COALESCE(SUM(sup * sapy), 0)::float8       AS supply_interest,
        (SELECT COALESCE(SUM(b), 0)::float8 FROM ls30) AS active_loans_30
      FROM ls
    `) as { active_loans: number; borrow_interest: number; total_supply: number; total_collateral: number; supply_interest: number; active_loans_30: number }[];

    const l = lb[0]!;
    const totalDeposits = l.total_supply + l.total_collateral;
    const wBorrow = l.active_loans > 0 ? l.borrow_interest / l.active_loans : null;
    const wSupply = l.total_supply > 0 ? l.supply_interest / l.total_supply : null;
    const nim = wBorrow != null && wSupply != null ? wBorrow - wSupply : null;
    const al30 = l.active_loans_30 > 0 ? l.active_loans_30 : null;
    const alDelta = al30 != null ? (l.active_loans - al30) / al30 : null;

    return {
      activeLoansUsd: l.active_loans,
      activeLoans30dAgoUsd: al30,
      activeLoans30dDeltaPct: alDelta,
      borrowInterestUsd: l.borrow_interest,
      nim,
      utilization: totalDeposits > 0 ? l.active_loans / totalDeposits : null,
      totalDepositsUsd: totalDeposits,
      totalSupplyUsd: l.total_supply,
      morphoTvlUsd: r.morpho_tvl ?? 0,
      morphoTvl30dAgoUsd: r.morpho_tvl_30,
      morphoSharePct: share,
      morphoShare30dAgoPct: share30,
      marketCount: counts[0]?.markets ?? 0,
      vaultCount: counts[0]?.vaults ?? 0,
      curatorCount: counts[0]?.curators ?? 0,
      asOfDate: r.as_of,
    };
  },
  [CACHE_VERSION, 'kpis'],
  { revalidate: TTL, tags: ['chains'] },
);

export const getChainTvlAndShareSeries = unstable_cache(
  async (slug: string): Promise<TvlSharePoint[]> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return [];

    // Daily spine from Morpho's first day on the chain to the latest fully
    // populated lending day. Both the Morpho TVL numerator and the chain-lending
    // denominator are CARRY-FORWARD (most recent value on-or-before each day) so
    // the market-share line extends all the way back to when chain_lending data
    // begins, instead of starting where the exact-date join first matches.
    // Active loans are kept at raw daily granularity (the chart applies a 7-day
    // moving average for display; the CSV export keeps the daily values).
    const rows = (await sql`
      WITH bounds AS (
        SELECT
          (SELECT MIN(snapshot_date) FROM morpho_.protocol_tvl_daily
             WHERE chain_slug = ${chain.slug} AND protocol_slug = 'morpho-blue' AND tvl_usd > 0) AS start_d,
          (SELECT (MAX(snapshot_date) - INTERVAL '1 day')::date FROM morpho_.chain_lending_tvl_daily
             WHERE chain_slug = ${chain.slug}) AS end_d
      ),
      days AS (
        SELECT generate_series((SELECT start_d FROM bounds), (SELECT end_d FROM bounds), '1 day')::date AS d
      ),
      morpho_raw AS (
        SELECT snapshot_date::date AS d, tvl_usd::float8 AS tvl
        FROM morpho_.protocol_tvl_daily WHERE chain_slug = ${chain.slug} AND protocol_slug = 'morpho-blue'
      ),
      lend_raw AS (
        SELECT snapshot_date::date AS d, lending_tvl_usd::float8 AS tvl
        FROM morpho_.chain_lending_tvl_daily WHERE chain_slug = ${chain.slug}
      ),
      -- Active loans = morpho-blue borrowed on this chain (DefiLlama
      -- protocol_tvl_daily, carry-forward). This spans the full chain history;
      -- market_state_daily only retains ~13 months, which truncated the loans
      -- line. The latest values match the market-state sum exactly.
      bor_raw AS (
        SELECT snapshot_date::date AS d, borrowed_usd::float8 AS borrowed
        FROM morpho_.protocol_tvl_daily WHERE chain_slug = ${chain.slug} AND protocol_slug = 'morpho-blue'
      )
      SELECT
        days.d::text AS date,
        (SELECT borrowed FROM bor_raw bo WHERE bo.d <= days.d ORDER BY bo.d DESC LIMIT 1) AS active_loans,
        (SELECT tvl FROM morpho_raw m WHERE m.d <= days.d ORDER BY m.d DESC LIMIT 1) AS morpho_tvl,
        (SELECT tvl FROM lend_raw  l WHERE l.d <= days.d ORDER BY l.d DESC LIMIT 1) AS lending_tvl
      FROM days
      ORDER BY days.d ASC
    `) as { date: string; active_loans: number | null; morpho_tvl: number | null; lending_tvl: number | null }[];

    // Raw daily share, then a 7-day trailing moving average. Smoothing matters
    // here: early on, chain_lending_tvl_daily is sparse, so a carry-forward
    // denominator can briefly go stale-low and spike the daily ratio (e.g. a
    // 1-day 64% reading in Aug 2024 when the true monthly share was ~37%).
    // The MA removes those denominator artifacts so the line and the 50%
    // crossover reflect the durable trend, not a single stale day.
    const rawShare = rows.map((r) =>
      r.morpho_tvl != null && r.lending_tvl != null && r.lending_tvl > 0 ? r.morpho_tvl / r.lending_tvl : null,
    );
    const win: number[] = [];
    return rows.map((r, i) => {
      const s = rawShare[i]!;
      if (s != null) {
        win.push(s);
        if (win.length > 7) win.shift();
      }
      const ma = win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
      return {
        date: r.date,
        activeLoansUsd: r.active_loans,
        morphoTvlUsd: r.morpho_tvl,
        chainLendingTvlUsd: r.lending_tvl,
        morphoSharePct: s != null ? ma : null,
      };
    });
  },
  [CACHE_VERSION, 'tvl-share'],
  { revalidate: TTL, tags: ['chains'] },
);

export const getTopProtocolsOnChain = unstable_cache(
  async (slug: string, n = 5): Promise<{ meta: CompetitorMeta[]; series: CompetitorPoint[] }> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return { meta: [], series: [] };

    // Pick top-N protocols purely by latest per-chain TVL. No curated
    // LENDING_PROTOCOLS allow-list and no DefiLlama category gate, so any
    // protocol with chain TVL (e.g. Moonwell on Base) can surface. The name is
    // a LEFT JOIN lookup that falls back to the slug when the snapshot lacks it.
    //
    // Rank each protocol by its OWN most-recent TVL within a trailing 7-day
    // window, not a single global max day: DefiLlama feeds update on different
    // cadences (e.g. Moonwell on Base lags the majors by a few days), and a
    // strict snapshot_date = MAX(...) drops any protocol that hasn't reported
    // on that exact day.
    const topRows = (await sql`
      WITH chain_latest AS (
        SELECT MAX(snapshot_date)::date AS d
        FROM morpho_.protocol_tvl_daily WHERE chain_slug = ${chain.slug}
      ),
      recent AS (
        SELECT protocol_slug, tvl_usd::float8 AS tvl,
               ROW_NUMBER() OVER (PARTITION BY protocol_slug ORDER BY snapshot_date DESC) AS rn
        FROM morpho_.protocol_tvl_daily
        WHERE chain_slug = ${chain.slug}
          AND tvl_usd > 0
          AND snapshot_date > (SELECT d FROM chain_latest) - INTERVAL '7 days'
      )
      SELECT r.protocol_slug,
             COALESCE(s.name, r.protocol_slug) AS name,
             r.tvl
      FROM recent r
      JOIN morpho_.defillama_protocols_snapshot s USING (protocol_slug)
      WHERE r.rn = 1
        -- Category guard: only true lending/CDP protocols rank, so non-lending
        -- names (40 Acres, QiDao, …) can't slip in when n > 5. Moonwell is
        -- category 'Lending', so it keeps its spot.
        AND s.category IN ('Lending', 'CDP')
      ORDER BY r.tvl DESC
      LIMIT ${n}
    `) as { protocol_slug: string; name: string; tvl: number }[];

    const slugs = topRows.map((r) => r.protocol_slug);
    if (slugs.length === 0) return { meta: [], series: [] };
    if (!slugs.includes('morpho-blue')) slugs.push('morpho-blue');

    // Distinct, brand-consistent color per protocol so the multi-line chart
    // reads clearly against the dark surface. Morpho is the orange brand accent;
    // the comparators get separated hues (purple / magenta / cyan / green).
    const PROTO_COLORS: Record<string, string> = {
      'morpho-blue': tokens.colors.accent,   // orange (brand)
      'aave-v3': '#B97AFF',                   // purple
      'moonwell-lending': '#F472B6',          // magenta-pink
      'compound-v3': '#38BDF8',               // cyan
      'fluid-lending': '#34D399',             // green
      'euler-v2': '#6B85FF',                  // blue
      'sparklend': '#FBBF24',                 // amber
    };
    // Display-name overrides so the legend uses the rebranded short names rather
    // than DefiLlama's raw protocol names ("Morpho Blue", "Moonwell Lending").
    const NAME_OVERRIDE: Record<string, string> = {
      'morpho-blue': 'Morpho',
      'moonwell-lending': 'Moonwell',
    };
    const palette = tokens.colors.chart;
    const meta: CompetitorMeta[] = topRows.map((r, i) => ({
      protocolSlug: r.protocol_slug,
      name: NAME_OVERRIDE[r.protocol_slug] ?? r.name,
      color: PROTO_COLORS[r.protocol_slug] ?? palette[(i + 3) % palette.length]!,
      isMorpho: r.protocol_slug === 'morpho-blue',
    }));

    const seriesRows = (await sql`
      WITH first_seen AS (
        SELECT MIN(snapshot_date)::date AS d
        FROM morpho_.protocol_tvl_daily
        WHERE chain_slug = ${chain.slug}
          AND protocol_slug = ANY(${slugs}::text[])
          AND tvl_usd > 0
      ),
      latest AS (
        SELECT (MAX(snapshot_date) - INTERVAL '1 day')::date AS d
        FROM morpho_.chain_lending_tvl_daily WHERE chain_slug = ${chain.slug}
      )
      SELECT snapshot_date::text AS date, protocol_slug, tvl_usd::float8 AS tvl
      FROM morpho_.protocol_tvl_daily
      WHERE chain_slug    = ${chain.slug}
        AND protocol_slug = ANY(${slugs}::text[])
        AND snapshot_date >= (SELECT d FROM first_seen)
        AND snapshot_date <= (SELECT d FROM latest)
      ORDER BY snapshot_date ASC
    `) as { date: string; protocol_slug: string; tvl: number }[];

    const byDate = new Map<string, CompetitorPoint>();
    for (const r of seriesRows) {
      let p = byDate.get(r.date);
      if (!p) { p = { date: r.date }; byDate.set(r.date, p); }
      p[r.protocol_slug] = r.tvl;
    }
    return { meta, series: [...byDate.values()] };
  },
  [CACHE_VERSION, 'top-protocols'],
  { revalidate: TTL, tags: ['chains'] },
);

export const getChainTopMarkets = unstable_cache(
  async (slug: string, n = 10): Promise<MarketRow[]> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return [];
    const rows = (await sql`
      SELECT
        m.unique_key                                                          AS unique_key,
        m.collateral_asset_symbol                                             AS collateral,
        m.loan_asset_symbol                                                   AS loan,
        (m.lltv::numeric)::float8                                             AS lltv,
        s.supply_assets_usd::float8                                           AS supply_usd,
        s.borrow_assets_usd::float8                                           AS borrow_usd,
        s.utilization::float8                                                 AS utilization,
        -- APYs clamped to <100%. Bad oracle / dust markets occasionally report
        -- absurd rates. LEAST drops NULLs, so guard to preserve a genuine NULL.
        CASE WHEN s.supply_apy IS NULL THEN NULL ELSE LEAST(s.supply_apy::float8, 1.0) END  AS supply_apy,
        CASE WHEN s.borrow_apy IS NULL THEN NULL ELSE LEAST(s.borrow_apy::float8, 1.0) END  AS borrow_apy
      FROM morpho_.markets m
      JOIN LATERAL (
        SELECT * FROM morpho_.market_state_daily x
        WHERE x.market_unique_key = m.unique_key
        ORDER BY snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE m.chain_id = ${chain.chain_id}
        -- Exclude idle / loan-only markets (lltv = 0, no real collateral).
        AND m.lltv IS NOT NULL AND m.lltv > 0
        AND m.collateral_asset_address IS NOT NULL
        AND m.collateral_asset_address <> '0x0000000000000000000000000000000000000000'
        -- Exclude bad-oracle markets (APY > 100% ⇒ broken feed ⇒ inflated USD).
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
        AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      ORDER BY s.supply_assets_usd DESC NULLS LAST
      LIMIT ${n}
    `) as {
      unique_key: string; collateral: string | null; loan: string; lltv: number | null;
      supply_usd: number | null; borrow_usd: number | null; utilization: number | null;
      supply_apy: number | null; borrow_apy: number | null;
    }[];
    return rows.map((r) => ({
      uniqueKey: r.unique_key,
      collateralSymbol: r.collateral,
      loanSymbol: r.loan,
      lltvPct: r.lltv,
      supplyUsd: r.supply_usd ?? 0,
      borrowUsd: r.borrow_usd ?? 0,
      utilization: r.utilization,
      supplyApy: r.supply_apy,
      borrowApy: r.borrow_apy,
    }));
  },
  [CACHE_VERSION, 'top-markets'],
  { revalidate: TTL, tags: ['chains'] },
);

export const getChainTopVaults = unstable_cache(
  async (slug: string, n = 10): Promise<VaultRow[]> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return [];
    const rows = (await sql`
      WITH latest AS (
        SELECT v.chain_id, v.address, v.name, v.curator_id, v.asset_symbol, v.performance_fee_bps,
               s.total_assets_usd::float8 AS tvl,
               s.net_apy::float8           AS net_apy,
               CASE WHEN s.apy > 1.0 THEN NULL ELSE s.apy::float8 END AS gross_apy,
               COALESCE(s.fee_bps, v.performance_fee_bps) AS fee_bps,
               s.snapshot_date::date       AS d
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT * FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.chain_id = ${chain.chain_id}
      ),
      thirty AS (
        SELECT v.chain_id, v.address, x.total_assets_usd::float8 AS tvl_30
        FROM morpho_.vaults v
        LEFT JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily y
          WHERE y.chain_id = v.chain_id AND y.vault_address = v.address
            AND y.snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY y.snapshot_date DESC LIMIT 1
        ) x ON TRUE
        WHERE v.chain_id = ${chain.chain_id}
      )
      SELECT l.chain_id, l.address, l.name, l.asset_symbol, l.performance_fee_bps,
             l.tvl, l.net_apy, l.gross_apy, l.fee_bps,
             c.name AS curator_name,
             t.tvl_30
      FROM latest l
      LEFT JOIN morpho_.curators c ON c.id = l.curator_id
      LEFT JOIN thirty t ON t.chain_id = l.chain_id AND t.address = l.address
      ORDER BY l.tvl DESC NULLS LAST
      LIMIT ${n}
    `) as {
      chain_id: number; address: string; name: string | null;
      asset_symbol: string | null; performance_fee_bps: number | null;
      tvl: number | null; net_apy: number | null; gross_apy: number | null; fee_bps: number | null;
      curator_name: string | null; tvl_30: number | null;
    }[];

    return rows.map((r) => {
      // Annualized curator fee = tvl × gross apy × fee fraction; ×30/365 for 30d.
      const feeFrac = r.fee_bps != null ? r.fee_bps / 10000 : 0;
      const annualFee = r.tvl != null && r.gross_apy != null ? r.tvl * r.gross_apy * feeFrac : null;
      return {
        chainId: r.chain_id,
        address: r.address,
        name: r.name,
        curatorName: r.curator_name,
        assetSymbol: r.asset_symbol,
        tvlUsd: r.tvl ?? 0,
        netApy: r.net_apy,
        feeBps: r.performance_fee_bps,
        delta30dTvlUsd: r.tvl != null && r.tvl_30 != null ? r.tvl - r.tvl_30 : null,
        curatorFees30dUsd: annualFee != null ? annualFee * (30 / 365) : null,
      };
    });
  },
  [CACHE_VERSION, 'top-vaults'],
  { revalidate: TTL, tags: ['chains'] },
);

export const getChainCuratorPresence = unstable_cache(
  async (slug: string): Promise<CuratorRow[]> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return [];
    const rows = (await sql`
      WITH vault_latest AS (
        SELECT v.curator_id, v.chain_id,
               s.total_assets_usd::float8 AS tvl,
               s.net_apy::float8 AS net_apy,
               (s.total_assets_usd * (CASE WHEN s.apy > 1.0 THEN 0 ELSE COALESCE(s.apy, 0) END)
                  * (COALESCE(s.fee_bps, v.performance_fee_bps, 0)::numeric / 10000))::float8 AS annual_fee
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT * FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL
      ),
      on_chain AS (
        SELECT curator_id,
               COUNT(*)::int           AS vault_count,
               SUM(tvl)                AS tvl_on_chain,
               SUM(tvl * net_apy)      AS apy_num,
               SUM(tvl)                AS apy_den,
               SUM(annual_fee)         AS curator_fees
        FROM vault_latest
        WHERE chain_id = ${chain.chain_id} AND tvl IS NOT NULL
        GROUP BY curator_id
      ),
      global AS (
        SELECT curator_id, SUM(tvl) AS global_tvl
        FROM vault_latest
        WHERE tvl IS NOT NULL
        GROUP BY curator_id
      )
      SELECT
        o.curator_id,
        c.name                                                      AS curator_name,
        o.vault_count,
        o.tvl_on_chain::float8                                       AS tvl_on_chain,
        CASE WHEN o.apy_den > 0 THEN (o.apy_num / o.apy_den)::float8 ELSE NULL END AS weighted_net_apy,
        g.global_tvl::float8                                         AS global_tvl,
        COALESCE(o.curator_fees, 0)::float8                          AS curator_fees
      FROM on_chain o
      LEFT JOIN morpho_.curators c ON c.id = o.curator_id
      LEFT JOIN global g           ON g.curator_id = o.curator_id
      ORDER BY o.tvl_on_chain DESC NULLS LAST
      LIMIT 25
    `) as {
      curator_id: string; curator_name: string | null;
      vault_count: number; tvl_on_chain: number;
      weighted_net_apy: number | null; global_tvl: number; curator_fees: number;
    }[];

    return rows.map((r) => ({
      curatorId: r.curator_id,
      curatorName: r.curator_name,
      vaultCount: r.vault_count,
      tvlOnChainUsd: r.tvl_on_chain,
      weightedNetApy: r.weighted_net_apy,
      globalTvlUsd: r.global_tvl,
      curatorFeesAnnualUsd: r.curator_fees,
    }));
  },
  [CACHE_VERSION, 'curator-presence'],
  { revalidate: TTL, tags: ['chains'] },
);

export const getChainAssetMix = unstable_cache(
  async (slug: string): Promise<ChainAssetMixResult> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return { supply: [], collateral: [] };

    // Fetch raw (symbol, value) rows for each side; bucket into asset classes in
    // JS (see categorizeAsset. The SQL CASE approach can't survive neon's
    // parameter binding). Loan side = supply_assets_usd by loan asset.
    const supplyRows = (await sql`
      SELECT a.symbol AS symbol, s.supply_assets_usd::float8 AS value_usd
      FROM morpho_.markets m
      JOIN LATERAL (
        SELECT * FROM morpho_.market_state_daily x
        WHERE x.market_unique_key = m.unique_key
        ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      JOIN morpho_.assets a ON a.chain_id = m.chain_id AND a.address = m.loan_asset_address
      WHERE m.chain_id = ${chain.chain_id}
        AND s.supply_assets_usd IS NOT NULL AND s.supply_assets_usd > 0
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
        AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
    `) as { symbol: string | null; value_usd: number | null }[];

    // Collateral side = collateral_assets_usd by collateral asset. Idle /
    // loan-only markets carry no collateral, so exclude them up front.
    const collateralRows = (await sql`
      SELECT a.symbol AS symbol, s.collateral_assets_usd::float8 AS value_usd
      FROM morpho_.markets m
      JOIN LATERAL (
        SELECT * FROM morpho_.market_state_daily x
        WHERE x.market_unique_key = m.unique_key
        ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      JOIN morpho_.assets a ON a.chain_id = m.chain_id AND a.address = m.collateral_asset_address
      WHERE m.chain_id = ${chain.chain_id}
        AND m.lltv IS NOT NULL AND m.lltv > 0
        AND m.collateral_asset_address IS NOT NULL
        AND m.collateral_asset_address <> '0x0000000000000000000000000000000000000000'
        AND s.collateral_assets_usd IS NOT NULL AND s.collateral_assets_usd > 0
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
        AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
    `) as { symbol: string | null; value_usd: number | null }[];

    return { supply: aggregateMix(supplyRows), collateral: aggregateMix(collateralRows) };
  },
  [CACHE_VERSION, 'asset-mix'],
  { revalidate: TTL, tags: ['chains'] },
);

// ===========================================================================
// PART C. Enrichment sections for /chains/[slug].
// ===========================================================================

// ---------- Section 9: interest-flow attribution ----------

export interface InterestFlowAttribution {
  totalBorrowInterest: number;   // annualized
  lenderYield: number;           // total − curator fees − protocol fees
  lenderViaVaults: number;
  lenderDirect: number;
  curatorFees: number;
  daoFees: number;               // placeholder (fee switch off) → 0
  vaultSupplyShare: number;      // fraction of market supply sourced from vaults
}

export const getChainInterestFlowAttribution = unstable_cache(
  async (slug: string): Promise<InterestFlowAttribution | null> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return null;
    const rows = (await sql`
      WITH mkt AS (
        SELECT COALESCE(SUM(s.borrow_assets_usd * LEAST(s.borrow_apy, 1.0)), 0)::float8 AS borrow_interest,
               COALESCE(SUM(s.supply_assets_usd), 0)::float8 AS market_supply
        FROM morpho_.markets m
        JOIN LATERAL (
          SELECT * FROM morpho_.market_state_daily x
          WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE m.chain_id = ${chain.chain_id}
          AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
          AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      ),
      vlt AS (
        SELECT
          COALESCE(SUM(s.total_assets_usd), 0)::float8 AS vault_tvl,
          COALESCE(SUM(s.total_assets_usd * (CASE WHEN s.apy > 1.0 THEN 0 ELSE COALESCE(s.apy, 0) END)
            * (COALESCE(s.fee_bps, v.performance_fee_bps, 0)::numeric / 10000)), 0)::float8 AS curator_fees
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT * FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.chain_id = ${chain.chain_id}
      )
      SELECT mkt.borrow_interest, mkt.market_supply, vlt.vault_tvl, vlt.curator_fees FROM mkt, vlt
    `) as { borrow_interest: number; market_supply: number; vault_tvl: number; curator_fees: number }[];

    const r = rows[0]!;
    const daoFees = 0; // protocol fee switch is off
    const lenderYield = Math.max(0, r.borrow_interest - r.curator_fees - daoFees);
    const vaultShare = r.market_supply > 0 ? Math.min(1, r.vault_tvl / r.market_supply) : 0;
    return {
      totalBorrowInterest: r.borrow_interest,
      lenderYield,
      lenderViaVaults: lenderYield * vaultShare,
      lenderDirect: lenderYield * (1 - vaultShare),
      curatorFees: r.curator_fees,
      daoFees,
      vaultSupplyShare: vaultShare,
    };
  },
  [CACHE_VERSION, 'interest-flow'],
  { revalidate: TTL, tags: ['chains'] },
);

// ---------- Section 10: rates comparison vs competitors ----------

export interface RateComparisonRow {
  asset: string;
  morphoSupplyApy: number | null;
  competitorName: string;
  competitorSupplyApy: number | null;
  spreadBps: number | null;       // morpho − competitor
}

export const getChainRatesComparison = unstable_cache(
  async (slug: string, assets: string[] = ['USDC', 'USDT', 'DAI', 'WETH']): Promise<RateComparisonRow[]> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return [];
    const upper = assets.map((a) => a.toUpperCase());

    const morphoRows = (await sql`
      SELECT UPPER(m.loan_asset_symbol) AS sym,
             SUM(s.supply_assets_usd * LEAST(s.supply_apy, 1.0))::float8 AS num,
             SUM(s.supply_assets_usd)::float8 AS den
      FROM morpho_.markets m
      JOIN LATERAL (
        SELECT * FROM morpho_.market_state_daily x
        WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE m.chain_id = ${chain.chain_id}
        AND UPPER(m.loan_asset_symbol) = ANY(${upper}::text[])
        AND s.supply_assets_usd > 0
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
        AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      GROUP BY UPPER(m.loan_asset_symbol)
    `) as { sym: string; num: number; den: number }[];
    const morphoBy = new Map(morphoRows.map((r) => [r.sym, r.den > 0 ? r.num / r.den : null] as const));

    const aaveRows = (await sql`
      WITH latest AS (
        SELECT MAX(snapshot_date) AS d FROM morpho_.aave_rates_daily WHERE chain_id = ${chain.chain_id}
      )
      SELECT UPPER(asset_symbol) AS sym, supply_apy::float8 AS supply_apy
      FROM morpho_.aave_rates_daily
      WHERE chain_id = ${chain.chain_id} AND snapshot_date = (SELECT d FROM latest)
        AND UPPER(asset_symbol) = ANY(${upper}::text[])
    `) as { sym: string; supply_apy: number | null }[];
    const aaveBy = new Map(aaveRows.map((r) => [r.sym, r.supply_apy] as const));

    const out: RateComparisonRow[] = [];
    for (const a of upper) {
      const m = morphoBy.get(a);
      const c = aaveBy.get(a);
      if (m == null || c == null) continue; // need BOTH a Morpho market and a competitor
      out.push({
        asset: a,
        morphoSupplyApy: m,
        competitorName: 'Aave V3',
        competitorSupplyApy: c,
        spreadBps: Math.round((m - c) * 10000),
      });
    }
    return out;
  },
  [CACHE_VERSION, 'rates-comparison'],
  { revalidate: TTL, tags: ['chains'] },
);

// ---------- Section 11: risk surface ----------

export interface RiskMarketRow {
  uniqueKey: string;
  collateralSymbol: string | null;
  loanSymbol: string;
  supplyUsd: number;
  utilization: number | null;
  lltvPct: number | null;
  riskScore: number;
}

export interface BadDebtRow {
  uniqueKey: string;
  loanSymbol: string;
  collateralSymbol: string | null;
  badDebtUsd: number;
  lastSeen: string;
}

export interface ChainRiskSurface {
  markets: RiskMarketRow[];
  badDebt: BadDebtRow[];
}

export const getChainRiskSurface = unstable_cache(
  async (slug: string, limit = 10): Promise<ChainRiskSurface> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return { markets: [], badDebt: [] };

    const markets = (await sql`
      SELECT m.unique_key, m.collateral_asset_symbol AS col, m.loan_asset_symbol AS loan,
             s.supply_assets_usd::float8 AS supply, s.utilization::float8 AS util,
             (m.lltv::numeric / 1e18)::float8 AS lltv_frac,
             (s.supply_assets_usd * COALESCE(s.utilization, 0) * (m.lltv::numeric / 1e18))::float8 AS risk_score
      FROM morpho_.markets m
      JOIN LATERAL (
        SELECT * FROM morpho_.market_state_daily x
        WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE m.chain_id = ${chain.chain_id}
        AND m.lltv IS NOT NULL AND m.lltv > 0
        AND m.collateral_asset_address IS NOT NULL
        AND m.collateral_asset_address <> '0x0000000000000000000000000000000000000000'
        AND s.supply_assets_usd > 0
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
        AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
      ORDER BY risk_score DESC NULLS LAST
      LIMIT ${limit}
    `) as { unique_key: string; col: string | null; loan: string; supply: number; util: number | null; lltv_frac: number | null; risk_score: number }[];

    const badDebt = (await sql`
      SELECT m.unique_key, m.loan_asset_symbol AS loan, m.collateral_asset_symbol AS col,
             MAX(s.bad_debt_assets_usd)::float8 AS bad_debt,
             MAX(s.snapshot_date)::text AS last_seen
      FROM morpho_.markets m
      JOIN morpho_.market_state_daily s ON s.market_unique_key = m.unique_key
      WHERE m.chain_id = ${chain.chain_id}
        AND s.snapshot_date >= (CURRENT_DATE - INTERVAL '90 days')
        AND s.bad_debt_assets_usd > 1
      GROUP BY m.unique_key, m.loan_asset_symbol, m.collateral_asset_symbol
      ORDER BY bad_debt DESC
      LIMIT 10
    `) as { unique_key: string; loan: string; col: string | null; bad_debt: number; last_seen: string }[];

    return {
      markets: markets.map((r) => ({
        uniqueKey: r.unique_key,
        collateralSymbol: r.col,
        loanSymbol: r.loan,
        supplyUsd: r.supply ?? 0,
        utilization: r.util,
        lltvPct: r.lltv_frac != null ? r.lltv_frac * 100 : null,
        riskScore: r.risk_score ?? 0,
      })),
      badDebt: badDebt.map((r) => ({
        uniqueKey: r.unique_key,
        loanSymbol: r.loan,
        collateralSymbol: r.col,
        badDebtUsd: r.bad_debt,
        lastSeen: r.last_seen,
      })),
    };
  },
  [CACHE_VERSION, 'risk-surface'],
  { revalidate: TTL, tags: ['chains'] },
);

// ---------- Section 12: active-loan quality ----------

export interface ChainLoanQuality {
  weightedAvgLltvPct: number | null;
  pctLoansAbove90Util: number | null;
  pctLoansStableCollateral: number | null;
  pctLoansVolCollateral: number | null;
  badDebtUsd: number;
}

export const getChainLoanQuality = unstable_cache(
  async (slug: string): Promise<ChainLoanQuality | null> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return null;

    const rows = (await sql`
      SELECT m.collateral_asset_symbol AS col,
             s.borrow_assets_usd::float8 AS borrow,
             s.utilization::float8 AS util,
             (m.lltv::numeric / 1e18)::float8 AS lltv_frac,
             s.bad_debt_assets_usd::float8 AS bad_debt
      FROM morpho_.markets m
      JOIN LATERAL (
        SELECT * FROM morpho_.market_state_daily x
        WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE m.chain_id = ${chain.chain_id}
        AND m.lltv IS NOT NULL AND m.lltv > 0
        AND m.collateral_asset_address IS NOT NULL
        AND m.collateral_asset_address <> '0x0000000000000000000000000000000000000000'
        AND (s.borrow_apy IS NULL OR s.borrow_apy <= 1.0)
        AND (s.supply_apy IS NULL OR s.supply_apy <= 1.0)
    `) as { col: string | null; borrow: number | null; util: number | null; lltv_frac: number | null; bad_debt: number | null }[];

    let totalBorrow = 0, lltvNum = 0, above90 = 0, stable = 0, vol = 0, badDebt = 0;
    for (const r of rows) {
      const b = r.borrow ?? 0;
      badDebt += r.bad_debt ?? 0;
      if (b <= 0) continue;
      totalBorrow += b;
      if (r.lltv_frac != null) lltvNum += b * r.lltv_frac;
      if (r.util != null && r.util > 0.9) above90 += b;
      if (categorizeAsset(r.col) === 'stablecoin') stable += b; else vol += b;
    }
    if (totalBorrow <= 0) {
      return { weightedAvgLltvPct: null, pctLoansAbove90Util: null, pctLoansStableCollateral: null, pctLoansVolCollateral: null, badDebtUsd: badDebt };
    }
    return {
      weightedAvgLltvPct: (lltvNum / totalBorrow) * 100,
      pctLoansAbove90Util: above90 / totalBorrow,
      pctLoansStableCollateral: stable / totalBorrow,
      pctLoansVolCollateral: vol / totalBorrow,
      badDebtUsd: badDebt,
    };
  },
  [CACHE_VERSION, 'loan-quality'],
  { revalidate: TTL, tags: ['chains'] },
);

// ---------- Section 13: recently launched ----------

export interface RecentMarket {
  uniqueKey: string;
  loanSymbol: string;
  collateralSymbol: string | null;
  firstSeen: string;
  supplyUsd: number;
}

export interface RecentVault {
  address: string;
  name: string | null;
  curatorName: string | null;
  firstSeen: string;
  tvlUsd: number;
}

export interface ChainRecentLaunches {
  markets: RecentMarket[];
  vaults: RecentVault[];
}

export const getChainRecentLaunches = unstable_cache(
  async (slug: string, days = 30): Promise<ChainRecentLaunches> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return { markets: [], vaults: [] };

    const markets = (await sql`
      SELECT m.unique_key, m.loan_asset_symbol AS loan, m.collateral_asset_symbol AS col,
             m.first_seen_at::text AS first_seen,
             COALESCE(s.supply_assets_usd, 0)::float8 AS supply
      FROM morpho_.markets m
      LEFT JOIN LATERAL (
        SELECT supply_assets_usd FROM morpho_.market_state_daily x
        WHERE x.market_unique_key = m.unique_key ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE m.chain_id = ${chain.chain_id}
        AND m.first_seen_at >= (NOW() - (${days} * INTERVAL '1 day'))
      ORDER BY m.first_seen_at DESC
      LIMIT 10
    `) as { unique_key: string; loan: string; col: string | null; first_seen: string; supply: number }[];

    const vaults = (await sql`
      SELECT v.address, v.name, c.name AS curator_name, v.first_seen_at::text AS first_seen,
             COALESCE(s.total_assets_usd, 0)::float8 AS tvl
      FROM morpho_.vaults v
      LEFT JOIN morpho_.curators c ON c.id = v.curator_id
      LEFT JOIN LATERAL (
        SELECT total_assets_usd FROM morpho_.vault_state_daily x
        WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE v.chain_id = ${chain.chain_id}
        AND v.first_seen_at >= (NOW() - (${days} * INTERVAL '1 day'))
      ORDER BY v.first_seen_at DESC
      LIMIT 10
    `) as { address: string; name: string | null; curator_name: string | null; first_seen: string; tvl: number }[];

    return {
      markets: markets.map((r) => ({ uniqueKey: r.unique_key, loanSymbol: r.loan, collateralSymbol: r.col, firstSeen: r.first_seen, supplyUsd: r.supply })),
      vaults: vaults.map((r) => ({ address: r.address, name: r.name, curatorName: r.curator_name, firstSeen: r.first_seen, tvlUsd: r.tvl })),
    };
  },
  [CACHE_VERSION, 'recent-launches'],
  { revalidate: TTL, tags: ['chains'] },
);
