import { MorphoClient, type MorphoMarket } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';
import { bigIntToText, lc, lltvToDecimal, todayUtc, unixToIso } from '../lib/convert.js';

export interface MarketsSyncResult {
  written: number;
  notes: {
    marketsFetched: number;
    assetsWritten: number;
    stateRowsWritten: number;
    badDebtComputedCount: number;   // markets where we fell back to supply-borrow diff
    statelessMarkets: number;       // markets returned without a state{} block
  };
}

const PAGE_SIZE = 100;
const MAX_PAGES = 10;     // 1000 markets — top by SupplyAssetsUsd covers >95% of TVL

export async function syncMarkets(
  sql: SqlClient,
  morpho: MorphoClient,
): Promise<MarketsSyncResult> {
  // ----- Pagination -----
  const fetched: MorphoMarket[] = [];
  let skip = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await morpho.markets({ first: PAGE_SIZE, skip });
    fetched.push(...res.items);
    if (res.items.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    if (res.pageInfo && skip >= (res.pageInfo.countTotal ?? 0)) break;
  }

  // Dedupe by marketId — pagination order isn't stable when many markets share
  // a null/zero supplyAssetsUsd, so the same market can appear on two pages.
  const byId = new Map<string, MorphoMarket>();
  for (const m of fetched) byId.set(m.marketId, m);
  const all = [...byId.values()];

  if (all.length === 0) {
    return {
      written: 0,
      notes: {
        marketsFetched: 0,
        assetsWritten: 0,
        stateRowsWritten: 0,
        badDebtComputedCount: 0,
        statelessMarkets: 0,
      },
    };
  }

  // ----- Assets (dedupe on chain_id + address) -----
  const assetKey = (chainId: number, addr: string) => `${chainId}:${addr}`;
  const assets = new Map<string, { chainId: number; address: string; symbol: string; name: string | null; decimals: number }>();
  for (const m of all) {
    const loanAddr = lc(m.loanAsset.address)!;
    assets.set(assetKey(m.chain.id, loanAddr), {
      chainId: m.chain.id,
      address: loanAddr,
      symbol: m.loanAsset.symbol,
      name: m.loanAsset.name,
      decimals: m.loanAsset.decimals,
    });
    if (m.collateralAsset) {
      const collAddr = lc(m.collateralAsset.address)!;
      assets.set(assetKey(m.chain.id, collAddr), {
        chainId: m.chain.id,
        address: collAddr,
        symbol: m.collateralAsset.symbol,
        name: m.collateralAsset.name,
        decimals: m.collateralAsset.decimals,
      });
    }
  }

  const assetRows = [...assets.values()].map((a) => [
    a.chainId,
    a.address,
    a.symbol,
    a.name,
    a.decimals,
  ]);
  const assetsWritten = await batchInsert(
    sql,
    'morpho_.assets',
    ['chain_id', 'address', 'symbol', 'name', 'decimals'],
    assetRows,
    {
      onConflict: `ON CONFLICT (chain_id, address) DO UPDATE SET
        symbol         = EXCLUDED.symbol,
        name           = EXCLUDED.name,
        decimals       = EXCLUDED.decimals,
        last_synced_at = NOW()`,
    },
  );

  // ----- Markets -----
  const marketRows = all.map((m) => [
    m.marketId,
    m.chain.id,
    lc(m.loanAsset.address)!,
    lc(m.collateralAsset?.address),
    null,                                          // oracle_address (not pulled in list query)
    lc(m.irmAddress),
    lltvToDecimal(m.lltv),
    m.loanAsset.symbol,
    m.collateralAsset?.symbol ?? null,
    unixToIso(m.creationTimestamp),
  ]);
  await batchInsert(
    sql,
    'morpho_.markets',
    [
      'unique_key', 'chain_id',
      'loan_asset_address', 'collateral_asset_address',
      'oracle_address', 'irm_address', 'lltv',
      'loan_asset_symbol', 'collateral_asset_symbol',
      'created_at',
    ],
    marketRows,
    {
      onConflict: `ON CONFLICT (unique_key) DO UPDATE SET
        chain_id                 = EXCLUDED.chain_id,
        loan_asset_address       = EXCLUDED.loan_asset_address,
        collateral_asset_address = EXCLUDED.collateral_asset_address,
        irm_address              = EXCLUDED.irm_address,
        lltv                     = EXCLUDED.lltv,
        loan_asset_symbol        = EXCLUDED.loan_asset_symbol,
        collateral_asset_symbol  = EXCLUDED.collateral_asset_symbol,
        last_synced_at           = NOW()`,
    },
  );

  // ----- Today's state snapshot -----
  const today = todayUtc();
  let badDebtComputedCount = 0;
  let statelessMarkets = 0;
  const stateRows: unknown[][] = [];

  for (const m of all) {
    if (!m.state) {
      statelessMarkets++;
      continue;
    }
    const s = m.state;
    const graphqlBadDebt = m.badDebt?.usd;
    const useGraphqlBadDebt = graphqlBadDebt != null;
    let badDebtUsd: number | null = null;
    if (useGraphqlBadDebt) {
      badDebtUsd = graphqlBadDebt;
    } else if (s.borrowAssetsUsd != null && s.supplyAssetsUsd != null) {
      badDebtUsd = Math.max(0, s.borrowAssetsUsd - s.supplyAssetsUsd);
      badDebtComputedCount++;
    }

    stateRows.push([
      m.marketId,
      today,
      bigIntToText(s.supplyAssets),
      s.supplyAssetsUsd,
      bigIntToText(s.borrowAssets),
      s.borrowAssetsUsd,
      s.collateralAssetsUsd,
      s.liquidityAssetsUsd,
      badDebtUsd,
      m.realizedBadDebt?.usd ?? null,
      useGraphqlBadDebt ? 'graphql' : badDebtUsd != null ? 'computed' : null,
      s.supplyApy,
      s.borrowApy,
      s.netSupplyApy,
      s.netBorrowApy,
      s.utilization,
      bigIntToText(s.price ?? null),
    ]);
  }

  const stateRowsWritten = await batchInsert(
    sql,
    'morpho_.market_state_daily',
    [
      'market_unique_key', 'snapshot_date',
      'supply_assets', 'supply_assets_usd',
      'borrow_assets', 'borrow_assets_usd',
      'collateral_assets_usd', 'liquidity_assets_usd',
      'bad_debt_assets_usd', 'realized_bad_debt_assets_usd', 'bad_debt_source',
      'supply_apy', 'borrow_apy', 'net_supply_apy', 'net_borrow_apy',
      'utilization', 'price',
    ],
    stateRows,
    {
      onConflict: `ON CONFLICT (market_unique_key, snapshot_date) DO UPDATE SET
        supply_assets                = EXCLUDED.supply_assets,
        supply_assets_usd            = EXCLUDED.supply_assets_usd,
        borrow_assets                = EXCLUDED.borrow_assets,
        borrow_assets_usd            = EXCLUDED.borrow_assets_usd,
        collateral_assets_usd        = EXCLUDED.collateral_assets_usd,
        liquidity_assets_usd         = EXCLUDED.liquidity_assets_usd,
        bad_debt_assets_usd          = EXCLUDED.bad_debt_assets_usd,
        realized_bad_debt_assets_usd = EXCLUDED.realized_bad_debt_assets_usd,
        bad_debt_source              = EXCLUDED.bad_debt_source,
        supply_apy                   = EXCLUDED.supply_apy,
        borrow_apy                   = EXCLUDED.borrow_apy,
        net_supply_apy               = EXCLUDED.net_supply_apy,
        net_borrow_apy               = EXCLUDED.net_borrow_apy,
        utilization                  = EXCLUDED.utilization,
        price                        = EXCLUDED.price,
        recorded_at                  = NOW()`,
    },
  );

  return {
    written: all.length,
    notes: {
      marketsFetched: all.length,
      assetsWritten,
      stateRowsWritten,
      badDebtComputedCount,
      statelessMarkets,
    },
  };
}
