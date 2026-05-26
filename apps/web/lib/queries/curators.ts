// Curator-surface queries.
//
// Two attribution paths (per the build spec):
//   - TVL / share / concentration  → grouped by vaults.curator_id (the
//     declared curator from Morpho's metadata, including V2 multi-curator).
//     "Unattributed TVL" = vaults where curator_id IS NULL.
//   - Revenue                       → grouped by the curator whose
//     curator_addresses row matches the vault's fee_recipient_address.
//     "UNATTRIBUTED" revenue = no curator address matched the fee recipient.
//
// Revenue formula (the user pinned this): tvl × pre-fee APY × fee_bps/10000.
// vault_state_daily.apy IS pre-fee (we extracted that from the Morpho GraphQL
// MarketState.apy field — see packages/core/src/sources/morpho-graphql.ts).
// fee_bps is the vault's current performance fee.
//
// Allocation-level data is empty until /backfill/tick?job=vault-allocations
// drains. The "asset class" mix uses vault.asset_symbol as a coarse proxy.

import { unstable_cache } from 'next/cache';

import { getDb } from '../db.js';

const CACHE_VERSION = 'curators-v1';
const TTL = 900;

// Inline asset-class categorizer (shared with chain-detail.ts; duplicated here
// to keep the file self-contained for the query layer).
const ASSET_CATEGORY_CASE = `
  CASE
    WHEN UPPER(sym) IN ('USDC','USDT','DAI','USDS','SUSDS','USDE','SUSDE','GHO','FRAX','CRVUSD','USR','PYUSD','LUSD','FDUSD','TUSD','MIM','BUIDL') THEN 'stablecoin'
    WHEN UPPER(sym) IN ('WSTETH','WEETH','EZETH','RSETH','SWETH','RETH','METH','OSETH','LSETH','PUFETH') THEN 'lst'
    WHEN UPPER(sym) LIKE 'PT-%' OR UPPER(sym) IN ('UNIETH') THEN 'lrt'
    WHEN UPPER(sym) IN ('WBTC','CBBTC','TBTC','LBTC','SBTC','RBTC','MBTC','SOLVBTC','EBTC','WBTC18') THEN 'btc'
    WHEN UPPER(sym) IN ('WETH','ETH') THEN 'eth'
    WHEN UPPER(sym) LIKE '%RWA%' OR UPPER(sym) IN ('USTB','OUSG','UDUSD','SBUIDL') THEN 'rwa'
    ELSE 'other'
  END
`;

// ---------- Types ----------

export interface DirectoryHeader {
  activeCurators: number;
  totalCuratedTvlUsd: number;
  chainCount: number;
  asOfDate: string;
}

export interface ConcentrationStats {
  cr3: number;          // 0..1 — top-3 share of curated TVL
  cr5: number;          // 0..1 — top-5 share
  hhi: number;          // 0..10000 (DOJ scale; >2500 is "highly concentrated")
  hhiLabel: 'unconcentrated' | 'moderately concentrated' | 'highly concentrated';
}

export interface DirectoryKpis {
  activeCurators: number;
  multiChainCurators: number;
  largestTvlUsd: number;
  largestShare: number;        // 0..1
  largestCuratorName: string | null;
  totalRevenueUsd: number;     // annualized estimate
  vaultCount: number;
}

export interface CuratorTableRow {
  curatorId: string;
  curatorName: string;
  imageUrl: string | null;
  verified: boolean;
  totalTvlUsd: number;
  sharePct: number;            // 0..1
  vaultCount: number;
  chainCount: number;
  weightedNetApy: number | null;
  estAnnualRevenueUsd: number;
  delta90dPct: number | null;
  isUnattributed: boolean;
}

export interface ShareStackSlice {
  curatorId: string | null;    // null for OTHERS bucket
  curatorName: string;
  tvlUsd: number;
  sharePct: number;
  color: string;
}

export interface ReachMatrixCell {
  curatorId: string;
  curatorName: string;
  chainSlug: string;
  chainName: string;
  tvlUsd: number;
}

export interface RevenueLeaderboardRow {
  curatorId: string | null;    // null = UNATTRIBUTED
  curatorName: string;
  estAnnualRevenueUsd: number;
  sharePct: number;            // 0..1 of total fee take
  isUnattributed: boolean;
}

export interface CuratorDetail {
  curatorId: string;
  curatorName: string;
  imageUrl: string | null;
  url: string | null;
  description: string | null;
  verified: boolean;
  vaultCount: number;
  chainCount: number;
  totalTvlUsd: number;
  rank: number;
  totalCurators: number;
}

export interface CuratorKpis {
  totalTvlUsd: number;
  tvl30dAgoUsd: number | null;
  share: number;
  share30dAgo: number | null;
  vaultCount: number;
  vaultsAdded30d: number;
  weightedNetApy: number | null;
  estAnnualRevenueUsd: number;
}

export interface CuratorTvlChainPoint {
  date: string;
  // chain_slug → tvl_usd
  [chain: string]: string | number | null;
}

export interface CuratorVaultRow {
  chainId: number;
  chainSlug: string | null;
  address: string;
  name: string | null;
  assetSymbol: string | null;
  tvlUsd: number;
  netApy: number | null;
  feeBps: number | null;
  utilization: number | null;
}

export interface CuratorAssetMixSlice {
  category: string;
  tvlUsd: number;
  topSymbol: string | null;
}

export interface PerfPoint {
  date: string;
  curatorNetApy: number | null;
  morphoNetApy: number | null;
}

// ---------- Helpers ----------

const HHI_LABEL = (hhi: number): ConcentrationStats['hhiLabel'] =>
  hhi >= 2500 ? 'highly concentrated' : hhi >= 1500 ? 'moderately concentrated' : 'unconcentrated';

// ---------- Directory queries ----------

export const getCuratorDirectoryHeader = unstable_cache(
  async (): Promise<DirectoryHeader> => {
    const sql = getDb();
    const rows = (await sql`
      WITH latest_vault AS (
        SELECT v.chain_id, v.address, v.curator_id, s.total_assets_usd
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd, snapshot_date
          FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL
      )
      SELECT
        COUNT(DISTINCT curator_id)::int                 AS curators,
        SUM(total_assets_usd)::float8                    AS tvl,
        COUNT(DISTINCT chain_id)::int                    AS chains,
        (SELECT MAX(snapshot_date)::text FROM morpho_.vault_state_daily) AS as_of
      FROM latest_vault
    `) as { curators: number; tvl: number; chains: number; as_of: string }[];
    const r = rows[0]!;
    return {
      activeCurators: r.curators,
      totalCuratedTvlUsd: r.tvl ?? 0,
      chainCount: r.chains,
      asOfDate: r.as_of,
    };
  },
  [CACHE_VERSION, 'header'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getConcentrationStats = unstable_cache(
  async (): Promise<ConcentrationStats> => {
    const sql = getDb();
    const rows = (await sql`
      WITH per_curator AS (
        SELECT v.curator_id,
               SUM(s.total_assets_usd)::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL AND s.total_assets_usd > 0
        GROUP BY v.curator_id
      ),
      totals AS (
        SELECT SUM(tvl) AS total_tvl FROM per_curator
      ),
      ranked AS (
        SELECT curator_id, tvl,
               ROW_NUMBER() OVER (ORDER BY tvl DESC) AS rnk,
               tvl / NULLIF((SELECT total_tvl FROM totals), 0) AS share
        FROM per_curator
      )
      SELECT
        COALESCE(SUM(share) FILTER (WHERE rnk <= 3), 0)::float8 AS cr3,
        COALESCE(SUM(share) FILTER (WHERE rnk <= 5), 0)::float8 AS cr5,
        COALESCE(SUM(POWER(share * 100, 2)), 0)::float8        AS hhi
      FROM ranked
    `) as { cr3: number; cr5: number; hhi: number }[];
    const r = rows[0]!;
    return {
      cr3: r.cr3 ?? 0,
      cr5: r.cr5 ?? 0,
      hhi: r.hhi ?? 0,
      hhiLabel: HHI_LABEL(r.hhi ?? 0),
    };
  },
  [CACHE_VERSION, 'concentration'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getDirectoryKpis = unstable_cache(
  async (): Promise<DirectoryKpis> => {
    const sql = getDb();
    const rows = (await sql`
      WITH latest_vault AS (
        SELECT
          v.curator_id, v.chain_id, v.fee_recipient_address,
          s.total_assets_usd::float8 AS tvl,
          s.apy::float8 AS apy,
          s.net_apy::float8 AS net_apy,
          s.fee_bps
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd, apy, net_apy, fee_bps
          FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
      ),
      per_curator AS (
        SELECT curator_id,
               COUNT(DISTINCT chain_id)::int AS chains,
               SUM(tvl)::float8              AS tvl
        FROM latest_vault
        WHERE curator_id IS NOT NULL AND tvl > 0
        GROUP BY curator_id
      ),
      ranked AS (
        SELECT pc.*, c.name,
               ROW_NUMBER() OVER (ORDER BY pc.tvl DESC) AS rnk
        FROM per_curator pc LEFT JOIN morpho_.curators c ON c.id = pc.curator_id
      ),
      revenue AS (
        SELECT SUM(GREATEST(
          COALESCE(tvl, 0) * COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)) * (fee_bps::numeric / 10000),
          0
        ))::float8 AS total_rev
        FROM latest_vault
        WHERE tvl IS NOT NULL AND fee_bps IS NOT NULL AND fee_bps > 0
      ),
      vault_total AS (
        SELECT COUNT(*)::int AS c FROM latest_vault WHERE tvl > 0
      ),
      multi_chain AS (
        SELECT COUNT(*)::int AS c FROM per_curator WHERE chains >= 2
      )
      SELECT
        (SELECT COUNT(*)::int FROM per_curator) AS active_curators,
        (SELECT c FROM multi_chain)             AS multi_chain_curators,
        (SELECT tvl::float8 FROM ranked WHERE rnk = 1) AS largest_tvl,
        (SELECT name FROM ranked WHERE rnk = 1)         AS largest_name,
        (SELECT SUM(tvl) FROM per_curator)::float8     AS total_tvl,
        (SELECT total_rev FROM revenue)                 AS total_rev,
        (SELECT c FROM vault_total)                     AS vault_count
    `) as {
      active_curators: number; multi_chain_curators: number;
      largest_tvl: number | null; largest_name: string | null;
      total_tvl: number; total_rev: number | null; vault_count: number;
    }[];
    const r = rows[0]!;
    const total = r.total_tvl ?? 0;
    return {
      activeCurators: r.active_curators,
      multiChainCurators: r.multi_chain_curators,
      largestTvlUsd: r.largest_tvl ?? 0,
      largestShare: total > 0 && r.largest_tvl != null ? r.largest_tvl / total : 0,
      largestCuratorName: r.largest_name,
      totalRevenueUsd: r.total_rev ?? 0,
      vaultCount: r.vault_count,
    };
  },
  [CACHE_VERSION, 'kpis'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorTable = unstable_cache(
  async (): Promise<CuratorTableRow[]> => {
    const sql = getDb();
    const rows = (await sql`
      WITH latest_vault AS (
        SELECT
          v.curator_id, v.chain_id, v.address,
          s.total_assets_usd::float8 AS tvl,
          s.apy::float8 AS apy,
          s.net_apy::float8 AS net_apy,
          s.fee_bps
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd, apy, net_apy, fee_bps
          FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL
      ),
      tvl_90d_ago AS (
        SELECT v.curator_id, SUM(x.total_assets_usd)::float8 AS tvl_90
        FROM morpho_.vaults v
        LEFT JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily y
          WHERE y.chain_id = v.chain_id AND y.vault_address = v.address
            AND y.snapshot_date <= CURRENT_DATE - INTERVAL '90 days'
          ORDER BY y.snapshot_date DESC LIMIT 1
        ) x ON TRUE
        WHERE v.curator_id IS NOT NULL
        GROUP BY v.curator_id
      ),
      agg AS (
        SELECT
          curator_id,
          SUM(tvl)::float8                                   AS total_tvl,
          COUNT(*)::int                                       AS vault_count,
          COUNT(DISTINCT chain_id)::int                       AS chain_count,
          CASE WHEN SUM(tvl) > 0
               THEN (SUM(tvl * net_apy) / SUM(tvl))::float8
               ELSE NULL END                                   AS weighted_net_apy,
          SUM(GREATEST(
            COALESCE(tvl, 0) * COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)) * (fee_bps::numeric / 10000),
            0
          ))::float8                                          AS revenue
        FROM latest_vault
        WHERE tvl IS NOT NULL AND tvl > 0
        GROUP BY curator_id
      ),
      totals AS (
        SELECT SUM(total_tvl)::float8 AS grand_total FROM agg
      )
      SELECT
        a.curator_id,
        c.name, c.image_url, c.verified,
        a.total_tvl, a.vault_count, a.chain_count,
        a.weighted_net_apy, a.revenue,
        (a.total_tvl / NULLIF((SELECT grand_total FROM totals), 0))::float8 AS share,
        CASE WHEN tv.tvl_90 > 0 AND a.total_tvl IS NOT NULL
             THEN ((a.total_tvl - tv.tvl_90) / tv.tvl_90)::float8
             ELSE NULL END AS delta_90d_pct
      FROM agg a
      LEFT JOIN morpho_.curators c ON c.id = a.curator_id
      LEFT JOIN tvl_90d_ago tv     ON tv.curator_id = a.curator_id
      ORDER BY a.total_tvl DESC NULLS LAST
    `) as {
      curator_id: string; name: string | null; image_url: string | null; verified: boolean;
      total_tvl: number; vault_count: number; chain_count: number;
      weighted_net_apy: number | null; revenue: number;
      share: number | null; delta_90d_pct: number | null;
    }[];

    return rows.map((r) => ({
      curatorId: r.curator_id,
      curatorName: r.name ?? r.curator_id,
      imageUrl: r.image_url,
      verified: r.verified ?? false,
      totalTvlUsd: r.total_tvl,
      sharePct: r.share ?? 0,
      vaultCount: r.vault_count,
      chainCount: r.chain_count,
      weightedNetApy: r.weighted_net_apy,
      estAnnualRevenueUsd: r.revenue,
      delta90dPct: r.delta_90d_pct,
      isUnattributed: false,
    }));
  },
  [CACHE_VERSION, 'table'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorShareStack = unstable_cache(
  async (scope: 'all' | 'ethereum'): Promise<ShareStackSlice[]> => {
    const sql = getDb();
    const palette = [
      '#6b85ff','#34d399','#fbbf24','#b97aff','#38bdf8','#ff8155','#f472b6','#818cf8','#10b981','#a78bfa',
    ];
    const chainId = scope === 'ethereum' ? 1 : null;
    const rows = (await sql`
      WITH latest_vault AS (
        SELECT v.curator_id, v.chain_id, s.total_assets_usd::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL
          AND s.total_assets_usd IS NOT NULL AND s.total_assets_usd > 0
          AND (${chainId}::int IS NULL OR v.chain_id = ${chainId}::int)
      ),
      per_curator AS (
        SELECT curator_id, SUM(tvl)::float8 AS tvl
        FROM latest_vault GROUP BY curator_id
      )
      SELECT pc.curator_id, c.name, pc.tvl
      FROM per_curator pc
      LEFT JOIN morpho_.curators c ON c.id = pc.curator_id
      ORDER BY pc.tvl DESC
    `) as { curator_id: string; name: string | null; tvl: number }[];

    const total = rows.reduce((s, r) => s + r.tvl, 0);
    const top = rows.slice(0, 10);
    const others = rows.slice(10);
    const othersTvl = others.reduce((s, r) => s + r.tvl, 0);

    const slices: ShareStackSlice[] = top.map((r, i) => ({
      curatorId: r.curator_id,
      curatorName: r.name ?? r.curator_id,
      tvlUsd: r.tvl,
      sharePct: total > 0 ? r.tvl / total : 0,
      color: palette[i % palette.length]!,
    }));
    if (othersTvl > 0) {
      slices.push({
        curatorId: null,
        curatorName: 'OTHERS',
        tvlUsd: othersTvl,
        sharePct: total > 0 ? othersTvl / total : 0,
        color: 'hsla(0, 0%, 100%, 0.22)',
      });
    }
    return slices;
  },
  [CACHE_VERSION, 'share-stack'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorReachMatrix = unstable_cache(
  async (curatorN = 10, chainN = 8): Promise<{
    curators: { id: string; name: string }[];
    chains: { slug: string; name: string }[];
    cells: ReachMatrixCell[];
    maxTvl: number;
  }> => {
    const sql = getDb();

    const topCurators = (await sql`
      WITH latest_vault AS (
        SELECT v.curator_id, s.total_assets_usd::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL AND s.total_assets_usd > 0
      )
      SELECT lv.curator_id AS id, c.name
      FROM latest_vault lv LEFT JOIN morpho_.curators c ON c.id = lv.curator_id
      GROUP BY lv.curator_id, c.name
      ORDER BY SUM(lv.tvl) DESC
      LIMIT ${curatorN}
    `) as { id: string; name: string | null }[];

    const topChains = (await sql`
      SELECT DISTINCT ON (slug)
        slug AS chain_slug, name AS chain_name, chain_id
      FROM morpho_.chains
      WHERE chain_id IN (
        SELECT chain_id FROM (
          SELECT v.chain_id, SUM(s.total_assets_usd) AS tvl
          FROM morpho_.vaults v
          JOIN LATERAL (
            SELECT total_assets_usd FROM morpho_.vault_state_daily x
            WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
            ORDER BY x.snapshot_date DESC LIMIT 1
          ) s ON TRUE
          GROUP BY v.chain_id
          ORDER BY tvl DESC NULLS LAST
          LIMIT ${chainN}
        ) x
      )
      ORDER BY slug
    `) as { chain_slug: string; chain_name: string; chain_id: number }[];

    const curatorIds = topCurators.map((c) => c.id);
    const chainIds = topChains.map((c) => c.chain_id);
    const cellsRaw = (await sql`
      WITH latest_vault AS (
        SELECT v.curator_id, v.chain_id, s.total_assets_usd::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id = ANY(${curatorIds}::text[])
          AND v.chain_id   = ANY(${chainIds}::int[])
          AND s.total_assets_usd > 0
      )
      SELECT curator_id, chain_id, SUM(tvl)::float8 AS tvl
      FROM latest_vault
      GROUP BY curator_id, chain_id
    `) as { curator_id: string; chain_id: number; tvl: number }[];

    const chainById = new Map(topChains.map((c) => [c.chain_id, c]));
    const cells: ReachMatrixCell[] = cellsRaw.map((r) => {
      const ch = chainById.get(r.chain_id);
      return {
        curatorId: r.curator_id,
        curatorName: topCurators.find((c) => c.id === r.curator_id)?.name ?? r.curator_id,
        chainSlug: ch?.chain_slug ?? '',
        chainName: ch?.chain_name ?? '',
        tvlUsd: r.tvl,
      };
    });
    const maxTvl = cells.reduce((m, c) => Math.max(m, c.tvlUsd), 0);

    return {
      curators: topCurators.map((c) => ({ id: c.id, name: c.name ?? c.id })),
      chains: topChains.map((c) => ({ slug: c.chain_slug, name: c.chain_name })),
      cells,
      maxTvl,
    };
  },
  [CACHE_VERSION, 'reach'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorRevenueLeaderboard = unstable_cache(
  async (n = 5): Promise<RevenueLeaderboardRow[]> => {
    const sql = getDb();
    // Attribution: fee_recipient_address → curator_addresses → curator_id.
    // Vaults whose fee_recipient doesn't match a known curator address get
    // bucketed into UNATTRIBUTED. Revenue isn't dropped — surfaced separately.
    const rows = (await sql`
      WITH latest_vault AS (
        SELECT v.chain_id, v.address, v.fee_recipient_address,
               s.total_assets_usd::float8 AS tvl,
               s.apy::float8 AS apy,
               s.net_apy::float8 AS net_apy,
               s.fee_bps
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd, apy, net_apy, fee_bps
          FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
      ),
      attributed AS (
        SELECT
          lv.tvl, lv.apy, lv.net_apy, lv.fee_bps,
          (
            SELECT ca.curator_id FROM morpho_.curator_addresses ca
            WHERE LOWER(ca.address) = LOWER(lv.fee_recipient_address)
              AND (ca.chain_id IS NULL OR ca.chain_id = lv.chain_id)
            LIMIT 1
          ) AS revenue_curator
        FROM latest_vault lv
        WHERE lv.tvl IS NOT NULL AND lv.tvl > 0
          AND lv.fee_bps IS NOT NULL AND lv.fee_bps > 0
      ),
      with_rev AS (
        SELECT revenue_curator,
               GREATEST(
                 tvl * COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)) * (fee_bps::numeric / 10000),
                 0
               )::float8 AS rev
        FROM attributed
      ),
      grouped AS (
        SELECT revenue_curator AS id, SUM(rev)::float8 AS rev
        FROM with_rev GROUP BY revenue_curator
      ),
      total AS (SELECT SUM(rev)::float8 AS t FROM grouped)
      SELECT
        g.id, c.name, g.rev,
        (g.rev / NULLIF((SELECT t FROM total), 0))::float8 AS share
      FROM grouped g
      LEFT JOIN morpho_.curators c ON c.id = g.id
      ORDER BY g.rev DESC NULLS LAST
    `) as { id: string | null; name: string | null; rev: number; share: number | null }[];

    const out: RevenueLeaderboardRow[] = [];
    for (const r of rows) {
      if (r.id) {
        out.push({
          curatorId: r.id,
          curatorName: r.name ?? r.id,
          estAnnualRevenueUsd: r.rev,
          sharePct: r.share ?? 0,
          isUnattributed: false,
        });
      }
    }
    const unattributed = rows.find((r) => r.id == null);
    const top = out.slice(0, n);
    if (unattributed) {
      top.push({
        curatorId: null,
        curatorName: 'UNATTRIBUTED',
        estAnnualRevenueUsd: unattributed.rev,
        sharePct: unattributed.share ?? 0,
        isUnattributed: true,
      });
    }
    return top;
  },
  [CACHE_VERSION, 'rev-leaderboard'],
  { revalidate: TTL, tags: ['curators'] },
);

// ---------- Detail queries ----------

async function resolveCurator(slug: string) {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, name, description, image_url, url, verified
    FROM morpho_.curators
    WHERE LOWER(id) = LOWER(${slug})
    LIMIT 1
  `) as { id: string; name: string; description: string | null; image_url: string | null; url: string | null; verified: boolean }[];
  return rows[0] ?? null;
}

export const getCuratorDetail = unstable_cache(
  async (slug: string): Promise<CuratorDetail | null> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return null;
    const rows = (await sql`
      WITH latest_vault AS (
        SELECT v.curator_id, v.chain_id, s.total_assets_usd::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL AND s.total_assets_usd > 0
      ),
      ranked AS (
        SELECT curator_id, SUM(tvl) AS total_tvl,
               COUNT(*)::int AS vc, COUNT(DISTINCT chain_id)::int AS cc,
               ROW_NUMBER() OVER (ORDER BY SUM(tvl) DESC) AS rnk,
               COUNT(*) OVER ()::int AS total_curators
        FROM latest_vault GROUP BY curator_id
      )
      SELECT total_tvl::float8 tvl, vc, cc, rnk::int rank, total_curators
      FROM ranked WHERE curator_id = ${c.id}
    `) as { tvl: number; vc: number; cc: number; rank: number; total_curators: number }[];
    const r = rows[0];
    return {
      curatorId: c.id,
      curatorName: c.name,
      imageUrl: c.image_url,
      url: c.url,
      description: c.description,
      verified: c.verified,
      vaultCount: r?.vc ?? 0,
      chainCount: r?.cc ?? 0,
      totalTvlUsd: r?.tvl ?? 0,
      rank: r?.rank ?? 0,
      totalCurators: r?.total_curators ?? 0,
    };
  },
  [CACHE_VERSION, 'detail'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorKpis = unstable_cache(
  async (slug: string): Promise<CuratorKpis | null> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return null;
    const rows = (await sql`
      WITH latest_vault AS (
        SELECT v.chain_id, v.address, v.created_at,
               s.total_assets_usd::float8 AS tvl,
               s.apy::float8 AS apy,
               s.net_apy::float8 AS net_apy,
               s.fee_bps
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd, apy, net_apy, fee_bps
          FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id = ${c.id}
      ),
      v30 AS (
        SELECT SUM(x.total_assets_usd)::float8 AS tvl
        FROM morpho_.vaults v
        LEFT JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily y
          WHERE y.chain_id = v.chain_id AND y.vault_address = v.address
            AND y.snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY y.snapshot_date DESC LIMIT 1
        ) x ON TRUE
        WHERE v.curator_id = ${c.id}
      ),
      grand AS (
        SELECT SUM(s.total_assets_usd)::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL
      ),
      grand30 AS (
        SELECT SUM(x.total_assets_usd)::float8 AS tvl
        FROM morpho_.vaults v
        LEFT JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily y
          WHERE y.chain_id = v.chain_id AND y.vault_address = v.address
            AND y.snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY y.snapshot_date DESC LIMIT 1
        ) x ON TRUE
        WHERE v.curator_id IS NOT NULL
      ),
      added AS (
        SELECT COUNT(*)::int AS c FROM morpho_.vaults
        WHERE curator_id = ${c.id} AND created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT
        (SELECT SUM(tvl)::float8 FROM latest_vault)                  AS tvl,
        (SELECT COUNT(*)::int    FROM latest_vault)                  AS vc,
        (SELECT tvl::float8      FROM v30)                            AS tvl_30,
        (SELECT tvl::float8      FROM grand)                          AS grand,
        (SELECT tvl::float8      FROM grand30)                        AS grand_30,
        (SELECT c                FROM added)                          AS added,
        (
          SELECT CASE WHEN SUM(tvl) > 0
                      THEN (SUM(tvl * net_apy) / SUM(tvl))::float8
                      ELSE NULL END
          FROM latest_vault WHERE tvl > 0
        ) AS wapy,
        (
          SELECT SUM(GREATEST(
            tvl * COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)) * (fee_bps::numeric / 10000),
            0
          ))::float8
          FROM latest_vault WHERE tvl > 0 AND fee_bps > 0
        ) AS rev
    `) as {
      tvl: number | null; vc: number;
      tvl_30: number | null; grand: number | null; grand_30: number | null;
      added: number; wapy: number | null; rev: number | null;
    }[];
    const r = rows[0]!;
    const share = r.tvl && r.grand ? r.tvl / r.grand : 0;
    const share30 = r.tvl_30 != null && r.grand_30 ? r.tvl_30 / r.grand_30 : null;
    return {
      totalTvlUsd: r.tvl ?? 0,
      tvl30dAgoUsd: r.tvl_30,
      share,
      share30dAgo: share30,
      vaultCount: r.vc,
      vaultsAdded30d: r.added,
      weightedNetApy: r.wapy,
      estAnnualRevenueUsd: r.rev ?? 0,
    };
  },
  [CACHE_VERSION, 'kpis-detail'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorTvlByChain = unstable_cache(
  async (slug: string, days = 365): Promise<{ chains: { slug: string; name: string; color: string }[]; series: CuratorTvlChainPoint[] }> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return { chains: [], series: [] };
    const palette = ['#6b85ff','#34d399','#fbbf24','#b97aff','#38bdf8','#ff8155','#f472b6','#818cf8'];
    const rows = (await sql`
      WITH vaults_of_curator AS (
        SELECT chain_id, address FROM morpho_.vaults WHERE curator_id = ${c.id}
      ),
      per_day AS (
        SELECT s.snapshot_date::text AS date,
               s.chain_id,
               SUM(s.total_assets_usd)::float8 AS tvl
        FROM morpho_.vault_state_daily s
        JOIN vaults_of_curator v ON v.chain_id = s.chain_id AND v.address = s.vault_address
        WHERE s.snapshot_date >= CURRENT_DATE - (${days}::int || ' days')::interval
        GROUP BY s.snapshot_date, s.chain_id
      )
      SELECT pd.date, pd.chain_id, ch.slug AS chain_slug, ch.name AS chain_name, pd.tvl
      FROM per_day pd
      LEFT JOIN morpho_.chains ch ON ch.chain_id = pd.chain_id
      ORDER BY pd.date ASC
    `) as { date: string; chain_id: number; chain_slug: string; chain_name: string; tvl: number }[];

    const chainSet = new Map<string, { slug: string; name: string }>();
    const byDate = new Map<string, CuratorTvlChainPoint>();
    for (const r of rows) {
      if (!chainSet.has(r.chain_slug)) chainSet.set(r.chain_slug, { slug: r.chain_slug, name: r.chain_name });
      let p = byDate.get(r.date);
      if (!p) { p = { date: r.date }; byDate.set(r.date, p); }
      p[r.chain_slug] = r.tvl;
    }
    const chains = [...chainSet.values()].map((c, i) => ({ ...c, color: palette[i % palette.length]! }));
    return { chains, series: [...byDate.values()] };
  },
  [CACHE_VERSION, 'tvl-chain'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorVaults = unstable_cache(
  async (slug: string): Promise<CuratorVaultRow[]> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return [];
    const rows = (await sql`
      SELECT
        v.chain_id, ch.slug AS chain_slug, v.address, v.name, v.asset_symbol,
        s.total_assets_usd::float8 AS tvl,
        s.net_apy::float8           AS net_apy,
        s.fee_bps,
        -- Weighted utilization across this vault's allocations isn't computable
        -- without vault_allocations_daily (empty); use NULL.
        NULL::float8 AS utilization
      FROM morpho_.vaults v
      LEFT JOIN morpho_.chains ch ON ch.chain_id = v.chain_id
      JOIN LATERAL (
        SELECT total_assets_usd, net_apy, fee_bps
        FROM morpho_.vault_state_daily x
        WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
        ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE v.curator_id = ${c.id}
      ORDER BY s.total_assets_usd DESC NULLS LAST
    `) as {
      chain_id: number; chain_slug: string | null; address: string;
      name: string | null; asset_symbol: string | null;
      tvl: number | null; net_apy: number | null; fee_bps: number | null;
      utilization: number | null;
    }[];

    return rows.map((r) => ({
      chainId: r.chain_id,
      chainSlug: r.chain_slug,
      address: r.address,
      name: r.name,
      assetSymbol: r.asset_symbol,
      tvlUsd: r.tvl ?? 0,
      netApy: r.net_apy,
      feeBps: r.fee_bps,
      utilization: r.utilization,
    }));
  },
  [CACHE_VERSION, 'vaults-detail'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorAllocationByAssetClass = unstable_cache(
  async (slug: string): Promise<CuratorAssetMixSlice[]> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return [];
    // Proxy: aggregate vault TVL by the vault's underlying asset class.
    // (True allocation-level mix needs vault_allocations_daily — currently empty.)
    const rows = (await sql`
      WITH vault_latest AS (
        SELECT v.asset_symbol AS sym, s.total_assets_usd::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id = ${c.id} AND s.total_assets_usd > 0
      ),
      with_cat AS (
        SELECT sym, ${ASSET_CATEGORY_CASE} AS category, tvl FROM vault_latest
      ),
      by_cat AS (
        SELECT category, SUM(tvl)::float8 AS tvl FROM with_cat GROUP BY category
      ),
      top_sym AS (
        SELECT DISTINCT ON (category)
          category, sym, SUM(tvl) OVER (PARTITION BY category, sym)::float8 AS sym_tvl
        FROM with_cat
        ORDER BY category, sym_tvl DESC
      )
      SELECT b.category, b.tvl, t.sym AS top_symbol
      FROM by_cat b LEFT JOIN top_sym t USING (category)
      ORDER BY b.tvl DESC
    `) as { category: string; tvl: number; top_symbol: string | null }[];
    return rows.map((r) => ({ category: r.category, tvlUsd: r.tvl, topSymbol: r.top_symbol }));
  },
  [CACHE_VERSION, 'allocation-class'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorPerformanceVsMarket = unstable_cache(
  async (slug: string, days = 90): Promise<PerfPoint[]> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return [];
    const rows = (await sql`
      WITH cur_daily AS (
        SELECT s.snapshot_date::text AS date,
               CASE WHEN SUM(s.total_assets_usd) > 0
                    THEN (SUM(s.total_assets_usd * s.net_apy) / SUM(s.total_assets_usd))::float8
                    ELSE NULL END AS net_apy
        FROM morpho_.vault_state_daily s
        JOIN morpho_.vaults v ON v.chain_id = s.chain_id AND v.address = s.vault_address
        WHERE v.curator_id = ${c.id}
          AND s.snapshot_date >= CURRENT_DATE - (${days}::int || ' days')::interval
        GROUP BY s.snapshot_date
      ),
      market_daily AS (
        SELECT s.snapshot_date::text AS date,
               CASE WHEN SUM(s.total_assets_usd) > 0
                    THEN (SUM(s.total_assets_usd * s.net_apy) / SUM(s.total_assets_usd))::float8
                    ELSE NULL END AS net_apy
        FROM morpho_.vault_state_daily s
        WHERE s.snapshot_date >= CURRENT_DATE - (${days}::int || ' days')::interval
        GROUP BY s.snapshot_date
      )
      SELECT m.date,
             c.net_apy AS curator_net_apy,
             m.net_apy AS morpho_net_apy
      FROM market_daily m LEFT JOIN cur_daily c USING (date)
      ORDER BY m.date ASC
    `) as { date: string; curator_net_apy: number | null; morpho_net_apy: number | null }[];

    return rows.map((r) => ({
      date: r.date,
      curatorNetApy: r.curator_net_apy,
      morphoNetApy: r.morpho_net_apy,
    }));
  },
  [CACHE_VERSION, 'perf-vs-market'],
  { revalidate: TTL, tags: ['curators'] },
);
