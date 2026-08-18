import type { SqlClient } from '@morpho-dashboard/db';

// Recurring history downsample (storage control).
//
// Keeps the last 120 days of the two DefiLlama time-series tables at daily
// granularity and collapses anything older to ONE row per ISO week per
// partition. Runs over a 3-week trailing band (rows that have JUST aged past
// the 120-day window), so each daily run does bounded work and is idempotent.
//
// The initial bulk reclaim + VACUUM FULL is a one-time operation
// (scripts/downsample-history.ts); this job only handles the daily trickle,
// which autovacuum reclaims, keeping the tables at a stable size.
//
// Safe: market_state_daily / vault_state_daily are deliberately NOT touched
// (their daily rows back the exact 1d/30d/365d KPI anchors). The derived
// chain_lending_tvl_daily is downsampled in lockstep with its protocol_tvl_daily
// source, and the lending-denom rebuild GROUP BYs whatever dates remain.
export async function downsampleHistory(
  sql: SqlClient,
): Promise<{ written: number; notes: unknown }> {
  const protocolRows = (await sql`
    DELETE FROM morpho_.protocol_tvl_daily
    WHERE ctid IN (
      SELECT ctid FROM (
        SELECT ctid, ROW_NUMBER() OVER (
          PARTITION BY protocol_slug, chain_slug, date_trunc('week', snapshot_date::timestamp)
          ORDER BY snapshot_date DESC
        ) AS rn
        FROM morpho_.protocol_tvl_daily
        WHERE snapshot_date <  CURRENT_DATE - INTERVAL '120 days'
          AND snapshot_date >= CURRENT_DATE - INTERVAL '141 days'
      ) q WHERE q.rn > 1
    )
    RETURNING 1
  `) as unknown[];

  const chainRows = (await sql`
    DELETE FROM morpho_.chain_lending_tvl_daily
    WHERE ctid IN (
      SELECT ctid FROM (
        SELECT ctid, ROW_NUMBER() OVER (
          PARTITION BY chain_slug, date_trunc('week', snapshot_date::timestamp)
          ORDER BY snapshot_date DESC
        ) AS rn
        FROM morpho_.chain_lending_tvl_daily
        WHERE snapshot_date <  CURRENT_DATE - INTERVAL '120 days'
          AND snapshot_date >= CURRENT_DATE - INTERVAL '141 days'
      ) q WHERE q.rn > 1
    )
    RETURNING 1
  `) as unknown[];

  return {
    written: protocolRows.length + chainRows.length,
    notes: {
      protocol_tvl_daily: protocolRows.length,
      chain_lending_tvl_daily: chainRows.length,
    },
  };
}
