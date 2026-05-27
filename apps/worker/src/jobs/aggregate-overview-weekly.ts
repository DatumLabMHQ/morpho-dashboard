import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';

// How far back to rebuild. 104 weeks = 2 years, matches the /overview chart.
const WEEKS = 104;

export interface AggregateOverviewWeeklyResult {
  written: number;
  notes: {
    weeksCovered: number;
    chainsCovered: number;
  };
}

/**
 * Rebuild `morpho_.overview_weekly_chain_metrics` from raw daily state.
 *
 * Strategy: do the daily-grain (day, chain) compute in one SQL statement
 * per metric, then roll up to weekly buckets in JS. The two SQL queries
 * each scan ~730k rows of market_state_daily / vault_state_daily on one
 * pass — well within Postgres's comfort zone for an aggregate.
 *
 * Idempotent: PK (week_start, chain_slug) + ON CONFLICT DO UPDATE means
 * re-running just refreshes the latest weeks.
 */
export async function aggregateOverviewWeekly(
  sql: SqlClient,
): Promise<AggregateOverviewWeeklyResult> {
  const since = new Date(Date.now() - WEEKS * 7 * 86_400_000);
  const sinceDate = since.toISOString().slice(0, 10);

  // ─── Borrow interest per (day, chain) ───────────────────────────────
  // Σ borrow_assets_usd × borrow_apy / 365 daily, grouped by chain.
  // Skip markets where supply_apy was a saturated-util IRM blow-up
  // (>= 100%): those report fictional borrow APYs too.
  const borrowRows = (await sql(
    `
    WITH per_day AS (
      SELECT
        s.snapshot_date::date         AS day,
        ch.slug                        AS chain_slug,
        SUM(COALESCE(s.borrow_assets_usd, 0) * COALESCE(s.borrow_apy, 0) / 365.0)::float8
                                       AS interest_usd
      FROM morpho_.market_state_daily s
      JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE s.snapshot_date >= $1::date
        AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
        AND s.borrow_assets_usd > 0
      GROUP BY s.snapshot_date::date, ch.slug
    )
    SELECT day::text, chain_slug, interest_usd FROM per_day
    `,
    [sinceDate],
  )) as { day: string; chain_slug: string | null; interest_usd: number }[];

  // ─── Curation fees per (day, chain) ─────────────────────────────────
  // Σ vault.total_assets_usd × vault.apy × vault.fee_bps/10000 / 365 daily.
  // vault.apy is the pre-fee APY (see lib/queries/curators.ts comment).
  const feeRows = (await sql(
    `
    WITH per_day AS (
      SELECT
        s.snapshot_date::date  AS day,
        ch.slug                 AS chain_slug,
        SUM(
          COALESCE(s.total_assets_usd, 0)
            * COALESCE(s.apy, 0)
            * COALESCE(s.fee_bps, 0) / 10000.0
            / 365.0
        )::float8               AS fee_usd
      FROM morpho_.vault_state_daily s
      JOIN morpho_.vaults v
        ON v.chain_id = s.chain_id AND v.address = s.vault_address
      LEFT JOIN morpho_.chains ch ON ch.chain_id = v.chain_id
      WHERE s.snapshot_date >= $1::date
        AND COALESCE(s.apy, 0) < 1.0     -- same APY-sanity clamp
        AND s.total_assets_usd > 0
        AND s.fee_bps > 0
      GROUP BY s.snapshot_date::date, ch.slug
    )
    SELECT day::text, chain_slug, fee_usd FROM per_day
    `,
    [sinceDate],
  )) as { day: string; chain_slug: string | null; fee_usd: number }[];

  // ─── Roll up to weekly buckets in JS ────────────────────────────────
  // ISO Monday → "week_start" for the row.
  const mondayOf = (iso: string): string => {
    const d = new Date(iso + 'T00:00:00Z');
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const offset = (dow + 6) % 7; // back up to Monday
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };

  const byKey = new Map<
    string,
    { week: string; chain: string; interest: number; fees: number }
  >();
  const accum = (week: string, chain: string | null, kind: 'interest' | 'fees', usd: number) => {
    if (!chain) return; // skip rows whose chain didn't join
    const k = `${week}|${chain}`;
    let cur = byKey.get(k);
    if (!cur) {
      cur = { week, chain, interest: 0, fees: 0 };
      byKey.set(k, cur);
    }
    cur[kind] += usd;
  };
  for (const r of borrowRows) accum(mondayOf(r.day), r.chain_slug, 'interest', r.interest_usd);
  for (const r of feeRows)    accum(mondayOf(r.day), r.chain_slug, 'fees',    r.fee_usd);

  const rows: unknown[][] = [];
  for (const v of byKey.values()) {
    rows.push([v.week, v.chain, v.interest, v.fees]);
  }

  const written = await batchInsert(
    sql,
    'morpho_.overview_weekly_chain_metrics',
    ['week_start', 'chain_slug', 'borrow_interest_usd', 'curation_fees_usd'],
    rows,
    {
      onConflict: `ON CONFLICT (week_start, chain_slug) DO UPDATE SET
        borrow_interest_usd = EXCLUDED.borrow_interest_usd,
        curation_fees_usd   = EXCLUDED.curation_fees_usd,
        recorded_at         = NOW()`,
    },
  );

  const weeks = new Set(rows.map((r) => r[0] as string));
  const chains = new Set(rows.map((r) => r[1] as string));
  return {
    written,
    notes: { weeksCovered: weeks.size, chainsCovered: chains.size },
  };
}
