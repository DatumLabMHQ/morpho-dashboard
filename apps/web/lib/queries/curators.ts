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
// MarketState.apy field. See packages/core/src/sources/morpho-graphql.ts).
// fee_bps is the vault's current performance fee.
//
// Allocation-level data is empty until /backfill/tick?job=vault-allocations
// drains. The "asset class" mix uses vault.asset_symbol as a coarse proxy.

import { unstable_cache } from 'next/cache';

import { type AssetClass, ASSET_CLASS_ORDER, categorizeAsset } from '../assets/asset-class.js';
import { tokens } from '../brand/tokens.js';
import { getDb } from '../db.js';

const CACHE_VERSION = 'curators-v2';
const TTL = 900;

// Degenerate-IRM vaults (APY > 100%) report bad data that distorts every
// AUM-weighted figure; every query below inlines the literal filter
//   (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
// to exclude them (methodology locked in Part A. Same as bad-oracle markets on
// /chains). Inlined literally because neon parameter-binds interpolated strings.

function growth30d(now: number, ago: number | null): number | null {
  if (ago == null || ago <= 0) return null;
  return (now - ago) / ago;
}
/** AUM doubling time in days: 30 × ln2 / ln(1+rate). null if shrinking. */
function doublingTimeDays(rate: number | null): number | null {
  if (rate == null || rate <= 0) return null;
  const d = (Math.log(2) / Math.log(1 + rate)) * 30;
  return Number.isFinite(d) && d > 0 ? d : null;
}

// ---------- Types ----------

export interface DirectoryHeader {
  activeCurators: number;
  totalCuratedTvlUsd: number;
  chainCount: number;
  asOfDate: string;
}

export interface ConcentrationStats {
  cr3: number;          // 0..1. Top-3 share of curated TVL
  cr5: number;          // 0..1. Top-5 share
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
  estAnnualRevenueUsd: number;          // curator fees (annualized)
  borrowInterestCapturedUsd: number;    // Σ tvl × pre-fee APY (annualized)
  feeTakeRate: number | null;           // fees ÷ borrow interest captured
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

export interface CuratorVaultPerfRow {
  chainId: number;
  chainSlug: string | null;
  address: string;
  name: string | null;
  assetSymbol: string | null;
  aumUsd: number;
  netApy: number | null;
  feeBps: number | null;
  feeTakeRate: number | null;        // per-vault = fee fraction
  borrowInterestUsd: number;         // tvl × pre-fee APY
  aum30dDeltaPct: number | null;
}

export interface LoanBookAssetRow {
  assetSymbol: string;
  aumUsd: number;
  vaultCount: number;
  chainCount: number;
}

export interface FeeStructurePoint {
  name: string;
  feeBps: number | null;
  tvlUsd: number;
  netApy: number | null;
}

export interface VsSectorRow {
  chainSlug: string;
  chainName: string;
  curatorNetApy: number | null;
  sectorNetApy: number | null;
  spreadBps: number | null;
}

export interface WeeklyInflowPoint {
  weekStart: string;
  netChangeUsd: number;
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
        -- Exclude degenerate-IRM vaults entirely (APY > 100% ⇒ bad data that
        -- also distorts AUM-weighted figures). Consistent with /chains.
        WHERE (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
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
        -- APY clamped at 100% per vault: degenerate-IRM markets (e.g. some
        -- CLEARSTAR allocations) report 1000%+ APYs that otherwise compound the
        -- est-revenue sum into the billions. LEAST wraps the effective pre-fee
        -- APY regardless of whether it comes from apy or net_apy/(1-fee).
        SELECT SUM(GREATEST(
          COALESCE(tvl, 0) * LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)), 1.0) * (fee_bps::numeric / 10000),
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
          AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
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
               THEN (SUM(tvl * LEAST(net_apy, 1.0)) / SUM(tvl))::float8
               ELSE NULL END                                   AS weighted_net_apy,
          SUM(GREATEST(
            COALESCE(tvl, 0) * LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)), 1.0) * (fee_bps::numeric / 10000),
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
      '#6b85ff','#34d399','#fbbf24','#b97aff','#38bdf8','#74adff','#f472b6','#818cf8','#10b981','#a78bfa',
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

    const curatorIds = topCurators.map((c) => c.id);

    // Columns = the chains where the displayed (top-N) curators actually operate,
    // ranked by those curators' summed TVL. Ranking by the displayed curators
    // rather than by global vault TVL guarantees every column carries at least
    // one value: a chain only appears if a shown curator has TVL there. This is
    // what drops Worldchain, whose vaults are all unattributed (curator_id NULL)
    // and therefore can never populate a named-curator row.
    const topChains = (await sql`
      WITH lv AS (
        SELECT v.chain_id, s.total_assets_usd::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id = ANY(${curatorIds}::text[]) AND s.total_assets_usd > 0
      ),
      ranked AS (
        SELECT chain_id, SUM(tvl) AS tvl
        FROM lv GROUP BY chain_id
        ORDER BY tvl DESC NULLS LAST
        LIMIT ${chainN}
      )
      SELECT ch.slug AS chain_slug, ch.name AS chain_name, ch.chain_id
      FROM ranked r JOIN morpho_.chains ch ON ch.chain_id = r.chain_id
      ORDER BY r.tvl DESC
    `) as { chain_slug: string; chain_name: string; chain_id: number }[];

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
    // bucketed into UNATTRIBUTED. Revenue isn't dropped. Surfaced separately.
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
        WHERE (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
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
                 tvl * LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)), 1.0) * (fee_bps::numeric / 10000),
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
          AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
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
            tvl * LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)), 1.0) * (fee_bps::numeric / 10000),
            0
          ))::float8
          FROM latest_vault WHERE tvl > 0 AND fee_bps > 0
        ) AS rev,
        (
          SELECT SUM(GREATEST(
            tvl * LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)), 1.0),
            0
          ))::float8
          FROM latest_vault WHERE tvl > 0
        ) AS borrow_interest
    `) as {
      tvl: number | null; vc: number;
      tvl_30: number | null; grand: number | null; grand_30: number | null;
      added: number; wapy: number | null; rev: number | null; borrow_interest: number | null;
    }[];
    const r = rows[0]!;
    const share = r.tvl && r.grand ? r.tvl / r.grand : 0;
    const share30 = r.tvl_30 != null && r.grand_30 ? r.tvl_30 / r.grand_30 : null;
    const bi = r.borrow_interest ?? 0;
    return {
      totalTvlUsd: r.tvl ?? 0,
      tvl30dAgoUsd: r.tvl_30,
      share,
      share30dAgo: share30,
      vaultCount: r.vc,
      vaultsAdded30d: r.added,
      weightedNetApy: r.wapy,
      estAnnualRevenueUsd: r.rev ?? 0,
      borrowInterestCapturedUsd: bi,
      feeTakeRate: bi > 0 ? (r.rev ?? 0) / bi : null,
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
    const palette = ['#6b85ff','#34d399','#fbbf24','#b97aff','#38bdf8','#74adff','#f472b6','#818cf8'];
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
    // Proxy: aggregate vault TVL by the vault's underlying asset class. Bucketing
    // is done in JS (categorizeAsset). The SQL CASE approach is unusable because
    // neon parameter-binds interpolated strings. (True allocation-level mix needs
    // vault_allocations_daily. Currently empty.) Degenerate vaults excluded.
    const rows = (await sql`
      SELECT v.asset_symbol AS sym, s.total_assets_usd::float8 AS tvl
      FROM morpho_.vaults v
      JOIN LATERAL (
        SELECT total_assets_usd, apy, net_apy FROM morpho_.vault_state_daily x
        WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
        ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE v.curator_id = ${c.id} AND s.total_assets_usd > 0
        AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
    `) as { sym: string | null; tvl: number }[];

    const byCat = new Map<string, number>();
    const topSym = new Map<string, { sym: string; usd: number }>();
    for (const r of rows) {
      const cat = categorizeAsset(r.sym);
      byCat.set(cat, (byCat.get(cat) ?? 0) + r.tvl);
      const cur = topSym.get(cat);
      if (!cur || r.tvl > cur.usd) topSym.set(cat, { sym: r.sym ?? 'N/A', usd: r.tvl });
    }
    return [...byCat.entries()]
      .map(([category, tvlUsd]) => ({ category, tvlUsd, topSymbol: topSym.get(category)?.sym ?? null }))
      .sort((a, b) => b.tvlUsd - a.tvlUsd);
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

// ===========================================================================
// PART B. Asset-manager framing for the /curators redesign.
//
// Metric vocabulary (canonical):
//   AUM                        = Σ vault TVL (total_assets_usd)
//   Borrow Interest Captured   = Σ tvl × pre-fee APY (annualized)
//   Curator Fees (annualized)  = Σ tvl × pre-fee APY × fee
//   Lender Yield Delivered     = Σ tvl × net_apy
//   Fee Take Rate              = curator fees ÷ borrow interest captured
//   Net APY Delivered          = AUM-weighted net_apy
// Degenerate-IRM vaults (APY > 100%) are EXCLUDED from every aggregation.
// ===========================================================================

// Pre-fee APY clamped at 100%, derived from apy or net_apy/(1-fee). Inlined
// literally in each query (neon param-binds interpolated strings, so it can't
// be a `${const}`):
//   LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)), 1.0)
const LB_CACHE = 'curators-assetmgr-v2';

export interface CuratorEconomics {
  curatorId: string;
  name: string;
  aum: number;
  borrowInterestCaptured: number;   // annualized
  curatorFees: number;              // annualized
  feeTakeRate: number | null;       // fees ÷ borrow interest captured
  netApyDelivered: number | null;   // AUM-weighted net_apy
  vaultCount: number;
  chainCount: number;
  aum30dAgo: number | null;
  aum30dDeltaPct: number | null;
  doublingTimeDays: number | null;
}

export const getCuratorEconomics = unstable_cache(
  async (): Promise<CuratorEconomics[]> => {
    const sql = getDb();
    const rows = (await sql`
      WITH lv AS (
        SELECT v.curator_id, v.chain_id,
               s.total_assets_usd::float8 AS tvl, s.apy::float8 AS apy, s.net_apy::float8 AS net_apy, s.fee_bps
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd, apy, net_apy, fee_bps FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL
          AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
      ),
      lv30 AS (
        SELECT v.curator_id, x.total_assets_usd::float8 AS tvl
        FROM morpho_.vaults v
        LEFT JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily y
          WHERE y.chain_id = v.chain_id AND y.vault_address = v.address
            AND y.snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY y.snapshot_date DESC LIMIT 1
        ) x ON TRUE
        WHERE v.curator_id IS NOT NULL
      ),
      prev AS (SELECT curator_id, SUM(tvl)::float8 AS aum30 FROM lv30 GROUP BY curator_id),
      agg AS (
        SELECT curator_id,
          SUM(tvl)::float8 AS aum,
          COUNT(*)::int AS vaults,
          COUNT(DISTINCT chain_id)::int AS chains,
          CASE WHEN SUM(tvl) > 0 THEN (SUM(tvl * net_apy) / SUM(tvl))::float8 ELSE NULL END AS net_apy,
          SUM(GREATEST(tvl * LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)), 1.0), 0))::float8 AS borrow_interest,
          SUM(GREATEST(tvl * LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric / 10000), 0)), 1.0) * (fee_bps::numeric / 10000), 0))::float8 AS fees
        FROM lv WHERE tvl > 0 GROUP BY curator_id
      )
      SELECT a.curator_id, c.name, a.aum, a.vaults, a.chains, a.net_apy, a.borrow_interest, a.fees, prev.aum30
      FROM agg a LEFT JOIN morpho_.curators c ON c.id = a.curator_id
      LEFT JOIN prev ON prev.curator_id = a.curator_id
      ORDER BY a.aum DESC
    `) as {
      curator_id: string; name: string | null; aum: number; vaults: number; chains: number;
      net_apy: number | null; borrow_interest: number; fees: number; aum30: number | null;
    }[];
    return rows.map((r) => {
      const delta = growth30d(r.aum, r.aum30);
      return {
        curatorId: r.curator_id,
        name: r.name ?? r.curator_id,
        aum: r.aum,
        borrowInterestCaptured: r.borrow_interest,
        curatorFees: r.fees,
        feeTakeRate: r.borrow_interest > 0 ? r.fees / r.borrow_interest : null,
        netApyDelivered: r.net_apy,
        vaultCount: r.vaults,
        chainCount: r.chains,
        aum30dAgo: r.aum30,
        aum30dDeltaPct: delta,
        doublingTimeDays: doublingTimeDays(delta),
      };
    });
  },
  [LB_CACHE, 'economics'],
  { revalidate: TTL, tags: ['curators'] },
);

// ---------- Structural identity (AUM by asset class, JS-categorized) ----------

export interface CuratorClassCell { assetClass: AssetClass; usd: number; pct: number; }
export interface CuratorStructuralRow {
  curatorId: string; name: string; aum: number;
  byClass: Record<AssetClass, CuratorClassCell>;
  dominantClass: AssetClass; dominantPct: number;
}

async function loadCuratorAssetRows(sql: ReturnType<typeof getDb>): Promise<{ curator_id: string; symbol: string | null; tvl: number }[]> {
  return (await sql`
    SELECT v.curator_id, v.asset_symbol AS symbol, s.total_assets_usd::float8 AS tvl
    FROM morpho_.vaults v
    JOIN LATERAL (
      SELECT total_assets_usd, apy, net_apy FROM morpho_.vault_state_daily x
      WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1
    ) s ON TRUE
    WHERE v.curator_id IS NOT NULL AND s.total_assets_usd > 0
      AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
  `) as { curator_id: string; symbol: string | null; tvl: number }[];
}

function emptyClassRec(): Record<AssetClass, CuratorClassCell> {
  const r = {} as Record<AssetClass, CuratorClassCell>;
  for (const c of ASSET_CLASS_ORDER) r[c] = { assetClass: c, usd: 0, pct: 0 };
  return r;
}

export const getCuratorStructuralIdentityMatrix = unstable_cache(
  async (topN = 15): Promise<CuratorStructuralRow[]> => {
    const sql = getDb();
    const [assetRows, econ] = await Promise.all([loadCuratorAssetRows(sql), getCuratorEconomics()]);
    const nameById = new Map(econ.map((e) => [e.curatorId, e.name] as const));
    const byCurator = new Map<string, Record<AssetClass, CuratorClassCell>>();
    for (const r of assetRows) {
      if (!byCurator.has(r.curator_id)) byCurator.set(r.curator_id, emptyClassRec());
      byCurator.get(r.curator_id)![categorizeAsset(r.symbol)].usd += r.tvl;
    }
    const out: CuratorStructuralRow[] = [];
    for (const e of econ.slice(0, topN)) {
      const rec = byCurator.get(e.curatorId) ?? emptyClassRec();
      const total = ASSET_CLASS_ORDER.reduce((s, c) => s + rec[c].usd, 0);
      let dominantClass: AssetClass = 'other'; let dominantPct = 0;
      for (const c of ASSET_CLASS_ORDER) {
        rec[c].pct = total > 0 ? rec[c].usd / total : 0;
        if (rec[c].pct > dominantPct) { dominantPct = rec[c].pct; dominantClass = c; }
      }
      out.push({ curatorId: e.curatorId, name: nameById.get(e.curatorId) ?? e.curatorId, aum: e.aum, byClass: rec, dominantClass, dominantPct });
    }
    return out;
  },
  [LB_CACHE, 'structural'],
  { revalidate: TTL, tags: ['curators'] },
);

// ---------- Headline KPIs (6 superlatives) ----------

export interface CuratorSuperlative { key: string; label: string; curatorId: string | null; curatorName: string | null; caption: string; }

export const getCuratorsHeadlineKpis = unstable_cache(
  async (): Promise<CuratorSuperlative[]> => {
    const econ = await getCuratorEconomics();
    if (econ.length === 0) return [];
    const totalAum = econ.reduce((s, e) => s + e.aum, 0);
    const usd = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(v);
    const pick = (val: (e: CuratorEconomics) => number | null) => {
      let best: CuratorEconomics | null = null; let bv = -Infinity;
      for (const e of econ) { const v = val(e); if (v != null && Number.isFinite(v) && v > bv) { bv = v; best = e; } }
      return best;
    };
    const largest = econ[0]!;
    const topInterest = pick((e) => e.borrowInterestCaptured);
    // take rate / net apy: require non-trivial AUM so a dust curator can't win
    const material = econ.filter((e) => e.aum >= 5_000_000);
    const topTake = (material.length ? material : econ).reduce<CuratorEconomics | null>((b, e) => (e.feeTakeRate != null && (b == null || (e.feeTakeRate ?? 0) > (b.feeTakeRate ?? 0)) ? e : b), null);
    const topNet = (material.length ? material : econ).reduce<CuratorEconomics | null>((b, e) => (e.netApyDelivered != null && (b == null || (e.netApyDelivered ?? 0) > (b.netApyDelivered ?? 0)) ? e : b), null);
    const topChains = pick((e) => e.chainCount);
    const fastest = pick((e) => e.aum30dDeltaPct);
    const card = (key: string, label: string, e: CuratorEconomics | null, caption: string): CuratorSuperlative =>
      ({ key, label, curatorId: e?.curatorId ?? null, curatorName: e?.name ?? null, caption });
    return [
      card('largest-aum', 'Largest AUM', largest, `${usd(largest.aum)} · ${(totalAum > 0 ? (largest.aum / totalAum) * 100 : 0).toFixed(1)}% of Morpho-wide`),
      card('highest-borrow-interest', 'Highest Borrow Interest Captured', topInterest, topInterest ? `${usd(topInterest.borrowInterestCaptured)} annualized` : 'N/A'),
      card('highest-take-rate', 'Highest Fee Take Rate', topTake, topTake?.feeTakeRate != null ? `${(topTake.feeTakeRate * 100).toFixed(1)}% of interest kept` : 'N/A'),
      card('highest-net-apy', 'Highest Net APY Delivered', topNet, topNet?.netApyDelivered != null ? `${(topNet.netApyDelivered * 100).toFixed(2)}% to depositors` : 'N/A'),
      card('most-multichain', 'Most Multi-Chain', topChains, topChains ? `${topChains.chainCount} chains` : 'N/A'),
      card('fastest-growth', 'Fastest AUM Growth 30d', fastest, fastest?.aum30dDeltaPct != null ? `+${(fastest.aum30dDeltaPct * 100).toFixed(1)}% over 30d` : 'no baseline'),
    ];
  },
  [LB_CACHE, 'headline-kpis'],
  { revalidate: TTL, tags: ['curators'] },
);

// ---------- Performance scatter ----------

export interface CuratorScatterPoint {
  curatorId: string; name: string; feeTakeRate: number; netApyDelivered: number; aum: number; assetClass: AssetClass; label: boolean;
}

export const getCuratorPerformanceScatter = unstable_cache(
  async (): Promise<CuratorScatterPoint[]> => {
    const [econ, structural] = await Promise.all([getCuratorEconomics(), getCuratorStructuralIdentityMatrix(50)]);
    const classById = new Map(structural.map((s) => [s.curatorId, s.dominantClass] as const));
    const labelIds = new Set(econ.slice(0, 5).map((e) => e.curatorId));
    return econ
      .filter((e) => e.feeTakeRate != null && e.netApyDelivered != null && e.aum > 0)
      .map((e) => ({
        curatorId: e.curatorId, name: e.name,
        feeTakeRate: e.feeTakeRate!, netApyDelivered: e.netApyDelivered!, aum: e.aum,
        assetClass: classById.get(e.curatorId) ?? 'other', label: labelIds.has(e.curatorId),
      }));
  },
  [LB_CACHE, 'scatter'],
  { revalidate: TTL, tags: ['curators'] },
);

// ---------- Table with borrow interest ----------

export interface CuratorTableExtRow extends CuratorEconomics { sharePct: number; }

export const getCuratorTableWithBorrowInterest = unstable_cache(
  async (): Promise<CuratorTableExtRow[]> => {
    const econ = await getCuratorEconomics();
    const total = econ.reduce((s, e) => s + e.aum, 0);
    return econ.map((e) => ({ ...e, sharePct: total > 0 ? e.aum / total : 0 }));
  },
  [LB_CACHE, 'table-ext'],
  { revalidate: TTL, tags: ['curators'] },
);

// ---------- AUM-by-curator time series (4 toggles) ----------

export type CuratorMetricKey = 'AUM' | 'BORROW_INTEREST' | 'CURATOR_FEES' | 'NET_APY';
export interface CuratorSeriesPoint { date: string; [k: string]: string | number | null; }
export interface CuratorSeriesPayload {
  defaultMetric: CuratorMetricKey;
  topCurators: { id: string; name: string; color: string }[];
  byMetric: Record<CuratorMetricKey, CuratorSeriesPoint[]>;
  leader: { name: string; aum: number; pct: number; delta30d: number | null } | null;
  // First date with reliable per-vault fee capture. The CURATOR_FEES series is
  // clipped to >= this date: before it, vault_state_daily.fee_bps was not
  // recorded (Morpho's API serves only the current fee, not a fee history), so
  // earlier "fees" would read as a misleading flat ~0. null if never reliable.
  feeReliableFrom: string | null;
}

const TOP_N_CURATORS = 10;

export const getCuratorAumByCuratorSeries = unstable_cache(
  async (metric: CuratorMetricKey = 'AUM', days = 365): Promise<CuratorSeriesPayload> => {
    const sql = getDb();
    const econ = await getCuratorEconomics();
    if (econ.length === 0) return { defaultMetric: metric, topCurators: [], byMetric: { AUM: [], BORROW_INTEREST: [], CURATOR_FEES: [], NET_APY: [] }, leader: null, feeReliableFrom: null };
    const top = econ.slice(0, TOP_N_CURATORS);
    const topIds = new Set(top.map((e) => e.curatorId));
    const palette = tokens.colors.chart;
    const topCurators = top.map((e, i) => ({ id: e.curatorId, name: e.name, color: palette[i % palette.length]! }));
    const nameById = new Map(top.map((e) => [e.curatorId, e.name] as const));

    const rows = (await sql`
      SELECT s.snapshot_date::text AS date, v.curator_id,
        SUM(s.total_assets_usd)::float8 AS tvl,
        SUM(s.total_assets_usd * LEAST(COALESCE(s.apy, s.net_apy / NULLIF(1 - (s.fee_bps::numeric/10000),0)), 1.0))::float8 AS borrow_interest,
        SUM(s.total_assets_usd * LEAST(COALESCE(s.apy, s.net_apy / NULLIF(1 - (s.fee_bps::numeric/10000),0)), 1.0) * (s.fee_bps::numeric/10000))::float8 AS fees,
        SUM(s.total_assets_usd * s.net_apy)::float8 AS net_apy_num
      FROM morpho_.vault_state_daily s
      JOIN morpho_.vaults v ON v.chain_id = s.chain_id AND v.address = s.vault_address
      WHERE v.curator_id IS NOT NULL
        AND s.snapshot_date >= (CURRENT_DATE - (${days} * INTERVAL '1 day'))
        AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
      GROUP BY s.snapshot_date, v.curator_id
      ORDER BY s.snapshot_date ASC
    `) as { date: string; curator_id: string; tvl: number | null; borrow_interest: number | null; fees: number | null; net_apy_num: number | null }[];

    const aum = new Map<string, CuratorSeriesPoint>();
    const intr = new Map<string, CuratorSeriesPoint>();
    const fees = new Map<string, CuratorSeriesPoint>();
    const net = new Map<string, CuratorSeriesPoint>();
    const netW = new Map<string, Record<string, { num: number; den: number }>>();
    const ens = (m: Map<string, CuratorSeriesPoint>, d: string) => { let p = m.get(d); if (!p) { p = { date: d }; m.set(d, p); } return p; };
    for (const r of rows) {
      const inTop = topIds.has(r.curator_id);
      const key = inTop ? r.curator_id : 'Other';
      const t = r.tvl ?? 0;
      const ap = ens(aum, r.date); ap[key] = ((ap[key] as number) ?? 0) + t;
      const ip = ens(intr, r.date); ip[key] = ((ip[key] as number) ?? 0) + (r.borrow_interest ?? 0);
      const fp = ens(fees, r.date); fp[key] = ((fp[key] as number) ?? 0) + (r.fees ?? 0);
      if (inTop) {
        if (!netW.has(r.date)) netW.set(r.date, {});
        const w = netW.get(r.date)!;
        if (!w[r.curator_id]) w[r.curator_id] = { num: 0, den: 0 };
        w[r.curator_id]!.num += r.net_apy_num ?? 0; w[r.curator_id]!.den += t;
      }
    }
    for (const [date, w] of netW) {
      const np = ens(net, date);
      for (const [id, { num, den }] of Object.entries(w)) np[id] = den > 0 ? num / den : null;
    }
    const sortD = (m: Map<string, CuratorSeriesPoint>) => [...m.values()].sort((a, b) => (a.date as string).localeCompare(b.date as string));
    void nameById;

    // Find the first date where per-vault fee capture is reliable (>=50% of
    // vaults with TVL carry a fee_bps). Before this, fee_bps is essentially
    // unrecorded, so clip the CURATOR_FEES series to it rather than render a
    // year of misleading zeros.
    const covRows = (await sql`
      WITH cov AS (
        SELECT snapshot_date,
          1.0 * COUNT(*) FILTER (WHERE fee_bps IS NOT NULL AND total_assets_usd > 0)
              / NULLIF(COUNT(*) FILTER (WHERE total_assets_usd > 0), 0) AS p
        FROM morpho_.vault_state_daily
        GROUP BY snapshot_date
      )
      SELECT MIN(snapshot_date)::text AS d FROM cov WHERE p >= 0.5
    `) as { d: string | null }[];
    const feeReliableFrom = covRows[0]?.d ?? null;
    const feesSorted = sortD(fees);
    const feesClipped = feeReliableFrom
      ? feesSorted.filter((p) => (p.date as string) >= feeReliableFrom)
      : feesSorted;

    const leaderE = top[0]!;
    return {
      defaultMetric: metric, topCurators,
      byMetric: { AUM: sortD(aum), BORROW_INTEREST: sortD(intr), CURATOR_FEES: feesClipped, NET_APY: sortD(net) },
      leader: { name: leaderE.name, aum: leaderE.aum, pct: econ.reduce((s, e) => s + e.aum, 0) > 0 ? leaderE.aum / econ.reduce((s, e) => s + e.aum, 0) : 0, delta30d: leaderE.aum30dDeltaPct },
      feeReliableFrom,
    };
  },
  [LB_CACHE, 'aum-series'],
  { revalidate: TTL, tags: ['curators'] },
);

// ---------- Revenue leaderboard with take rate ----------

export interface RevenueLeaderboardExtRow extends RevenueLeaderboardRow { feeTakeRate: number | null; }

export const getCuratorRevenueLeaderboardWithTakeRate = unstable_cache(
  async (n = 5): Promise<RevenueLeaderboardExtRow[]> => {
    const sql = getDb();
    const rows = (await sql`
      WITH latest_vault AS (
        SELECT v.chain_id, v.address, v.fee_recipient_address,
               s.total_assets_usd::float8 AS tvl, s.apy::float8 AS apy, s.net_apy::float8 AS net_apy, s.fee_bps
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd, apy, net_apy, fee_bps FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
      ),
      attributed AS (
        SELECT lv.tvl, lv.apy, lv.net_apy, lv.fee_bps,
          (SELECT ca.curator_id FROM morpho_.curator_addresses ca
           WHERE LOWER(ca.address) = LOWER(lv.fee_recipient_address) AND (ca.chain_id IS NULL OR ca.chain_id = lv.chain_id) LIMIT 1) AS rc
        FROM latest_vault lv WHERE lv.tvl > 0 AND lv.fee_bps > 0
      ),
      g AS (
        SELECT rc AS id,
          SUM(GREATEST(tvl * LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric/10000), 0)), 1.0) * (fee_bps::numeric/10000), 0))::float8 AS rev,
          SUM(GREATEST(tvl * LEAST(COALESCE(apy, net_apy / NULLIF(1 - (fee_bps::numeric/10000), 0)), 1.0), 0))::float8 AS borrow_interest
        FROM attributed GROUP BY rc
      ),
      total AS (SELECT SUM(rev)::float8 AS t FROM g)
      SELECT g.id, c.name, g.rev, g.borrow_interest, (g.rev / NULLIF((SELECT t FROM total), 0))::float8 AS share
      FROM g LEFT JOIN morpho_.curators c ON c.id = g.id ORDER BY g.rev DESC NULLS LAST
    `) as { id: string | null; name: string | null; rev: number; borrow_interest: number; share: number | null }[];

    const named = rows.filter((r) => r.id).slice(0, n).map((r) => ({
      curatorId: r.id, curatorName: r.name ?? r.id!, estAnnualRevenueUsd: r.rev, sharePct: r.share ?? 0,
      isUnattributed: false, feeTakeRate: r.borrow_interest > 0 ? r.rev / r.borrow_interest : null,
    }));
    const un = rows.find((r) => r.id == null);
    if (un) named.push({ curatorId: null, curatorName: 'UNATTRIBUTED', estAnnualRevenueUsd: un.rev, sharePct: un.share ?? 0, isUnattributed: true, feeTakeRate: un.borrow_interest > 0 ? un.rev / un.borrow_interest : null });
    return named;
  },
  [LB_CACHE, 'rev-leaderboard-take'],
  { revalidate: TTL, tags: ['curators'] },
);

// ===========================================================================
// PART C . /curators/[slug] enrichment helpers.
// ===========================================================================

export const getCuratorVaultPerformance = unstable_cache(
  async (slug: string): Promise<CuratorVaultPerfRow[]> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return [];
    const rows = (await sql`
      WITH lv AS (
        SELECT v.chain_id, ch.slug AS chain_slug, v.address, v.name, v.asset_symbol,
               s.total_assets_usd::float8 AS tvl, s.apy::float8 AS apy, s.net_apy::float8 AS net_apy, s.fee_bps
        FROM morpho_.vaults v
        LEFT JOIN morpho_.chains ch ON ch.chain_id = v.chain_id
        JOIN LATERAL (
          SELECT total_assets_usd, apy, net_apy, fee_bps FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id = ${c.id}
          AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
      ),
      v30 AS (
        SELECT v.chain_id, v.address, x.total_assets_usd::float8 AS tvl30
        FROM morpho_.vaults v
        LEFT JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily y
          WHERE y.chain_id = v.chain_id AND y.vault_address = v.address
            AND y.snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY y.snapshot_date DESC LIMIT 1
        ) x ON TRUE
        WHERE v.curator_id = ${c.id}
      )
      SELECT lv.chain_id, lv.chain_slug, lv.address, lv.name, lv.asset_symbol,
             lv.tvl, lv.net_apy, lv.fee_bps,
             GREATEST(lv.tvl * LEAST(COALESCE(lv.apy, lv.net_apy / NULLIF(1 - (lv.fee_bps::numeric/10000),0)), 1.0), 0)::float8 AS borrow_interest,
             v30.tvl30
      FROM lv LEFT JOIN v30 ON v30.chain_id = lv.chain_id AND v30.address = lv.address
      WHERE lv.tvl > 0
      ORDER BY lv.tvl DESC NULLS LAST
    `) as { chain_id: number; chain_slug: string | null; address: string; name: string | null; asset_symbol: string | null; tvl: number; net_apy: number | null; fee_bps: number | null; borrow_interest: number; tvl30: number | null }[];
    return rows.map((r) => ({
      chainId: r.chain_id, chainSlug: r.chain_slug, address: r.address, name: r.name, assetSymbol: r.asset_symbol,
      aumUsd: r.tvl, netApy: r.net_apy, feeBps: r.fee_bps,
      feeTakeRate: r.fee_bps != null ? r.fee_bps / 10000 : null,
      borrowInterestUsd: r.borrow_interest,
      aum30dDeltaPct: r.tvl30 != null && r.tvl30 > 0 ? (r.tvl - r.tvl30) / r.tvl30 : null,
    }));
  },
  [LB_CACHE, 'vault-perf'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorLoanBookComposition = unstable_cache(
  async (slug: string): Promise<LoanBookAssetRow[]> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return [];
    const rows = (await sql`
      SELECT v.asset_symbol AS sym, v.chain_id, s.total_assets_usd::float8 AS tvl
      FROM morpho_.vaults v
      JOIN LATERAL (
        SELECT total_assets_usd, apy, net_apy FROM morpho_.vault_state_daily x
        WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE v.curator_id = ${c.id} AND s.total_assets_usd > 0
        AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
    `) as { sym: string | null; chain_id: number; tvl: number }[];
    const agg = new Map<string, { aum: number; vaults: number; chains: Set<number> }>();
    for (const r of rows) {
      const k = r.sym ?? 'N/A';
      if (!agg.has(k)) agg.set(k, { aum: 0, vaults: 0, chains: new Set() });
      const a = agg.get(k)!; a.aum += r.tvl; a.vaults += 1; a.chains.add(r.chain_id);
    }
    return [...agg.entries()]
      .map(([assetSymbol, a]) => ({ assetSymbol, aumUsd: a.aum, vaultCount: a.vaults, chainCount: a.chains.size }))
      .sort((x, y) => y.aumUsd - x.aumUsd);
  },
  [LB_CACHE, 'loan-book'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorFeeStructure = unstable_cache(
  async (slug: string): Promise<FeeStructurePoint[]> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return [];
    const rows = (await sql`
      SELECT v.name, s.fee_bps, s.total_assets_usd::float8 AS tvl, s.net_apy::float8 AS net_apy
      FROM morpho_.vaults v
      JOIN LATERAL (
        SELECT total_assets_usd, apy, net_apy, fee_bps FROM morpho_.vault_state_daily x
        WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE v.curator_id = ${c.id} AND s.total_assets_usd > 0
        AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
      ORDER BY s.total_assets_usd DESC
    `) as { name: string | null; fee_bps: number | null; tvl: number; net_apy: number | null }[];
    return rows.map((r) => ({ name: r.name ?? 'N/A', feeBps: r.fee_bps, tvlUsd: r.tvl, netApy: r.net_apy }));
  },
  [LB_CACHE, 'fee-structure'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorVsSectorBenchmark = unstable_cache(
  async (slug: string): Promise<VsSectorRow[]> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return [];
    const rows = (await sql`
      WITH lv AS (
        SELECT v.curator_id, v.chain_id,
               s.total_assets_usd::float8 AS tvl, s.net_apy::float8 AS net_apy
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd, apy, net_apy FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0) AND s.total_assets_usd > 0
      ),
      cur AS (
        SELECT chain_id, CASE WHEN SUM(tvl) > 0 THEN SUM(tvl * net_apy) / SUM(tvl) END::float8 AS net_apy
        FROM lv WHERE curator_id = ${c.id} GROUP BY chain_id
      ),
      sector AS (
        SELECT chain_id, CASE WHEN SUM(tvl) > 0 THEN SUM(tvl * net_apy) / SUM(tvl) END::float8 AS net_apy
        FROM lv GROUP BY chain_id
      )
      SELECT ch.slug AS chain_slug, ch.name AS chain_name, cur.net_apy AS cur_apy, sector.net_apy AS sec_apy
      FROM cur JOIN sector USING (chain_id) JOIN morpho_.chains ch ON ch.chain_id = cur.chain_id
      ORDER BY cur.net_apy DESC NULLS LAST
    `) as { chain_slug: string; chain_name: string; cur_apy: number | null; sec_apy: number | null }[];
    return rows.map((r) => ({
      chainSlug: r.chain_slug, chainName: r.chain_name, curatorNetApy: r.cur_apy, sectorNetApy: r.sec_apy,
      spreadBps: r.cur_apy != null && r.sec_apy != null ? Math.round((r.cur_apy - r.sec_apy) * 10000) : null,
    }));
  },
  [LB_CACHE, 'vs-sector'],
  { revalidate: TTL, tags: ['curators'] },
);

export const getCuratorWeeklyNetInflows = unstable_cache(
  async (slug: string, weeks = 13): Promise<WeeklyInflowPoint[]> => {
    const sql = getDb();
    const c = await resolveCurator(slug);
    if (!c) return [];
    // Daily total AUM for the curator over the trailing window (+1 week for the
    // baseline diff). Bucket to the last observation per ISO week in JS.
    const days = (weeks + 1) * 7;
    const rows = (await sql`
      SELECT s.snapshot_date::text AS date, SUM(s.total_assets_usd)::float8 AS tvl
      FROM morpho_.vault_state_daily s
      JOIN morpho_.vaults v ON v.chain_id = s.chain_id AND v.address = s.vault_address
      WHERE v.curator_id = ${c.id}
        AND s.snapshot_date >= (CURRENT_DATE - (${days} * INTERVAL '1 day'))
        AND (s.apy IS NULL OR s.apy <= 1.0) AND (s.net_apy IS NULL OR s.net_apy <= 1.0)
      GROUP BY s.snapshot_date ORDER BY s.snapshot_date ASC
    `) as { date: string; tvl: number }[];
    // last AUM per ISO-week (Monday start)
    const weekly = new Map<string, number>();
    for (const r of rows) {
      const d = new Date(r.date + 'T00:00:00Z');
      const day = (d.getUTCDay() + 6) % 7; // 0=Mon
      const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - day);
      weekly.set(monday.toISOString().slice(0, 10), r.tvl); // later dates overwrite → last in week
    }
    const sorted = [...weekly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const out: WeeklyInflowPoint[] = [];
    for (let i = 1; i < sorted.length; i++) {
      out.push({ weekStart: sorted[i]![0], netChangeUsd: sorted[i]![1] - sorted[i - 1]![1] });
    }
    return out.slice(-weeks);
  },
  [LB_CACHE, 'weekly-inflows'],
  { revalidate: TTL, tags: ['curators'] },
);
