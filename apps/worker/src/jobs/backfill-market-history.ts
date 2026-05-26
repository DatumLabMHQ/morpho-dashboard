import { MorphoClient, type MorphoTimeseriesPoint } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';
import { unixToDate } from '../lib/convert.js';

const JOB = 'backfill-market-history';
const PER_TICK = 10;
const HISTORY_DAYS = 365;

export interface BackfillMarketHistoryResult {
  written: number;
  hasMore: boolean;
  notes: {
    seeded: number;          // new cursor rows added (covers markets that appeared since last tick)
    processed: number;
    skipped: { marketId: string; chainId: number; error: string }[];
  };
}

// Cursor-driven backfill of market_state_daily over the last 12 months.
// Each /backfill/tick processes PER_TICK markets. Auto-seeds new markets on
// every tick (idempotent INSERT ... SELECT) so newly-added markets get picked
// up without manual reset.
export async function backfillMarketHistory(
  sql: SqlClient,
  morpho: MorphoClient,
): Promise<BackfillMarketHistoryResult> {
  // 1. Seed (idempotent — only inserts cursors that don't exist yet).
  const seedResult = (await sql`
    INSERT INTO morpho_.sync_cursors (job, scope_key, cursor_value, done)
    SELECT ${JOB}, unique_key, NULL, FALSE FROM morpho_.markets
    ON CONFLICT (job, scope_key) DO NOTHING
    RETURNING scope_key
  `) as { scope_key: string }[];

  // 2. Pick the next batch of pending cursors, with chain_id from markets.
  const targets = (await sql`
    SELECT m.chain_id, m.unique_key AS market_id
    FROM morpho_.sync_cursors c
    JOIN morpho_.markets m ON m.unique_key = c.scope_key
    WHERE c.job = ${JOB} AND NOT c.done
    ORDER BY c.updated_at ASC
    LIMIT ${PER_TICK}
  `) as { chain_id: number; market_id: string }[];

  if (targets.length === 0) {
    return {
      written: 0,
      hasMore: false,
      notes: { seeded: seedResult.length, processed: 0, skipped: [] },
    };
  }

  // 3. Fetch + merge 9 timeseries per market into one row per (market, date).
  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - HISTORY_DAYS * 86_400;
  const stateRows: unknown[][] = [];
  const skipped: BackfillMarketHistoryResult['notes']['skipped'] = [];
  const completedKeys: string[] = [];

  for (const t of targets) {
    try {
      const h = await morpho.marketHistory(t.market_id, t.chain_id, {
        startTimestamp: startTs,
        endTimestamp: endTs,
        interval: 'DAY',
      });

      const byDate = new Map<string, Record<string, number | null>>();
      const addSeries = (field: string, series: MorphoTimeseriesPoint[]) => {
        for (const p of series) {
          const date = unixToDate(p.x);
          let row = byDate.get(date);
          if (!row) {
            row = {};
            byDate.set(date, row);
          }
          row[field] = p.y;
        }
      };
      addSeries('supply_assets_usd', h.supplyAssetsUsd);
      addSeries('borrow_assets_usd', h.borrowAssetsUsd);
      addSeries('collateral_assets_usd', h.collateralAssetsUsd);
      addSeries('liquidity_assets_usd', h.liquidityAssetsUsd);
      addSeries('utilization', h.utilization);
      addSeries('supply_apy', h.supplyApy);
      addSeries('borrow_apy', h.borrowApy);
      addSeries('net_supply_apy', h.netSupplyApy);
      addSeries('net_borrow_apy', h.netBorrowApy);

      for (const [date, vals] of byDate) {
        stateRows.push([
          t.market_id, date,
          vals.supply_assets_usd ?? null,
          vals.borrow_assets_usd ?? null,
          vals.collateral_assets_usd ?? null,
          vals.liquidity_assets_usd ?? null,
          vals.utilization ?? null,
          vals.supply_apy ?? null,
          vals.borrow_apy ?? null,
          vals.net_supply_apy ?? null,
          vals.net_borrow_apy ?? null,
        ]);
      }
      completedKeys.push(t.market_id);
    } catch (err) {
      skipped.push({
        marketId: t.market_id,
        chainId: t.chain_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Upsert state rows. We never touch BigInt/raw_amount columns or bad-debt
  //    in the backfill path — the API's historicalState doesn't expose them.
  //    Today's steady-state markets sync fills those for the latest day.
  const written = await batchInsert(
    sql,
    'morpho_.market_state_daily',
    [
      'market_unique_key', 'snapshot_date',
      'supply_assets_usd', 'borrow_assets_usd',
      'collateral_assets_usd', 'liquidity_assets_usd',
      'utilization',
      'supply_apy', 'borrow_apy', 'net_supply_apy', 'net_borrow_apy',
    ],
    stateRows,
    {
      onConflict: `ON CONFLICT (market_unique_key, snapshot_date) DO UPDATE SET
        supply_assets_usd     = COALESCE(EXCLUDED.supply_assets_usd,     morpho_.market_state_daily.supply_assets_usd),
        borrow_assets_usd     = COALESCE(EXCLUDED.borrow_assets_usd,     morpho_.market_state_daily.borrow_assets_usd),
        collateral_assets_usd = COALESCE(EXCLUDED.collateral_assets_usd, morpho_.market_state_daily.collateral_assets_usd),
        liquidity_assets_usd  = COALESCE(EXCLUDED.liquidity_assets_usd,  morpho_.market_state_daily.liquidity_assets_usd),
        utilization           = COALESCE(EXCLUDED.utilization,           morpho_.market_state_daily.utilization),
        supply_apy            = COALESCE(EXCLUDED.supply_apy,            morpho_.market_state_daily.supply_apy),
        borrow_apy            = COALESCE(EXCLUDED.borrow_apy,            morpho_.market_state_daily.borrow_apy),
        net_supply_apy        = COALESCE(EXCLUDED.net_supply_apy,        morpho_.market_state_daily.net_supply_apy),
        net_borrow_apy        = COALESCE(EXCLUDED.net_borrow_apy,        morpho_.market_state_daily.net_borrow_apy),
        recorded_at           = NOW()`,
    },
  );

  // 5. Mark cursors done for successfully-processed markets.
  if (completedKeys.length > 0) {
    await sql`
      UPDATE morpho_.sync_cursors
      SET done = TRUE, updated_at = NOW()
      WHERE job = ${JOB} AND scope_key = ANY(${completedKeys}::text[])
    `;
  }

  return {
    written,
    hasMore: targets.length === PER_TICK,
    notes: {
      seeded: seedResult.length,
      processed: completedKeys.length,
      skipped,
    },
  };
}
