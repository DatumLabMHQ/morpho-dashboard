// Per-chain detail page queries. All read from Neon only — no external API
// calls at render time. Each function cached via unstable_cache(900).

import { unstable_cache } from 'next/cache';

import { tokens } from '../brand/tokens.js';
import { getDb } from '../db.js';

const CACHE_VERSION = 'chain-detail-v2';
const TTL = 900;

// Network classification — small inline map; the chains table doesn't carry
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

const ASSET_CATEGORY_CASE = `
  CASE
    WHEN UPPER(a.symbol) IN ('USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD','FDUSD','TUSD','MIM','BUIDL') THEN 'stablecoin'
    WHEN UPPER(a.symbol) IN ('WSTETH','WEETH','EZETH','RSETH','SWETH','RETH','METH','OSETH','LSETH') THEN 'lst'
    WHEN UPPER(a.symbol) IN ('PT-WEETH','PT-EZETH','PT-RSETH','EBTC','UNIETH','PUFETH') OR UPPER(a.symbol) LIKE 'PT-%' THEN 'lrt'
    WHEN UPPER(a.symbol) IN ('WBTC','CBBTC','TBTC','LBTC','SBTC','RBTC','MBTC','SOLVBTC','EBTC','WBTC18') THEN 'btc'
    WHEN UPPER(a.symbol) IN ('WETH','ETH') THEN 'eth'
    WHEN UPPER(a.symbol) LIKE '%RWA%' OR UPPER(a.symbol) IN ('USTB','OUSG','UDUSD','SBUIDL') THEN 'rwa'
    ELSE 'other'
  END
`;

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
}

export interface CuratorRow {
  curatorId: string;
  curatorName: string | null;
  vaultCount: number;
  tvlOnChainUsd: number;
  weightedNetApy: number | null;
  globalTvlUsd: number;
}

export interface AssetMixSlice {
  category: string;          // stablecoin / lst / lrt / btc / eth / rwa / other
  supplyUsd: number;
  topSymbol: string | null;
  topSymbolUsd: number;
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

    return {
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

    const rows = (await sql`
      WITH latest AS (
        SELECT (MAX(snapshot_date) - INTERVAL '1 day')::date AS d
        FROM morpho_.chain_lending_tvl_daily WHERE chain_slug = ${chain.slug}
      ),
      first_seen AS (
        SELECT MIN(snapshot_date)::date AS d
        FROM morpho_.protocol_tvl_daily
        WHERE chain_slug = ${chain.slug} AND protocol_slug = 'morpho-blue' AND tvl_usd > 0
      )
      SELECT
        m.snapshot_date::text                                                   AS date,
        m.tvl_usd::float8                                                       AS morpho_tvl,
        l.lending_tvl_usd::float8                                               AS lending_tvl,
        CASE WHEN l.lending_tvl_usd > 0
             THEN (m.tvl_usd::numeric / l.lending_tvl_usd)::float8
             ELSE NULL END                                                      AS share
      FROM morpho_.protocol_tvl_daily m
      LEFT JOIN morpho_.chain_lending_tvl_daily l
        ON l.chain_slug = m.chain_slug AND l.snapshot_date = m.snapshot_date
      WHERE m.protocol_slug = 'morpho-blue'
        AND m.chain_slug    = ${chain.slug}
        AND m.snapshot_date >= (SELECT d FROM first_seen)
        AND m.snapshot_date <= (SELECT d FROM latest)
      ORDER BY m.snapshot_date ASC
    `) as { date: string; morpho_tvl: number | null; lending_tvl: number | null; share: number | null }[];

    return rows.map((r) => ({
      date: r.date,
      morphoTvlUsd: r.morpho_tvl,
      chainLendingTvlUsd: r.lending_tvl,
      morphoSharePct: r.share,
    }));
  },
  [CACHE_VERSION, 'tvl-share'],
  { revalidate: TTL, tags: ['chains'] },
);

export const getTopProtocolsOnChain = unstable_cache(
  async (slug: string, n = 5): Promise<{ meta: CompetitorMeta[]; series: CompetitorPoint[] }> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return { meta: [], series: [] };

    // Pick top-N protocols by latest TVL on this chain (must include Morpho).
    const topRows = (await sql`
      WITH latest_day AS (
        SELECT (MAX(snapshot_date) - INTERVAL '1 day')::date AS d
        FROM morpho_.chain_lending_tvl_daily WHERE chain_slug = ${chain.slug}
      )
      SELECT t.protocol_slug, s.name, t.tvl_usd::float8 AS tvl
      FROM morpho_.protocol_tvl_daily t
      JOIN morpho_.defillama_protocols_snapshot s USING (protocol_slug)
      WHERE t.chain_slug = ${chain.slug}
        AND t.snapshot_date = (SELECT d FROM latest_day)
        AND s.category IN ('Lending','CDP')
        AND t.tvl_usd > 0
      ORDER BY t.tvl_usd DESC
      LIMIT ${n}
    `) as { protocol_slug: string; name: string; tvl: number }[];

    const slugs = topRows.map((r) => r.protocol_slug);
    if (slugs.length === 0) return { meta: [], series: [] };
    if (!slugs.includes('morpho-blue')) slugs.push('morpho-blue');

    const palette = tokens.colors.chart;
    const meta: CompetitorMeta[] = topRows.map((r, i) => ({
      protocolSlug: r.protocol_slug,
      name: r.name,
      color:
        r.protocol_slug === 'morpho-blue'
          ? tokens.colors.accent
          : palette[(i + 1) % palette.length]!,
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
        s.supply_apy::float8                                                  AS supply_apy,
        s.borrow_apy::float8                                                  AS borrow_apy
      FROM morpho_.markets m
      JOIN LATERAL (
        SELECT * FROM morpho_.market_state_daily x
        WHERE x.market_unique_key = m.unique_key
        ORDER BY snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE m.chain_id = ${chain.chain_id}
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
             l.tvl, l.net_apy,
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
      tvl: number | null; net_apy: number | null;
      curator_name: string | null; tvl_30: number | null;
    }[];

    return rows.map((r) => ({
      chainId: r.chain_id,
      address: r.address,
      name: r.name,
      curatorName: r.curator_name,
      assetSymbol: r.asset_symbol,
      tvlUsd: r.tvl ?? 0,
      netApy: r.net_apy,
      feeBps: r.performance_fee_bps,
      delta30dTvlUsd: r.tvl != null && r.tvl_30 != null ? r.tvl - r.tvl_30 : null,
    }));
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
               s.net_apy::float8 AS net_apy
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
               COUNT(*)::int        AS vault_count,
               SUM(tvl)             AS tvl_on_chain,
               SUM(tvl * net_apy)   AS apy_num,
               SUM(tvl)             AS apy_den
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
        g.global_tvl::float8                                         AS global_tvl
      FROM on_chain o
      LEFT JOIN morpho_.curators c ON c.id = o.curator_id
      LEFT JOIN global g           ON g.curator_id = o.curator_id
      ORDER BY o.tvl_on_chain DESC NULLS LAST
      LIMIT 25
    `) as {
      curator_id: string; curator_name: string | null;
      vault_count: number; tvl_on_chain: number;
      weighted_net_apy: number | null; global_tvl: number;
    }[];

    return rows.map((r) => ({
      curatorId: r.curator_id,
      curatorName: r.curator_name,
      vaultCount: r.vault_count,
      tvlOnChainUsd: r.tvl_on_chain,
      weightedNetApy: r.weighted_net_apy,
      globalTvlUsd: r.global_tvl,
    }));
  },
  [CACHE_VERSION, 'curator-presence'],
  { revalidate: TTL, tags: ['chains'] },
);

export const getChainAssetMix = unstable_cache(
  async (slug: string): Promise<AssetMixSlice[]> => {
    const sql = getDb();
    const chain = await resolveChain(slug);
    if (!chain) return [];
    // Aggregate today's Morpho supply on this chain by inline asset category.
    const rows = (await sql`
      WITH latest_market AS (
        SELECT m.unique_key, m.loan_asset_address, m.chain_id,
               s.supply_assets_usd::float8 AS supply_usd
        FROM morpho_.markets m
        JOIN LATERAL (
          SELECT * FROM morpho_.market_state_daily x
          WHERE x.market_unique_key = m.unique_key
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE m.chain_id = ${chain.chain_id}
      ),
      with_cat AS (
        SELECT
          ${ASSET_CATEGORY_CASE} AS category,
          a.symbol               AS symbol,
          lm.supply_usd
        FROM latest_market lm
        JOIN morpho_.assets a ON a.chain_id = lm.chain_id AND a.address = lm.loan_asset_address
        WHERE lm.supply_usd IS NOT NULL AND lm.supply_usd > 0
      ),
      by_cat AS (
        SELECT category, SUM(supply_usd)::float8 AS supply_usd
        FROM with_cat
        GROUP BY category
      ),
      top_sym AS (
        SELECT DISTINCT ON (category)
          category, symbol, SUM(supply_usd) OVER (PARTITION BY category, symbol)::float8 AS top_usd
        FROM with_cat
        ORDER BY category, top_usd DESC
      )
      SELECT b.category, b.supply_usd, t.symbol AS top_symbol, t.top_usd
      FROM by_cat b
      LEFT JOIN top_sym t USING (category)
      ORDER BY b.supply_usd DESC
    `) as { category: string; supply_usd: number; top_symbol: string | null; top_usd: number | null }[];

    return rows.map((r) => ({
      category: r.category,
      supplyUsd: r.supply_usd,
      topSymbol: r.top_symbol,
      topSymbolUsd: r.top_usd ?? 0,
    }));
  },
  [CACHE_VERSION, 'asset-mix'],
  { revalidate: TTL, tags: ['chains'] },
);
