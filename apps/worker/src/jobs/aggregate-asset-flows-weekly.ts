import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';

const WEEKS = 104;

export interface AssetFlowsWeeklyResult {
  written: number;
  notes: { weeksCovered: number; assetsCovered: number };
}

/**
 * Rebuild `morpho_asset_flows_weekly` — net weekly supply-footprint change
 * per (chain, asset).
 *
 * Footprint(asset, chain, day) =
 *     Σ supply_assets_usd  where the asset is the market's loan asset
 *   + Σ collateral_assets_usd where the asset is the market's collateral asset
 *
 * Net weekly flow = footprint on the last snapshot of the ISO week minus
 * footprint on the first snapshot of the week. The heavy work (per-day
 * footprint + week-boundary picking) is done in Postgres window functions;
 * we only ship the boundary rows back and diff in JS.
 */
export async function aggregateAssetFlowsWeekly(
  sql: SqlClient,
): Promise<AssetFlowsWeeklyResult> {
  const since = new Date(Date.now() - WEEKS * 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Per (week, chain, asset): the footprint on the first and last day of the
  // week that actually has a snapshot. Saturated-util IRM blow-ups
  // (supply_apy >= 100%) are excluded so phantom markets don't inject
  // fictional flow.
  const rows = (await sql(
    `
    WITH footprint AS (
      -- loan side
      SELECT
        s.snapshot_date::date AS day,
        m.chain_id            AS chain_id,
        m.loan_asset_symbol   AS asset,
        COALESCE(s.supply_assets_usd, 0)::float8 AS usd
      FROM morpho_.market_state_daily s
      JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
      WHERE s.snapshot_date >= $1::date
        AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
        AND m.loan_asset_symbol IS NOT NULL
      UNION ALL
      -- collateral side
      SELECT
        s.snapshot_date::date,
        m.chain_id,
        m.collateral_asset_symbol,
        COALESCE(s.collateral_assets_usd, 0)::float8
      FROM morpho_.market_state_daily s
      JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
      WHERE s.snapshot_date >= $1::date
        AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
        AND m.collateral_asset_symbol IS NOT NULL
    ),
    daily AS (
      SELECT
        day,
        date_trunc('week', day)::date AS week_start,
        chain_id,
        asset,
        SUM(usd)::float8 AS footprint_usd
      FROM footprint
      GROUP BY day, chain_id, asset
    ),
    ranked AS (
      SELECT
        week_start, chain_id, asset, day, footprint_usd,
        ROW_NUMBER() OVER (PARTITION BY week_start, chain_id, asset ORDER BY day ASC)  AS rn_first,
        ROW_NUMBER() OVER (PARTITION BY week_start, chain_id, asset ORDER BY day DESC) AS rn_last
      FROM daily
    )
    SELECT
      week_start::text AS week_start,
      chain_id,
      asset,
      MAX(CASE WHEN rn_first = 1 THEN footprint_usd END) AS start_usd,
      MAX(CASE WHEN rn_last  = 1 THEN footprint_usd END) AS end_usd
    FROM ranked
    WHERE rn_first = 1 OR rn_last = 1
    GROUP BY week_start, chain_id, asset
    `,
    [since],
  )) as { week_start: string; chain_id: number; asset: string; start_usd: number | null; end_usd: number | null }[];

  const out: unknown[][] = [];
  for (const r of rows) {
    const start = r.start_usd ?? 0;
    const end = r.end_usd ?? 0;
    const net = end - start;
    out.push([r.week_start, r.chain_id, r.asset, net, end]);
  }

  const written = await batchInsert(
    sql,
    'morpho_.morpho_asset_flows_weekly',
    ['week_start', 'chain_id', 'asset_symbol', 'net_flow_usd', 'footprint_end_usd'],
    out,
    {
      onConflict: `ON CONFLICT (week_start, chain_id, asset_symbol) DO UPDATE SET
        net_flow_usd      = EXCLUDED.net_flow_usd,
        footprint_end_usd = EXCLUDED.footprint_end_usd,
        recorded_at       = NOW()`,
    },
  );

  const weeks = new Set(out.map((r) => r[0] as string));
  const assets = new Set(out.map((r) => r[2] as string));
  return { written, notes: { weeksCovered: weeks.size, assetsCovered: assets.size } };
}
