import { DefiLlamaClient } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';

// The overcollateralized lending sector we compare Morpho against on /rates.
// DefiLlama yields `project` slugs.
const PROTOCOLS = ['aave-v3', 'sparklend', 'compound-v3', 'fluid-lending', 'euler-v2'] as const;

// 4 chains × 4 assets. (chainId, DefiLlama chain name, canonical symbol).
const CHAINS: { chainId: number; llamaChain: string }[] = [
  { chainId: 1, llamaChain: 'Ethereum' },
  { chainId: 8453, llamaChain: 'Base' },
  { chainId: 42161, llamaChain: 'Arbitrum' },
  { chainId: 137, llamaChain: 'Polygon' },
];
const ASSETS = ['USDC', 'USDT', 'DAI', 'WETH'] as const;

export interface CompetitorRatesResult {
  written: number;
  notes: {
    poolsResolved: number;
    perProtocol: Record<string, number>;
    skipped: { protocol: string; chainId: number; symbol: string; reason: string }[];
  };
}

// Normalize DefiLlama pool symbols to canonical tickers (USDC.E → USDC, etc.).
const norm = (s: string) => {
  const u = s.toUpperCase().replace(/\./g, '');
  if (/^USDCE$/.test(u)) return 'USDC';
  if (/^USDT0$/.test(u)) return 'USDT';
  if (/^W?ETH$/.test(u)) return 'WETH';
  return u;
};

// Writes TODAY's supply/borrow rates for aave-v3, sparklend, compound-v3,
// fluid-lending, euler-v2 across the 4 target chains × 4 assets. Reads the
// current values straight off the /pools list (one DefiLlama call) rather than
// fetching a per-pool /chart for each — the latter is ~80 subrequests and blows
// the Cloudflare Worker 50-subreq cap, which is why this never populated before.
// History accumulates one row per day as the 6h cron upserts (chain, protocol,
// asset, today).
export async function syncCompetitorRates(
  sql: SqlClient,
  llama: DefiLlamaClient,
): Promise<CompetitorRatesResult> {
  const skipped: CompetitorRatesResult['notes']['skipped'] = [];
  const perProtocol: Record<string, number> = {};
  const today = new Date().toISOString().slice(0, 10);

  const allPools = await llama.yieldPools();

  const rows: unknown[][] = [];
  for (const protocol of PROTOCOLS) {
    const pools = allPools.filter((p) => p.project === protocol);
    perProtocol[protocol] = 0;
    for (const c of CHAINS) {
      for (const symbol of ASSETS) {
        const matches = pools.filter((p) => p.chain === c.llamaChain && norm(p.symbol) === norm(symbol));
        if (matches.length === 0) {
          skipped.push({ protocol, chainId: c.chainId, symbol, reason: 'no pool match' });
          continue;
        }
        const top = matches.sort((a, b) => b.tvlUsd - a.tvlUsd)[0]!;
        const supplyApy = top.apy ?? top.apyBase ?? null;
        const baseBorrow = top.apyBaseBorrow ?? null;
        const rewardBorrow = top.apyRewardBorrow ?? 0;
        const borrowApy = baseBorrow == null ? null : Math.max(0, baseBorrow - rewardBorrow);
        const supplyUsd = top.totalSupplyUsd ?? top.tvlUsd ?? null;
        const borrowUsd = top.totalBorrowUsd ?? null;
        const util = supplyUsd != null && borrowUsd != null && supplyUsd > 0 ? borrowUsd / supplyUsd : null;
        rows.push([
          c.chainId, protocol, symbol, today,
          supplyApy == null ? null : supplyApy / 100,   // % → fraction (match Morpho 0..1)
          borrowApy == null ? null : borrowApy / 100,
          util, supplyUsd, borrowUsd, top.pool,
        ]);
        perProtocol[protocol]!++;
      }
    }
  }

  const written = await batchInsert(
    sql,
    'morpho_.competitor_rates_daily',
    ['chain_id', 'protocol_slug', 'asset_symbol', 'snapshot_date', 'supply_apy', 'borrow_apy', 'utilization', 'supply_usd', 'borrow_usd', 'pool_id'],
    rows,
    {
      onConflict: `ON CONFLICT (chain_id, protocol_slug, asset_symbol, snapshot_date) DO UPDATE SET
        supply_apy = EXCLUDED.supply_apy, borrow_apy = EXCLUDED.borrow_apy, utilization = EXCLUDED.utilization,
        supply_usd = EXCLUDED.supply_usd, borrow_usd = EXCLUDED.borrow_usd, pool_id = EXCLUDED.pool_id, recorded_at = NOW()`,
    },
  );

  return { written, notes: { poolsResolved: rows.length, perProtocol, skipped } };
}
