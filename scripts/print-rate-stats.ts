// Paste-ready rate stats: Morpho-vs-Aave spreads, weighted utilization,
// bad-debt event count. Numbers mirror lib/queries/rates.ts so they match the
// /rates dashboard.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const fmtBps = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)} bps`;
const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(2)}%`);
const fmtUsd = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
  : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K`
  : `$${Math.round(v).toLocaleString()}`;

const ASSETS = ['USDC', 'USDT', 'DAI', 'WETH'] as const;
const CHAINS: { id: number; name: string }[] = [
  { id: 1,     name: 'Ethereum' },
  { id: 8453,  name: 'Base' },
  { id: 42161, name: 'Arbitrum' },
  { id: 137,   name: 'Polygon' },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    // 1. Per (asset, chain): latest Morpho weighted supply APY vs Aave V3 supply APY.
    const rows = await c.query(`
      WITH morpho_latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, supply_apy, utilization
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      morpho_agg AS (
        SELECT
          m.chain_id,
          UPPER(m.loan_asset_symbol) AS asset,
          SUM(COALESCE(l.supply_apy, 0) * COALESCE(l.supply_assets_usd, 0))::float8
            / NULLIF(SUM(COALESCE(l.supply_assets_usd, 0)), 0)             AS morpho_apy,
          SUM(COALESCE(l.utilization, 0) * COALESCE(l.supply_assets_usd, 0))::float8
            / NULLIF(SUM(COALESCE(l.supply_assets_usd, 0)), 0)             AS morpho_util,
          SUM(COALESCE(l.supply_assets_usd, 0))::float8                     AS morpho_supply
        FROM morpho_.markets m
        JOIN morpho_latest l ON l.market_unique_key = m.unique_key
        WHERE UPPER(m.loan_asset_symbol) IN ('USDC','USDT','DAI','WETH')
          AND m.chain_id IN (1, 8453, 42161, 137)
          AND l.supply_assets_usd > 0
          AND (l.supply_apy IS NULL OR l.supply_apy < 1.0)
        GROUP BY m.chain_id, UPPER(m.loan_asset_symbol)
      ),
      aave_latest AS (
        SELECT DISTINCT ON (chain_id, asset_symbol)
          chain_id, asset_symbol AS asset, supply_apy, utilization, supply_usd
        FROM morpho_.aave_rates_daily ORDER BY chain_id, asset_symbol, snapshot_date DESC
      )
      SELECT
        COALESCE(m.chain_id, a.chain_id)::int AS chain_id,
        COALESCE(m.asset, a.asset)             AS asset,
        m.morpho_apy::float8                   AS morpho_apy,
        m.morpho_util::float8                  AS morpho_util,
        m.morpho_supply::float8                AS morpho_supply,
        a.supply_apy::float8                   AS aave_apy,
        a.utilization::float8                  AS aave_util,
        a.supply_usd::float8                   AS aave_supply
      FROM morpho_agg m
      FULL OUTER JOIN aave_latest a ON a.chain_id = m.chain_id AND a.asset = m.asset
      ORDER BY 1, 2
    `);

    console.log('\n=== MORPHO vs AAVE V3 — latest day, per (asset, chain) ===\n');
    const grid = rows.rows.map((r: any) => ({
      asset: r.asset,
      chain: CHAINS.find((c) => c.id === r.chain_id)?.name ?? `chain ${r.chain_id}`,
      morpho_apy: fmtPct(r.morpho_apy),
      aave_apy: fmtPct(r.aave_apy),
      spread: r.morpho_apy != null && r.aave_apy != null ? fmtBps((r.morpho_apy - r.aave_apy) * 10000) : '—',
      morpho_util: fmtPct(r.morpho_util),
      aave_util: fmtPct(r.aave_util),
      morpho_supply: r.morpho_supply ? fmtUsd(r.morpho_supply) : '—',
    }));
    console.table(grid);

    // 2. Weighted average spread per asset across all 4 chains.
    console.log('\n=== HEADLINE — weighted-by-Morpho-supply spread per asset (all 4 chains) ===\n');
    for (const asset of ASSETS) {
      const xs = rows.rows.filter((r: any) => r.asset === asset && r.morpho_apy != null && r.aave_apy != null && r.morpho_supply);
      if (xs.length === 0) {
        console.log(`${asset}: no overlap`);
        continue;
      }
      const totW = xs.reduce((s: number, r: any) => s + r.morpho_supply, 0);
      const wAvg = xs.reduce(
        (s: number, r: any) => s + (r.morpho_apy - r.aave_apy) * 10000 * r.morpho_supply,
        0,
      ) / totW;
      const morphoApy = xs.reduce((s: number, r: any) => s + r.morpho_apy * r.morpho_supply, 0) / totW;
      const aaveApy  = xs.reduce((s: number, r: any) => s + r.aave_apy  * r.morpho_supply, 0) / totW;
      console.log(`${asset.padEnd(5)} → Morpho ${fmtPct(morphoApy)} · Aave ${fmtPct(aaveApy)} · spread ${fmtBps(wAvg)} · ${fmtUsd(totW)} weighted`);
    }

    // 3. Bad-debt: count of (market, day) tuples where bad debt grew >5% over $1k absolute, last 30 days.
    const bd = await c.query(`
      WITH lagged AS (
        SELECT
          market_unique_key,
          snapshot_date,
          COALESCE(bad_debt_assets_usd, 0)::float8 AS bd,
          LAG(COALESCE(bad_debt_assets_usd, 0)) OVER (
            PARTITION BY market_unique_key ORDER BY snapshot_date
          )::float8 AS prior
        FROM morpho_.market_state_daily
        WHERE snapshot_date >= CURRENT_DATE - INTERVAL '30 days'
      )
      SELECT
        (SELECT COUNT(*) FROM lagged
         WHERE bd > 1000 AND (prior IS NULL OR bd > prior * 1.05))::int     AS events_30d,
        (SELECT COALESCE(SUM(bad_debt_assets_usd), 0)::float8
         FROM morpho_.market_state_daily
         WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.market_state_daily)
           AND bad_debt_assets_usd > 1000)                                   AS total_today,
        (SELECT COUNT(DISTINCT market_unique_key)::int
         FROM morpho_.market_state_daily
         WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.market_state_daily)
           AND bad_debt_assets_usd > 1000)                                   AS markets_with_bd
    `);
    const b = bd.rows[0];
    console.log('\n=== BAD-DEBT WATCH (last 30 days) ===\n');
    console.log(`Events: ${b.events_30d} market-days with >5% bad-debt growth (and >$1k absolute)`);
    console.log(`Today: ${b.markets_with_bd} markets carry bad debt > $1k, totaling ${fmtUsd(b.total_today ?? 0)}`);

    // 4. Risk surface top-5
    const risk = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key)
          market_unique_key, supply_assets_usd, utilization
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      )
      SELECT
        ch.slug AS chain,
        m.collateral_asset_symbol || ' / ' || m.loan_asset_symbol AS pair,
        l.supply_assets_usd::float8 AS supply,
        l.utilization::float8 AS util,
        m.lltv::float8 AS lltv,
        (l.supply_assets_usd::float8 * COALESCE(l.utilization, 0) * COALESCE(m.lltv, 0))::float8 AS score
      FROM morpho_.markets m
      JOIN latest l ON l.market_unique_key = m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
      WHERE l.supply_assets_usd > 0 AND m.lltv IS NOT NULL
      ORDER BY score DESC NULLS LAST LIMIT 5
    `);
    console.log('\n=== TOP 5 BLAST-RADIUS MARKETS ===\n');
    console.table(
      risk.rows.map((r: any) => ({
        chain: r.chain,
        pair: r.pair,
        supply: fmtUsd(r.supply),
        util: fmtPct(r.util),
        lltv: fmtPct(r.lltv),
        score: fmtUsd(r.score),
      })),
    );
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
