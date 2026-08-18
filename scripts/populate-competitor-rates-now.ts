// One-off: write TODAY's competitor supply/borrow rates from DefiLlama yields
// /pools (current values) for the 5 sector protocols × 4 chains × 4 assets.
// Mirrors apps/worker/src/jobs/competitor-rates.ts so the lending-efficiency
// table populates immediately (the worker then maintains it daily).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const PROTOCOLS = ['aave-v3', 'sparklend', 'compound-v3', 'fluid-lending', 'euler-v2'];
const CHAINS = [
  { chainId: 1, llamaChain: 'Ethereum' },
  { chainId: 8453, llamaChain: 'Base' },
  { chainId: 42161, llamaChain: 'Arbitrum' },
  { chainId: 137, llamaChain: 'Polygon' },
];
const ASSETS = ['USDC', 'USDT', 'DAI', 'WETH'];
const norm = (s: string) => {
  const u = s.toUpperCase().replace(/\./g, '');
  if (/^USDCE$/.test(u)) return 'USDC';
  if (/^USDT0$/.test(u)) return 'USDT';
  if (/^W?ETH$/.test(u)) return 'WETH';
  return u;
};

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch('https://yields.llama.fi/pools');
  const all = (await res.json()).data as any[];
  console.log(`fetched ${all.length} pools from DefiLlama yields`);

  const rows: any[][] = [];
  const per: Record<string, number> = {};
  for (const protocol of PROTOCOLS) {
    const pools = all.filter((p) => p.project === protocol);
    per[protocol] = 0;
    for (const c of CHAINS) {
      for (const symbol of ASSETS) {
        const matches = pools.filter((p) => p.chain === c.llamaChain && norm(p.symbol) === norm(symbol));
        if (!matches.length) continue;
        const top = matches.sort((a, b) => b.tvlUsd - a.tvlUsd)[0];
        const supplyApy = top.apy ?? top.apyBase ?? null;
        const baseBorrow = top.apyBaseBorrow ?? null;
        const rewardBorrow = top.apyRewardBorrow ?? 0;
        const borrowApy = baseBorrow == null ? null : Math.max(0, baseBorrow - rewardBorrow);
        const supplyUsd = top.totalSupplyUsd ?? top.tvlUsd ?? null;
        const borrowUsd = top.totalBorrowUsd ?? null;
        const util = supplyUsd != null && borrowUsd != null && supplyUsd > 0 ? borrowUsd / supplyUsd : null;
        rows.push([c.chainId, protocol, symbol, today,
          supplyApy == null ? null : supplyApy / 100, borrowApy == null ? null : borrowApy / 100,
          util, supplyUsd, borrowUsd, top.pool]);
        per[protocol]++;
      }
    }
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const vals: any[] = [];
      const ph = chunk.map((r, j) => {
        const b = j * 10;
        vals.push(...r);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4}::date,$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`;
      }).join(',');
      await c.query(
        `INSERT INTO morpho_.competitor_rates_daily
         (chain_id, protocol_slug, asset_symbol, snapshot_date, supply_apy, borrow_apy, utilization, supply_usd, borrow_usd, pool_id)
         VALUES ${ph}
         ON CONFLICT (chain_id, protocol_slug, asset_symbol, snapshot_date) DO UPDATE SET
           supply_apy=EXCLUDED.supply_apy, borrow_apy=EXCLUDED.borrow_apy, utilization=EXCLUDED.utilization,
           supply_usd=EXCLUDED.supply_usd, borrow_usd=EXCLUDED.borrow_usd, pool_id=EXCLUDED.pool_id, recorded_at=NOW()`,
        vals,
      );
    }
    console.log(`wrote ${rows.length} rows for ${today}:`, per);
    // Show ethereum supply APYs as a sanity check (what the efficiency table reads).
    const chk = await c.query(`
      SELECT protocol_slug, asset_symbol, ROUND((supply_apy*100)::numeric,2) supply_pct
      FROM morpho_.competitor_rates_daily
      WHERE chain_id=1 AND snapshot_date=$1 AND asset_symbol IN ('USDC','USDT','DAI','WETH')
      ORDER BY asset_symbol, protocol_slug`, [today]);
    console.log('\nEthereum supply APY (today):');
    for (const r of chk.rows) console.log(`  ${r.asset_symbol.padEnd(5)} ${r.protocol_slug.padEnd(14)} ${r.supply_pct}%`);
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
