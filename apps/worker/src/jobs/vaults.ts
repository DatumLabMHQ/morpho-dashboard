import { MorphoClient, type MorphoVault } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';
import { bigIntToText, lc, todayUtc, unixToIso } from '../lib/convert.js';

export interface VaultsSyncResult {
  written: number;
  notes: {
    vaultsFetched: number;
    assetsWritten: number;
    stateRowsWritten: number;
    extraCuratorsWritten: number;
    unresolvedCurators: number;
  };
}

const PAGE_SIZE = 100;
const MAX_PAGES = 5;     // 500 vaults — top by TotalAssetsUsd

export async function syncVaults(
  sql: SqlClient,
  morpho: MorphoClient,
): Promise<VaultsSyncResult> {
  // ----- Pagination -----
  const fetched: MorphoVault[] = [];
  let skip = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await morpho.vaults({ first: PAGE_SIZE, skip });
    fetched.push(...res.items);
    if (res.items.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    if (res.pageInfo && skip >= (res.pageInfo.countTotal ?? 0)) break;
  }

  // Defensive dedupe by (chain_id, address) — same reason as markets.
  const byKey = new Map<string, MorphoVault>();
  for (const v of fetched) byKey.set(`${v.chain.id}:${v.address.toLowerCase()}`, v);
  const all = [...byKey.values()];

  if (all.length === 0) {
    return {
      written: 0,
      notes: {
        vaultsFetched: 0,
        assetsWritten: 0,
        stateRowsWritten: 0,
        extraCuratorsWritten: 0,
        unresolvedCurators: 0,
      },
    };
  }

  // ----- Pre-fetch curator address → id map for V1 fallback resolution -----
  // V2 vaults already expose state.curators[].id; V1 vaults only have an address.
  const addrMap = new Map<string, string>();   // "chainId:address" → curator_id
  const addrRows = (await sql`
    SELECT chain_id, address, curator_id FROM morpho_.curator_addresses
  `) as { chain_id: number | null; address: string; curator_id: string }[];
  for (const r of addrRows) {
    if (r.chain_id != null) {
      addrMap.set(`${r.chain_id}:${r.address.toLowerCase()}`, r.curator_id);
    }
    // Cross-chain (chain_id null) entries also indexed by address only as fallback.
    addrMap.set(`*:${r.address.toLowerCase()}`, r.curator_id);
  }

  function resolveCuratorId(v: MorphoVault): { primaryId: string | null; extras: string[] } {
    const state = v.state;
    if (!state) return { primaryId: null, extras: [] };
    // Prefer Morpho's V2 list.
    if (state.curators.length > 0) {
      return {
        primaryId: state.curators[0]!.id,
        extras: state.curators.slice(1).map((c) => c.id),
      };
    }
    // V1 fallback: look up the curator address.
    const addr = state.curator?.toLowerCase();
    if (!addr) return { primaryId: null, extras: [] };
    const primary =
      addrMap.get(`${v.chain.id}:${addr}`) ?? addrMap.get(`*:${addr}`) ?? null;
    return { primaryId: primary, extras: [] };
  }

  // ----- Assets (just the underlying for each vault) -----
  const assetKey = (chainId: number, addr: string) => `${chainId}:${addr}`;
  const assets = new Map<string, { chainId: number; address: string; symbol: string; name: string | null; decimals: number }>();
  for (const v of all) {
    const addr = lc(v.asset.address)!;
    assets.set(assetKey(v.chain.id, addr), {
      chainId: v.chain.id,
      address: addr,
      symbol: v.asset.symbol,
      name: v.asset.name,
      decimals: v.asset.decimals,
    });
  }
  const assetsWritten = await batchInsert(
    sql,
    'morpho_.assets',
    ['chain_id', 'address', 'symbol', 'name', 'decimals'],
    [...assets.values()].map((a) => [a.chainId, a.address, a.symbol, a.name, a.decimals]),
    {
      onConflict: `ON CONFLICT (chain_id, address) DO UPDATE SET
        symbol         = EXCLUDED.symbol,
        name           = EXCLUDED.name,
        decimals       = EXCLUDED.decimals,
        last_synced_at = NOW()`,
    },
  );

  // ----- Vaults + resolved curator + extras -----
  let unresolvedCurators = 0;
  const vaultRows: unknown[][] = [];
  const extraCuratorRows: unknown[][] = [];

  for (const v of all) {
    const { primaryId, extras } = resolveCuratorId(v);
    if (v.state?.curator && primaryId == null) unresolvedCurators++;

    vaultRows.push([
      v.chain.id,
      lc(v.address)!,
      v.symbol,
      v.name,
      lc(v.asset.address)!,
      v.asset.symbol,
      primaryId,
      lc(v.state?.curator),
      lc(v.state?.feeRecipient),
      v.state?.fee != null ? Math.round(v.state.fee * 10_000) : null,    // fraction → bps
      v.listed,
      v.featured,
      unixToIso(v.creationTimestamp),
    ]);

    for (const extraId of extras) {
      extraCuratorRows.push([v.chain.id, lc(v.address)!, extraId]);
    }
  }

  await batchInsert(
    sql,
    'morpho_.vaults',
    [
      'chain_id', 'address', 'symbol', 'name',
      'asset_address', 'asset_symbol',
      'curator_id', 'curator_address_raw',
      'fee_recipient_address', 'performance_fee_bps',
      'listed', 'featured', 'created_at',
    ],
    vaultRows,
    {
      onConflict: `ON CONFLICT (chain_id, address) DO UPDATE SET
        symbol                = EXCLUDED.symbol,
        name                  = EXCLUDED.name,
        asset_address         = EXCLUDED.asset_address,
        asset_symbol          = EXCLUDED.asset_symbol,
        curator_id            = EXCLUDED.curator_id,
        curator_address_raw   = EXCLUDED.curator_address_raw,
        fee_recipient_address = EXCLUDED.fee_recipient_address,
        performance_fee_bps   = EXCLUDED.performance_fee_bps,
        listed                = EXCLUDED.listed,
        featured              = EXCLUDED.featured,
        last_synced_at        = NOW()`,
    },
  );

  // Refresh extras: delete existing rows for these vaults, then insert.
  const vaultKeys = all.map((v) => `${v.chain.id}:${lc(v.address)!}`);
  await sql`
    DELETE FROM morpho_.vault_curators_extra
    WHERE (chain_id::text || ':' || vault_address) = ANY(${vaultKeys}::text[])
  `;
  const extraCuratorsWritten = await batchInsert(
    sql,
    'morpho_.vault_curators_extra',
    ['chain_id', 'vault_address', 'curator_id'],
    extraCuratorRows,
  );

  // ----- Today's vault state snapshot -----
  const today = todayUtc();
  const stateRows: unknown[][] = [];
  for (const v of all) {
    if (!v.state) continue;
    const s = v.state;
    stateRows.push([
      v.chain.id,
      lc(v.address)!,
      today,
      bigIntToText(s.totalAssets),
      s.totalAssetsUsd,
      bigIntToText(s.totalSupply),
      s.sharePriceUsd,
      s.apy,
      s.netApy,
      s.fee != null ? Math.round(s.fee * 10_000) : null,
    ]);
  }
  const stateRowsWritten = await batchInsert(
    sql,
    'morpho_.vault_state_daily',
    [
      'chain_id', 'vault_address', 'snapshot_date',
      'total_assets', 'total_assets_usd',
      'total_supply', 'share_price',
      'apy', 'net_apy', 'fee_bps',
    ],
    stateRows,
    {
      onConflict: `ON CONFLICT (chain_id, vault_address, snapshot_date) DO UPDATE SET
        total_assets     = EXCLUDED.total_assets,
        total_assets_usd = EXCLUDED.total_assets_usd,
        total_supply     = EXCLUDED.total_supply,
        share_price      = EXCLUDED.share_price,
        apy              = EXCLUDED.apy,
        net_apy          = EXCLUDED.net_apy,
        fee_bps          = EXCLUDED.fee_bps,
        recorded_at      = NOW()`,
    },
  );

  return {
    written: all.length,
    notes: {
      vaultsFetched: all.length,
      assetsWritten,
      stateRowsWritten,
      extraCuratorsWritten,
      unresolvedCurators,
    },
  };
}
