import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';

// FRED series DTB3 — 3-Month Treasury Bill Secondary Market Rate, daily.
const FRED_SERIES = 'DTB3';
const HISTORY_DAYS = 800; // a bit over 2 years to cover the YoY KPI anchor

export interface FredTbillResult {
  written: number;
  notes: {
    skipped?: string;
    observationsFetched?: number;
    latestRatePct?: number | null;
  };
}

interface FredObservation {
  date: string;   // "2026-05-20"
  value: string;  // "5.25" or "." for missing
}

interface FredResponse {
  observations?: FredObservation[];
}

/**
 * Pull the 3-month T-bill rate from FRED into tbill_rates_daily.
 *
 * Gracefully no-ops when FRED_API_KEY is unset — the /overview real-yield
 * KPI then renders "—". This keeps the dashboard deployable without the
 * operator having signed up for a (free) FRED key.
 */
export async function syncFredTbill(
  sql: SqlClient,
  apiKey: string | undefined,
): Promise<FredTbillResult> {
  if (!apiKey) {
    return { written: 0, notes: { skipped: 'FRED_API_KEY not configured' } };
  }

  const start = new Date(Date.now() - HISTORY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${FRED_SERIES}` +
    `&api_key=${apiKey}` +
    `&file_type=json` +
    `&observation_start=${start}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FRED HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as FredResponse;
  const obs = body.observations ?? [];

  // FRED uses "." for missing days (weekends/holidays). Skip those.
  const rows: unknown[][] = [];
  let latest: number | null = null;
  for (const o of obs) {
    if (!o.value || o.value === '.') continue;
    const rate = Number(o.value);
    if (!Number.isFinite(rate)) continue;
    rows.push([o.date, rate]);
    latest = rate; // observations are date-ascending; last wins
  }

  const written = await batchInsert(
    sql,
    'morpho_.tbill_rates_daily',
    ['day', 'rate_pct'],
    rows,
    {
      onConflict: `ON CONFLICT (day) DO UPDATE SET
        rate_pct    = EXCLUDED.rate_pct,
        recorded_at = NOW()`,
    },
  );

  return {
    written,
    notes: { observationsFetched: rows.length, latestRatePct: latest },
  };
}
