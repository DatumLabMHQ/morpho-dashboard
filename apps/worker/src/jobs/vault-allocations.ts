import { MorphoClient } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';
import { bigIntToText, lc, todayUtc } from '../lib/convert.js';

const PER_TICK = 10;

export interface VaultAllocationsResult {
  written: number;
  hasMore: boolean;
  notes: {
    vaultsProcessed: number;
    allocationsWritten: number;
    skipped: { vaultAddress: string; chainId: number; error: string }[];
  };
}

// SQL-driven backfill: each tick picks PER_TICK vaults missing today's allocation
// row and fetches their current allocations via vaultByAddress. No sync_cursors
// needed — the "missing row" predicate is the cursor. Idempotent on rerun.
//
// Morpho's API exposes only CURRENT allocations (no historical timeseries),
// so this is a "snapshot today" job; older snapshots remain whatever was
// written on their respective day.
export async function syncVaultAllocations(
  sql: SqlClient,
  morpho: MorphoClient,
): Promise<VaultAllocationsResult> {
  const today = todayUtc();

  const targets = (await sql`
    SELECT v.chain_id, v.address
    FROM morpho_.vaults v
    LEFT JOIN morpho_.vault_allocations_daily a
      ON a.chain_id = v.chain_id
     AND a.vault_address = v.address
     AND a.snapshot_date = ${today}
    WHERE a.snapshot_date IS NULL
    ORDER BY v.last_synced_at DESC NULLS LAST
    LIMIT ${PER_TICK}
  `) as { chain_id: number; address: string }[];

  if (targets.length === 0) {
    return {
      written: 0,
      hasMore: false,
      notes: { vaultsProcessed: 0, allocationsWritten: 0, skipped: [] },
    };
  }

  const allocRows: unknown[][] = [];
  const skipped: VaultAllocationsResult['notes']['skipped'] = [];

  for (const t of targets) {
    try {
      const v = await morpho.vaultByAddress(t.address, t.chain_id);
      if (!v.state?.allocation) continue;
      const totalUsd = v.state.totalAssetsUsd ?? 0;
      for (const a of v.state.allocation) {
        allocRows.push([
          t.chain_id,
          lc(t.address)!,
          a.market.marketId,
          today,
          bigIntToText(a.supplyAssets),
          a.supplyAssetsUsd,
          bigIntToText(a.supplyCap),
          totalUsd > 0 && a.supplyAssetsUsd != null
            ? a.supplyAssetsUsd / totalUsd
            : null,
        ]);
      }
    } catch (err) {
      skipped.push({
        vaultAddress: t.address,
        chainId: t.chain_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const allocationsWritten = await batchInsert(
    sql,
    'morpho_.vault_allocations_daily',
    [
      'chain_id', 'vault_address', 'market_unique_key', 'snapshot_date',
      'supply_assets', 'supply_assets_usd', 'supply_cap', 'supply_share_pct',
    ],
    allocRows,
    {
      onConflict: `ON CONFLICT (chain_id, vault_address, market_unique_key, snapshot_date) DO UPDATE SET
        supply_assets     = EXCLUDED.supply_assets,
        supply_assets_usd = EXCLUDED.supply_assets_usd,
        supply_cap        = EXCLUDED.supply_cap,
        supply_share_pct  = EXCLUDED.supply_share_pct,
        recorded_at       = NOW()`,
    },
  );

  return {
    written: targets.length,
    hasMore: targets.length === PER_TICK,
    notes: {
      vaultsProcessed: targets.length,
      allocationsWritten,
      skipped,
    },
  };
}
