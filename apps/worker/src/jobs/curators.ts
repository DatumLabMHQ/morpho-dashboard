import { MorphoClient, type MorphoCurator } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';
import { lc } from '../lib/convert.js';

export interface CuratorsSyncResult {
  written: number;
  notes: {
    curatorsFetched: number;
    addressesWritten: number;
  };
}

const PAGE_SIZE = 100;

// Paginates the entire `curators` query (typically a few hundred rows),
// then upserts curators + replaces curator_addresses for each known curator.
export async function syncCurators(
  sql: SqlClient,
  morpho: MorphoClient,
): Promise<CuratorsSyncResult> {
  const all: MorphoCurator[] = [];
  let skip = 0;
  while (true) {
    const page = await morpho.curators({ first: PAGE_SIZE, skip });
    all.push(...page.items);
    if (page.items.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    // Safety cap — curator count is bounded; this prevents accidental runaway.
    if (skip >= 5000) break;
  }

  if (all.length === 0) {
    return { written: 0, notes: { curatorsFetched: 0, addressesWritten: 0 } };
  }

  // Upsert curators.
  const curatorRows = all.map((c) => [
    c.id,
    c.name,
    c.description,
    c.image,
    primaryUrl(c.socials),
    c.verified,
    c.ownerOnly,
  ]);
  await batchInsert(
    sql,
    'morpho_.curators',
    ['id', 'name', 'description', 'image_url', 'url', 'verified', 'owner_only'],
    curatorRows,
    {
      onConflict: `ON CONFLICT (id) DO UPDATE SET
        name           = EXCLUDED.name,
        description    = EXCLUDED.description,
        image_url      = EXCLUDED.image_url,
        url            = EXCLUDED.url,
        verified       = EXCLUDED.verified,
        owner_only     = EXCLUDED.owner_only,
        last_synced_at = NOW()`,
    },
  );

  // Refresh curator_addresses: DELETE then re-INSERT for the curators we just
  // synced. Non-atomic across the two statements — if the worker dies between
  // them, the next cron tick repairs.
  const curatorIds = all.map((c) => c.id);
  await sql`
    DELETE FROM morpho_.curator_addresses
    WHERE curator_id = ANY(${curatorIds}::text[])
  `;

  const addressRows: unknown[][] = [];
  for (const c of all) {
    for (const a of c.addresses) {
      const addr = lc(a.address);
      if (!addr) continue;
      addressRows.push([c.id, a.chainId, addr]);
    }
  }
  const addressesWritten = await batchInsert(
    sql,
    'morpho_.curator_addresses',
    ['curator_id', 'chain_id', 'address'],
    addressRows,
  );

  return {
    written: curatorRows.length,
    notes: { curatorsFetched: all.length, addressesWritten },
  };
}

function primaryUrl(socials: MorphoCurator['socials']): string | null {
  return socials.find((s) => s.type === 'url')?.url ?? null;
}
