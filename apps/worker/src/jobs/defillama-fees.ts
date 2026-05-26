import { DefiLlamaClient } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';
import { unixToDate } from '../lib/convert.js';
import { COMPARATOR_SLUGS } from './defillama-tvl.js';

const HISTORY_DAYS = 365;

export interface DefiLlamaFeesResult {
  written: number;
  notes: {
    skipped: { slug: string; type: 'fees' | 'revenue'; error: string }[];
  };
}

// Pulls daily fees + daily revenue for morpho-blue + the comparators. Each
// (slug, dataType) is fetched independently so a missing series (e.g. euler-v2
// has no fees data) doesn't poison the rest. Merges the two series into one
// row per (slug, date).
export async function syncDefillamaFees(
  sql: SqlClient,
  llama: DefiLlamaClient,
): Promise<DefiLlamaFeesResult> {
  const cutoffMs = Date.now() - HISTORY_DAYS * 86_400_000;
  const skipped: DefiLlamaFeesResult['notes']['skipped'] = [];
  const feeRows: unknown[][] = [];

  for (const slug of COMPARATOR_SLUGS) {
    let feesChart: [number, number][] | null = null;
    let revenueChart: [number, number][] | null = null;

    try {
      feesChart = (await llama.feesSummary(slug, 'dailyFees')).totalDataChart;
    } catch (err) {
      skipped.push({ slug, type: 'fees', error: err instanceof Error ? err.message : String(err) });
    }
    try {
      revenueChart = (await llama.feesSummary(slug, 'dailyRevenue')).totalDataChart;
    } catch (err) {
      skipped.push({ slug, type: 'revenue', error: err instanceof Error ? err.message : String(err) });
    }

    const byDate = new Map<string, { fees: number | null; revenue: number | null }>();
    for (const [ts, val] of feesChart ?? []) {
      if (ts * 1000 < cutoffMs) continue;
      const date = unixToDate(ts);
      const row = byDate.get(date) ?? { fees: null, revenue: null };
      row.fees = val;
      byDate.set(date, row);
    }
    for (const [ts, val] of revenueChart ?? []) {
      if (ts * 1000 < cutoffMs) continue;
      const date = unixToDate(ts);
      const row = byDate.get(date) ?? { fees: null, revenue: null };
      row.revenue = val;
      byDate.set(date, row);
    }

    for (const [date, vals] of byDate) {
      feeRows.push([slug, date, vals.fees, vals.revenue]);
    }
  }

  const written = await batchInsert(
    sql,
    'morpho_.protocol_fees_daily',
    ['protocol_slug', 'snapshot_date', 'fees_usd', 'revenue_usd'],
    feeRows,
    {
      onConflict: `ON CONFLICT (protocol_slug, snapshot_date) DO UPDATE SET
        fees_usd    = EXCLUDED.fees_usd,
        revenue_usd = EXCLUDED.revenue_usd,
        recorded_at = NOW()`,
    },
  );

  return { written, notes: { skipped } };
}
