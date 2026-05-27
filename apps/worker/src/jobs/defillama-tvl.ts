import { DefiLlamaClient, isRealChainKey } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';
import { unixToDate } from '../lib/convert.js';

// Slugs verified against /protocols (2026-05-25). Update if DefiLlama renames.
//
// MUST stay in sync with `apps/web/lib/protocols/comparison-set.ts`
// LENDING_PROTOCOLS. The two lists are kept separate because the worker
// can't import from the web app (no shared deps), but every slug used in
// the Overview's sector chart needs a row in `protocol_tvl_daily` from this
// sync. If a slug here returns 500 from /protocol/<slug> it lands in the
// skipped[] result and gets dropped silently — check the sync_runs log.
export const COMPARATOR_SLUGS = [
  // Overcollateralized lending
  'morpho-blue',
  'aave-v3',
  'aave-v2',
  'sparklend',
  'compound-v3',
  'compound-v2',
  'fluid-lending',
  'euler-v2',
  // CDPs
  'sky-lending',
  'liquity-v1',
  'liquity-v2',
] as const;

// 730 days covers the user's "Jun 2024 (Morpho Blue launch) → today" chart
// range and gives us a valid 12-month-ago anchor for the Chains page.
const HISTORY_DAYS = 730;

export interface DefiLlamaTvlResult {
  written: number;
  notes: {
    protocolsFetched: number;
    skipped: { slug: string; error: string }[];
  };
}

// Unconditionally refreshes per-chain TVL history for morpho-blue + the 5
// comparator protocols. Bypasses the delta gate; runs on every steady-state
// cron so the Overview charts stay current.
//
// Also updates defillama_protocols_snapshot so the lending-denom job sees these
// as fresh and skips them in its own pass.
export async function syncDefillamaTvl(
  sql: SqlClient,
  llama: DefiLlamaClient,
): Promise<DefiLlamaTvlResult> {
  const cutoffMs = Date.now() - HISTORY_DAYS * 86_400_000;
  const now = new Date().toISOString();

  // Map keyed by "slug|chain|date" so duplicate datapoints (DefiLlama sometimes
  // emits multiple per UTC day) collapse to last-write-wins.
  const tvlByKey = new Map<string, unknown[]>();
  const snapshotRows: unknown[][] = [];
  const skipped: { slug: string; error: string }[] = [];

  for (const slug of COMPARATOR_SLUGS) {
    try {
      const detail = await llama.protocol(slug);

      let currentTotalTvl = 0;
      for (const [chainKey, data] of Object.entries(detail.chainTvls ?? {})) {
        if (!isRealChainKey(chainKey)) continue;
        if (!data?.tvl?.length) continue;

        for (const point of data.tvl) {
          if (point.date * 1000 < cutoffMs) continue;
          const date = unixToDate(point.date);
          tvlByKey.set(`${slug}|${chainKey}|${date}`, [
            slug, chainKey, date, point.totalLiquidityUSD,
          ]);
        }
        const last = data.tvl[data.tvl.length - 1];
        if (last) currentTotalTvl += last.totalLiquidityUSD;
      }

      // Set both last_tvl_usd AND last_fetched_history_tvl_usd to the same
      // value so the lending-denom delta gate sees comparators as already
      // anchored and doesn't try to refetch them.
      snapshotRows.push([
        slug, detail.name, detail.category,
        currentTotalTvl, currentTotalTvl, now,
      ]);
    } catch (err) {
      skipped.push({ slug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const tvlRows = [...tvlByKey.values()];

  const written = await batchInsert(
    sql,
    'morpho_.protocol_tvl_daily',
    ['protocol_slug', 'chain_slug', 'snapshot_date', 'tvl_usd'],
    tvlRows,
    {
      onConflict: `ON CONFLICT (protocol_slug, chain_slug, snapshot_date) DO UPDATE SET
        tvl_usd     = EXCLUDED.tvl_usd,
        recorded_at = NOW()`,
    },
  );

  await batchInsert(
    sql,
    'morpho_.defillama_protocols_snapshot',
    [
      'protocol_slug', 'name', 'category',
      'last_tvl_usd', 'last_fetched_history_tvl_usd', 'last_history_synced_at',
    ],
    snapshotRows,
    {
      onConflict: `ON CONFLICT (protocol_slug) DO UPDATE SET
        name                         = EXCLUDED.name,
        category                     = EXCLUDED.category,
        last_tvl_usd                 = EXCLUDED.last_tvl_usd,
        last_fetched_at              = NOW(),
        last_fetched_history_tvl_usd = EXCLUDED.last_fetched_history_tvl_usd,
        last_history_synced_at       = EXCLUDED.last_history_synced_at`,
    },
  );

  return {
    written,
    notes: {
      protocolsFetched: COMPARATOR_SLUGS.length - skipped.length,
      skipped,
    },
  };
}
