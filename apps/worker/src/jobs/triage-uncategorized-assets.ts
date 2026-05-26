import type { SqlClient } from '@morpho-dashboard/db';

import { todayUtc } from '../lib/convert.js';

const TOP_N = 200;

export interface TriageResult {
  written: number;        // count of uncategorized assets reported
  hasMore: false;
  notes: {
    uncategorizedCount: number;
    totalUnmatchedTvlUsd: number;
    samples: { chainId: number; address: string; symbol: string; tvlUsd: number }[];
  };
}

// One-shot SQL pass: find assets that don't match any asset_categories rule
// (using the same 3-tier priority: address+chain > symbol+chain > symbol),
// compute today's TVL exposure (as loan asset + as collateral asset), and
// return the top N by TVL.
//
// Caller (the runJob wrapper) writes the result into sync_runs.notes for
// the user to triage by populating asset_categories.
export async function triageUncategorizedAssets(sql: SqlClient): Promise<TriageResult> {
  const today = todayUtc();

  // Combined CTE: per-asset TVL from today's market_state_daily, then anti-join
  // against asset_categories to filter to unmatched.
  const rows = (await sql`
    WITH asset_tvl AS (
      SELECT
        a.chain_id,
        a.address,
        a.symbol,
        COALESCE((
          SELECT SUM(s.supply_assets_usd)
          FROM morpho_.market_state_daily s
          JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
          WHERE m.chain_id = a.chain_id
            AND m.loan_asset_address = a.address
            AND s.snapshot_date = ${today}
        ), 0) +
        COALESCE((
          SELECT SUM(s.collateral_assets_usd)
          FROM morpho_.market_state_daily s
          JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
          WHERE m.chain_id = a.chain_id
            AND m.collateral_asset_address = a.address
            AND s.snapshot_date = ${today}
        ), 0) AS tvl_usd
      FROM morpho_.assets a
    )
    SELECT chain_id, address, symbol, tvl_usd
    FROM asset_tvl
    WHERE NOT EXISTS (
      SELECT 1 FROM morpho_.asset_categories c
      WHERE
        (c.address IS NOT NULL
           AND LOWER(c.address) = LOWER(asset_tvl.address)
           AND c.chain_id = asset_tvl.chain_id)
        OR (c.address IS NULL
           AND c.chain_id IS NOT NULL
           AND c.symbol = asset_tvl.symbol
           AND c.chain_id = asset_tvl.chain_id)
        OR (c.address IS NULL
           AND c.chain_id IS NULL
           AND c.symbol = asset_tvl.symbol)
    )
    ORDER BY tvl_usd DESC
    LIMIT ${TOP_N}
  `) as { chain_id: number; address: string; symbol: string; tvl_usd: string | number }[];

  const samples = rows.map((r) => ({
    chainId: r.chain_id,
    address: r.address,
    symbol: r.symbol,
    tvlUsd: Number(r.tvl_usd),
  }));
  const totalUnmatchedTvlUsd = samples.reduce((s, r) => s + r.tvlUsd, 0);

  return {
    written: samples.length,
    hasMore: false,
    notes: {
      uncategorizedCount: samples.length,
      totalUnmatchedTvlUsd,
      samples,
    },
  };
}
