import {
  DefiLlamaClient,
  isLendingProtocol,
  isRealChainKey,
  shouldRefetchProtocol,
} from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';
import { unixToDate } from '../lib/convert.js';

// Per-tick cap on /protocol/{slug} calls. Tuned so DB write chunking + this
// stays under the 50 subreq Worker cap (the heavier DB writes happen after).
// 5 not 10: at 730 days × ~30 chains × N protocols we'd hit the 30s CPU cap
// per Worker invocation with 10. Halving keeps each tick comfortably under.
const PER_TICK_REFETCH_CAP = 5;
const HISTORY_DAYS = 730;

// Cool-down: skip protocols refetched within this window even if the delta
// gate would otherwise fire. Defends against micro-protocols whose /protocols
// summary TVL bounces ±1% across consecutive calls, which would otherwise
// cause the same ~10 protocols to be picked every tick (starving the rest).
// Cron runs every 6h, so 30 min is plenty.
const REFETCH_COOLDOWN_MS = 30 * 60 * 1000;

export interface LendingDenomResult {
  written: number;                       // protocol_tvl_daily rows upserted
  hasMore: boolean;                      // true while toRefetch.length > cap
  notes: {
    lendingProtocolsTotal: number;       // count of Lending + CDP in /protocols
    toRefetchTotal: number;              // # gated >1% TVL change OR missing snapshot
    batchProcessed: number;              // # actually fetched this tick
    hasMoreToRefetch: boolean;           // true → trigger another tick
    skipped: { slug: string; error: string }[];
  };
}

// Steady-state denominator refresh:
//   1. Fetch /protocols (1 call), filter to Lending + CDP
//   2. Compare current TVL vs cached snapshot — refetch only when |delta| > 1%
//   3. Cap at PER_TICK_REFETCH_CAP per tick (subreq budget)
//   4. Write per-chain TVL history to protocol_tvl_daily for the batch
//   5. Refresh the snapshot table (top-level TVL for ALL lending, history mark for batch)
//   6. Rebuild chain_lending_tvl_daily from protocol_tvl_daily JOIN snapshot
//
// First-run note: with no cached snapshots, ALL protocols pass the gate.
// Steady cron drains them over (~lending.length / 10) ticks. The 5d backfill
// endpoint can be hit repeatedly to speed up the initial population.
export async function syncDefillamaLendingDenom(
  sql: SqlClient,
  llama: DefiLlamaClient,
): Promise<LendingDenomResult> {
  const cutoffMs = Date.now() - HISTORY_DAYS * 86_400_000;
  const now = new Date().toISOString();

  // 1 + 2. List + cache lookup. CRITICAL: the delta gate compares against
  // last_fetched_history_tvl_usd (the stable anchor we set when we actually
  // refreshed /protocol/{slug}), NOT last_tvl_usd (which is rewritten from the
  // noisy /protocols summary every tick and would cause flapping).
  const allProtocols = await llama.protocols();
  const lending = allProtocols.filter(isLendingProtocol);

  const cached = (await sql`
    SELECT protocol_slug, last_fetched_history_tvl_usd, last_history_synced_at
    FROM morpho_.defillama_protocols_snapshot
  `) as {
    protocol_slug: string;
    last_fetched_history_tvl_usd: string | number | null;
    last_history_synced_at: string | Date | null;
  }[];
  const anchorMap = new Map<string, number | null>();
  const syncedAtMap = new Map<string, number | null>();
  for (const c of cached) {
    anchorMap.set(
      c.protocol_slug,
      c.last_fetched_history_tvl_usd == null ? null : Number(c.last_fetched_history_tvl_usd),
    );
    const t = c.last_history_synced_at;
    syncedAtMap.set(c.protocol_slug, t == null ? null : new Date(t).getTime());
  }

  const nowMs = Date.now();
  const toRefetch = lending.filter((p) => {
    // Cool-down: never refetch a protocol whose last successful history-fetch
    // was within REFETCH_COOLDOWN_MS — even if the delta gate would otherwise
    // mark it. This is the actual fix for the flapping bug; the anchor alone
    // doesn't help when /protocols itself returns ±1% drift between calls.
    const lastSyncMs = syncedAtMap.get(p.slug);
    if (lastSyncMs != null && nowMs - lastSyncMs < REFETCH_COOLDOWN_MS) return false;
    return shouldRefetchProtocol(anchorMap.get(p.slug) ?? null, p.tvl);
  });
  const batch = toRefetch.slice(0, PER_TICK_REFETCH_CAP);
  const batchSlugs = new Set(batch.map((p) => p.slug));

  // 3 + 4. Fetch history for the batch (dedupe by slug|chain|date).
  const tvlByKey = new Map<string, unknown[]>();
  const skipped: LendingDenomResult['notes']['skipped'] = [];
  for (const p of batch) {
    try {
      const detail = await llama.protocol(p.slug);
      for (const [chainKey, data] of Object.entries(detail.chainTvls ?? {})) {
        if (!isRealChainKey(chainKey)) continue;
        if (!data?.tvl?.length) continue;
        for (const point of data.tvl) {
          if (point.date * 1000 < cutoffMs) continue;
          const date = unixToDate(point.date);
          tvlByKey.set(`${p.slug}|${chainKey}|${date}`, [
            p.slug, chainKey, date, point.totalLiquidityUSD,
          ]);
        }
      }
    } catch (err) {
      skipped.push({ slug: p.slug, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const tvlRows = [...tvlByKey.values()];

  const tvlWritten = await batchInsert(
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

  // 5. Snapshot upserts.
  //    - last_tvl_usd  → refreshed for ALL lending protocols every tick (diag only)
  //    - last_fetched_history_tvl_usd → set ONLY for batch members; this is the
  //      stable anchor the delta gate reads on the next tick.
  //    - last_history_synced_at → set only for batch members.
  const snapshotRows = lending.map((p) => [
    p.slug,
    p.name,
    p.category,
    p.tvl,                                              // last_tvl_usd: always update for diag
    batchSlugs.has(p.slug) ? p.tvl : null,              // anchor: only on successful fetch
    batchSlugs.has(p.slug) ? now : null,                // history_synced_at: ditto
  ]);
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
        last_fetched_history_tvl_usd = COALESCE(
          EXCLUDED.last_fetched_history_tvl_usd,
          morpho_.defillama_protocols_snapshot.last_fetched_history_tvl_usd
        ),
        last_history_synced_at       = COALESCE(
          EXCLUDED.last_history_synced_at,
          morpho_.defillama_protocols_snapshot.last_history_synced_at
        )`,
    },
  );

  // 6. Rebuild chain_lending_tvl_daily.
  //
  //    For days older than 60: strict GROUP BY (cheap, historical data is
  //    stable — long-tail protocols' DefiLlama indexing eventually catches up).
  //
  //    For the last 60 days: CARRY-FORWARD semantics. The strict version
  //    artificially deflates today's denominator because DefiLlama lags ~24h on
  //    long-tail protocols. We replace it with: for each (chain, target_date),
  //    take each protocol's latest snapshot in [target - 14d, target] and sum.
  //    The 14-day floor stops dead protocols from polluting the carry-forward.
  await sql`
    INSERT INTO morpho_.chain_lending_tvl_daily
      (chain_slug, snapshot_date, lending_tvl_usd, protocol_count)
    SELECT
      t.chain_slug,
      t.snapshot_date,
      SUM(t.tvl_usd)                        AS lending_tvl_usd,
      COUNT(DISTINCT t.protocol_slug)::int  AS protocol_count
    FROM morpho_.protocol_tvl_daily t
    JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
    WHERE s.category IN ('Lending', 'CDP')
      AND t.snapshot_date >= CURRENT_DATE - INTERVAL '730 days'
      AND t.snapshot_date <  CURRENT_DATE - INTERVAL '60 days'
    GROUP BY t.chain_slug, t.snapshot_date
    ON CONFLICT (chain_slug, snapshot_date) DO UPDATE SET
      lending_tvl_usd = EXCLUDED.lending_tvl_usd,
      protocol_count  = EXCLUDED.protocol_count,
      recorded_at     = NOW()
  `;

  await sql`
    INSERT INTO morpho_.chain_lending_tvl_daily
      (chain_slug, snapshot_date, lending_tvl_usd, protocol_count)
    WITH target_dates AS (
      SELECT generate_series(
        CURRENT_DATE - INTERVAL '60 days',
        CURRENT_DATE,
        INTERVAL '1 day'
      )::date AS d
    ),
    chain_protocols AS (
      SELECT DISTINCT t.chain_slug, t.protocol_slug
      FROM morpho_.protocol_tvl_daily t
      JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
      WHERE s.category IN ('Lending', 'CDP')
        AND t.snapshot_date >= CURRENT_DATE - INTERVAL '90 days'
    ),
    carry AS (
      SELECT DISTINCT ON (cp.chain_slug, cp.protocol_slug, td.d)
        cp.chain_slug,
        cp.protocol_slug,
        td.d                  AS target_date,
        t.tvl_usd
      FROM chain_protocols cp
      CROSS JOIN target_dates td
      LEFT JOIN morpho_.protocol_tvl_daily t
        ON t.chain_slug    = cp.chain_slug
       AND t.protocol_slug = cp.protocol_slug
       AND t.snapshot_date <= td.d
       AND t.snapshot_date >= td.d - INTERVAL '14 days'
      ORDER BY cp.chain_slug, cp.protocol_slug, td.d, t.snapshot_date DESC NULLS LAST
    )
    SELECT
      chain_slug,
      target_date AS snapshot_date,
      SUM(tvl_usd)::numeric AS lending_tvl_usd,
      COUNT(tvl_usd)::int    AS protocol_count
    FROM carry
    WHERE tvl_usd IS NOT NULL
    GROUP BY chain_slug, target_date
    HAVING SUM(tvl_usd) > 0
    ON CONFLICT (chain_slug, snapshot_date) DO UPDATE SET
      lending_tvl_usd = EXCLUDED.lending_tvl_usd,
      protocol_count  = EXCLUDED.protocol_count,
      recorded_at     = NOW()
  `;

  const hasMore = toRefetch.length > PER_TICK_REFETCH_CAP;
  return {
    written: tvlWritten,
    hasMore,
    notes: {
      lendingProtocolsTotal: lending.length,
      toRefetchTotal: toRefetch.length,
      batchProcessed: batch.length,
      hasMoreToRefetch: hasMore,
      skipped,
    },
  };
}
