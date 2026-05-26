import { DefiLlamaClient } from '@morpho-dashboard/core';
import type { SqlClient } from '@morpho-dashboard/db';

import { batchInsert } from '../db/batch.js';

// Aave V3 reserves we compare Morpho rates against on /rates.
// Tuples are (chain_id, defillama_chain_name, asset_symbol_in_pools).
// DefiLlama exposes pool symbols as the underlying ticker (USDC, USDT, DAI,
// WETH) for Aave V3 — these match what /rates queries expect.
const TARGETS: { chainId: number; llamaChain: string; symbol: string }[] = [
  // Ethereum
  { chainId: 1, llamaChain: 'Ethereum', symbol: 'USDC' },
  { chainId: 1, llamaChain: 'Ethereum', symbol: 'USDT' },
  { chainId: 1, llamaChain: 'Ethereum', symbol: 'DAI'  },
  { chainId: 1, llamaChain: 'Ethereum', symbol: 'WETH' },
  // Base
  { chainId: 8453, llamaChain: 'Base', symbol: 'USDC' },
  { chainId: 8453, llamaChain: 'Base', symbol: 'WETH' },
  // Arbitrum
  { chainId: 42161, llamaChain: 'Arbitrum', symbol: 'USDC' },
  { chainId: 42161, llamaChain: 'Arbitrum', symbol: 'USDT' },
  { chainId: 42161, llamaChain: 'Arbitrum', symbol: 'DAI'  },
  { chainId: 42161, llamaChain: 'Arbitrum', symbol: 'WETH' },
  // Polygon
  { chainId: 137, llamaChain: 'Polygon', symbol: 'USDC' },
  { chainId: 137, llamaChain: 'Polygon', symbol: 'USDT' },
  { chainId: 137, llamaChain: 'Polygon', symbol: 'DAI'  },
  { chainId: 137, llamaChain: 'Polygon', symbol: 'WETH' },
];

const HISTORY_DAYS = 365;

export interface AaveRatesResult {
  written: number;
  notes: {
    poolsResolved: number;
    skipped: { chainId: number; symbol: string; reason: string }[];
  };
}

// Pulls Aave V3 supply + borrow rate history from DefiLlama yields.
// Discovery: GET /pools, filter to project=aave-v3, match by (chain, symbol).
// History:   GET /chart/{poolId} per matched pool → upsert daily rows.
//
// 1 + (≤14) sub-requests per tick, well under the CF Workers free-tier cap.
// Idempotent via PRIMARY KEY (chain_id, asset_symbol, snapshot_date).
export async function syncAaveRates(
  sql: SqlClient,
  llama: DefiLlamaClient,
): Promise<AaveRatesResult> {
  const skipped: AaveRatesResult['notes']['skipped'] = [];
  const cutoffMs = Date.now() - HISTORY_DAYS * 86_400_000;

  // 1. Discover pool IDs for each target.
  const allPools = await llama.yieldPools();
  const aaveV3 = allPools.filter((p) => p.project === 'aave-v3');

  // Pool symbols on Aave V3 are sometimes the bare asset (USDC) and sometimes
  // a wrapped/aliased form: USDC.E (bridged), USDT0 (LayerZero bridged USDT
  // on Polygon since the native USDT pool was deprecated). Normalize so we can
  // match canonical tickers against the variants DefiLlama lists.
  const norm = (s: string) => {
    const upper = s.toUpperCase().replace(/\./g, '');
    if (/^USDCE$/.test(upper)) return 'USDC';
    if (/^USDT0$/.test(upper)) return 'USDT';
    if (/^W?ETH$/.test(upper)) return 'WETH';
    return upper;
  };

  const resolved: { chainId: number; symbol: string; poolId: string }[] = [];
  for (const t of TARGETS) {
    const matches = aaveV3.filter(
      (p) => p.chain === t.llamaChain && norm(p.symbol) === norm(t.symbol),
    );
    if (matches.length === 0) {
      skipped.push({ chainId: t.chainId, symbol: t.symbol, reason: 'no pool match' });
      continue;
    }
    // If multiple pools match (e.g. USDC vs USDC.E on Arbitrum), pick the
    // largest by TVL — the canonical Aave V3 reserve.
    const top = matches.sort((a, b) => b.tvlUsd - a.tvlUsd)[0]!;
    resolved.push({ chainId: t.chainId, symbol: t.symbol, poolId: top.pool });
  }

  // 2. Fetch chart for each resolved pool, accumulate daily rows.
  const rows: unknown[][] = [];
  for (const r of resolved) {
    let chart;
    try {
      chart = await llama.yieldChart(r.poolId);
    } catch (err) {
      skipped.push({
        chainId: r.chainId,
        symbol: r.symbol,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Collapse to one point per UTC date (DefiLlama emits hourly-ish).
    // Last-write-wins: later timestamps overwrite earlier within the same day.
    const byDate = new Map<string, typeof chart[number]>();
    for (const pt of chart) {
      const ms = Date.parse(pt.timestamp);
      if (!Number.isFinite(ms) || ms < cutoffMs) continue;
      const date = new Date(ms).toISOString().slice(0, 10);
      byDate.set(date, pt);
    }

    for (const [date, pt] of byDate) {
      // Supply APY: apy is base+reward; fall back to apyBase if needed.
      const supplyApy = pt.apy ?? pt.apyBase ?? null;
      // Borrow APY = base borrow minus rewards (rewards reduce borrow cost).
      // Most lending pools have no borrow rewards → just apyBaseBorrow.
      const baseBorrow = pt.apyBaseBorrow ?? null;
      const rewardBorrow = pt.apyRewardBorrow ?? 0;
      const borrowApy = baseBorrow == null ? null : Math.max(0, baseBorrow - rewardBorrow);
      const supplyUsd = pt.totalSupplyUsd ?? pt.tvlUsd ?? null;
      const borrowUsd = pt.totalBorrowUsd ?? null;
      const util =
        supplyUsd != null && borrowUsd != null && supplyUsd > 0
          ? borrowUsd / supplyUsd
          : null;

      rows.push([
        r.chainId,
        r.symbol,
        date,
        // APYs from yields.llama.fi are expressed as % (e.g. 5.21 means 5.21%).
        // Store as decimal (0.0521) so we can join cleanly against Morpho's
        // supply_apy which is already 0..1.
        supplyApy == null ? null : supplyApy / 100,
        borrowApy == null ? null : borrowApy / 100,
        util,
        supplyUsd,
        borrowUsd,
        r.poolId,
      ]);
    }
  }

  const written = await batchInsert(
    sql,
    'morpho_.aave_rates_daily',
    [
      'chain_id', 'asset_symbol', 'snapshot_date',
      'supply_apy', 'borrow_apy', 'utilization',
      'supply_usd', 'borrow_usd', 'pool_id',
    ],
    rows,
    {
      onConflict: `ON CONFLICT (chain_id, asset_symbol, snapshot_date) DO UPDATE SET
        supply_apy  = EXCLUDED.supply_apy,
        borrow_apy  = EXCLUDED.borrow_apy,
        utilization = EXCLUDED.utilization,
        supply_usd  = EXCLUDED.supply_usd,
        borrow_usd  = EXCLUDED.borrow_usd,
        pool_id     = EXCLUDED.pool_id,
        recorded_at = NOW()`,
    },
  );

  return {
    written,
    notes: {
      poolsResolved: resolved.length,
      skipped,
    },
  };
}
