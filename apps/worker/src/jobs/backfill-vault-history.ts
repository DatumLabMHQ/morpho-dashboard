import { MorphoClient, type MorphoTimeseriesPoint } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';
import { unixToDate } from '../lib/convert.js';

const JOB = 'backfill-vault-history';
const PER_TICK = 10;
const HISTORY_DAYS = 365;

// scope_key format: "<chain_id>:<address>"
const scopeKey = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

export interface BackfillVaultHistoryResult {
  written: number;
  hasMore: boolean;
  notes: {
    seeded: number;
    processed: number;
    skipped: { vaultAddress: string; chainId: number; error: string }[];
  };
}

export async function backfillVaultHistory(
  sql: SqlClient,
  morpho: MorphoClient,
): Promise<BackfillVaultHistoryResult> {
  // Seed cursors from vaults (idempotent).
  const seedResult = (await sql`
    INSERT INTO morpho_.sync_cursors (job, scope_key, cursor_value, done)
    SELECT ${JOB}, chain_id::text || ':' || address, NULL, FALSE
    FROM morpho_.vaults
    ON CONFLICT (job, scope_key) DO NOTHING
    RETURNING scope_key
  `) as { scope_key: string }[];

  // Pick next batch and recover (chain_id, address) by JOINing back to vaults.
  const targets = (await sql`
    SELECT v.chain_id, v.address
    FROM morpho_.sync_cursors c
    JOIN morpho_.vaults v ON v.chain_id::text || ':' || v.address = c.scope_key
    WHERE c.job = ${JOB} AND NOT c.done
    ORDER BY c.updated_at ASC
    LIMIT ${PER_TICK}
  `) as { chain_id: number; address: string }[];

  if (targets.length === 0) {
    return {
      written: 0,
      hasMore: false,
      notes: { seeded: seedResult.length, processed: 0, skipped: [] },
    };
  }

  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - HISTORY_DAYS * 86_400;
  const stateRows: unknown[][] = [];
  const skipped: BackfillVaultHistoryResult['notes']['skipped'] = [];
  const completedKeys: string[] = [];

  for (const t of targets) {
    try {
      const h = await morpho.vaultHistory(t.address, t.chain_id, {
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
      addSeries('total_assets_usd', h.totalAssetsUsd);
      addSeries('apy', h.apy);
      addSeries('net_apy', h.netApy);
      addSeries('share_price', h.sharePriceUsd);
      addSeries('fee_frac', h.fee);     // 0..1 fraction → convert to bps on write

      for (const [date, vals] of byDate) {
        stateRows.push([
          t.chain_id,
          t.address.toLowerCase(),
          date,
          vals.total_assets_usd ?? null,
          vals.apy ?? null,
          vals.net_apy ?? null,
          vals.share_price ?? null,
          vals.fee_frac != null ? Math.round(vals.fee_frac * 10_000) : null,
        ]);
      }
      completedKeys.push(scopeKey(t.chain_id, t.address));
    } catch (err) {
      skipped.push({
        vaultAddress: t.address,
        chainId: t.chain_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const written = await batchInsert(
    sql,
    'morpho_.vault_state_daily',
    [
      'chain_id', 'vault_address', 'snapshot_date',
      'total_assets_usd', 'apy', 'net_apy', 'share_price', 'fee_bps',
    ],
    stateRows,
    {
      onConflict: `ON CONFLICT (chain_id, vault_address, snapshot_date) DO UPDATE SET
        total_assets_usd = COALESCE(EXCLUDED.total_assets_usd, morpho_.vault_state_daily.total_assets_usd),
        apy              = COALESCE(EXCLUDED.apy,              morpho_.vault_state_daily.apy),
        net_apy          = COALESCE(EXCLUDED.net_apy,          morpho_.vault_state_daily.net_apy),
        share_price      = COALESCE(EXCLUDED.share_price,      morpho_.vault_state_daily.share_price),
        fee_bps          = COALESCE(EXCLUDED.fee_bps,          morpho_.vault_state_daily.fee_bps),
        recorded_at      = NOW()`,
    },
  );

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
