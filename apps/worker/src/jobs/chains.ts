import {
  MorphoClient,
  deriveChainName,
  getChainMeta,
} from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';

export interface ChainsSyncResult {
  written: number;
  notes: {
    chainsFetched: number;
    unknownChainIds: number[];
  };
}

// Fetches Morpho's chain registry and upserts in one batched INSERT.
// CHAIN_META supplies display name + DefiLlama slug; unknown chain_ids fall
// back to a derived name and null slug (and are logged in notes for triage).
export async function syncChains(
  sql: SqlClient,
  morpho: MorphoClient,
): Promise<ChainsSyncResult> {
  const chains = await morpho.chains();
  const unknownChainIds: number[] = [];

  const rows = chains.map((c) => {
    const meta = getChainMeta(c.id);
    if (!meta) unknownChainIds.push(c.id);
    return [
      c.id,
      meta?.name ?? deriveChainName(c.network),
      c.network,
      meta?.llamaSlug ?? null,
      true,
    ];
  });

  // COALESCE on slug preserves a manually-set value if the new sync passes null.
  await batchInsert(
    sql,
    'morpho_.chains',
    ['chain_id', 'name', 'network', 'slug', 'is_active'],
    rows,
    {
      onConflict: `ON CONFLICT (chain_id) DO UPDATE SET
        name           = EXCLUDED.name,
        network        = EXCLUDED.network,
        slug           = COALESCE(EXCLUDED.slug, morpho_.chains.slug),
        is_active      = TRUE,
        last_synced_at = NOW()`,
    },
  );

  return {
    written: rows.length,
    notes: { chainsFetched: chains.length, unknownChainIds },
  };
}
