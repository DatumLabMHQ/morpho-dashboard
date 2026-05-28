// Headline numbers for the Morpho-as-sector Overview (v3).
// Mirrors lib/queries/overview.ts but runs raw SQL (no Next cache layer).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const fmt = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${Math.round(a).toLocaleString()}`;
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    // Daily protocol-wide series for KPI anchors.
    const m = await c.query(`
      WITH daily AS (
        SELECT s.snapshot_date::date AS day,
          SUM(COALESCE(s.supply_assets_usd,0))::float8 AS supply,
          SUM(COALESCE(s.collateral_assets_usd,0))::float8 AS collateral,
          SUM(COALESCE(s.borrow_assets_usd,0))::float8 AS borrow
        FROM morpho_.market_state_daily s
        WHERE s.snapshot_date >= CURRENT_DATE - INTERVAL '400 days'
          AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
        GROUP BY s.snapshot_date::date ORDER BY day
      ) SELECT * FROM daily
    `);
    const rows = m.rows.map((r) => ({
      day: r.day, deposits: Number(r.supply) + Number(r.collateral),
      borrows: Number(r.borrow), supply: Number(r.supply),
    }));
    const last = rows[rows.length - 1];
    const at = (off: number) => rows[rows.length - 1 - off] ?? null;
    const d1 = at(1), d30 = at(30), d365 = at(365);
    const dep = last.deposits, bor = last.borrows, liq = dep - bor;
    const util = dep > 0 ? bor / dep : 0;
    const dd = (cur: number, a: { deposits?: number; borrows?: number } | null, k: 'deposits' | 'borrows') =>
      a ? cur - (a[k] as number) : null;

    console.log('\n=== 6 MORPHO-WIDE KPIs (as of ' + last.day + ') ===\n');
    console.log(`  Total Deposits      ${fmt(dep)}   24h ${fmt(dd(dep, d1, 'deposits'))} · MoM ${fmt(dd(dep, d30, 'deposits'))} · YoY ${fmt(dd(dep, d365, 'deposits'))}`);
    console.log(`  Active Borrows      ${fmt(bor)}   24h ${fmt(dd(bor, d1, 'borrows'))} · MoM ${fmt(dd(bor, d30, 'borrows'))} · YoY ${fmt(dd(bor, d365, 'borrows'))}`);
    const liq1 = d1 ? d1.deposits - d1.borrows : null;
    const liq30 = d30 ? d30.deposits - d30.borrows : null;
    const liq365 = d365 ? d365.deposits - d365.borrows : null;
    console.log(`  Available Liquidity ${fmt(liq)}   24h ${fmt(liq1 != null ? liq - liq1 : null)} · MoM ${fmt(liq30 != null ? liq - liq30 : null)} · YoY ${fmt(liq365 != null ? liq - liq365 : null)}`);
    const u30 = d30 && d30.deposits > 0 ? d30.borrows / d30.deposits : null;
    const u365 = d365 && d365.deposits > 0 ? d365.borrows / d365.deposits : null;
    console.log(`  Morpho Utilization  ${(util * 100).toFixed(2)}%   MoM ${u30 != null ? ((util - u30) * 100).toFixed(2) + 'pp' : '—'} · YoY ${u365 != null ? ((util - u365) * 100).toFixed(2) + 'pp' : '—'}`);

    // Take rate
    const v = await c.query(`
      SELECT
        SUM(COALESCE(total_assets_usd,0))::float8 AS auc,
        SUM(COALESCE(total_assets_usd,0)*COALESCE(apy,0)*COALESCE(fee_bps,0)/10000.0)::float8 AS fee_annual
      FROM morpho_.vault_state_daily
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.vault_state_daily)
        AND COALESCE(apy,0) < 1.0
    `);
    const auc = Number(v.rows[0].auc), feeAnnual = Number(v.rows[0].fee_annual);
    const takeRate = auc > 0 ? feeAnnual / auc : null;
    console.log(`  Curator Take Rate   ${takeRate != null ? (takeRate * 100).toFixed(2) + '%' : '—'}   (annual fees ${fmt(feeAnnual)} ÷ AUC ${fmt(auc)})`);

    // Real yield spread
    const tb = await c.query(`SELECT COUNT(*)::int AS n, MAX(rate_pct)::float8 AS latest FROM morpho_.tbill_rates_daily`);
    const tbillN = tb.rows[0].n;
    if (tbillN === 0) {
      console.log(`  % Real Yield Spread —   (FRED_API_KEY not configured — tbill_rates_daily empty)`);
    } else {
      const sa = await c.query(`
        SELECT SUM(COALESCE(supply_apy,0)*COALESCE(supply_assets_usd,0))::float8
               / NULLIF(SUM(COALESCE(supply_assets_usd,0)),0) AS stable_apy
        FROM morpho_.market_state_daily s JOIN morpho_.markets mk ON mk.unique_key=s.market_unique_key
        WHERE s.snapshot_date=(SELECT MAX(snapshot_date) FROM morpho_.market_state_daily)
          AND UPPER(mk.loan_asset_symbol) IN ('USDC','USDT','DAI') AND (s.supply_apy IS NULL OR s.supply_apy<1.0)
      `);
      const stableApy = Number(sa.rows[0].stable_apy) * 100;
      console.log(`  % Real Yield Spread ${(stableApy - Number(tb.rows[0].latest)).toFixed(2)}pp   (stables ${stableApy.toFixed(2)}% − T-bill ${Number(tb.rows[0].latest).toFixed(2)}%)`);
    }

    // Top 8 chains by TVL + net deposits 30d (telescoped from last 4 weeks
    // of the asset-flows table — same method as the per-chain cards).
    const ch = await c.query(`
      WITH latest AS (
        SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, collateral_assets_usd, borrow_assets_usd
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC
      ),
      recent AS (SELECT DISTINCT week_start FROM morpho_.morpho_asset_flows_weekly ORDER BY week_start DESC LIMIT 4),
      net AS (
        SELECT chain_id, SUM(net_flow_usd)::float8 AS net30
        FROM morpho_.morpho_asset_flows_weekly WHERE week_start IN (SELECT week_start FROM recent) GROUP BY chain_id
      )
      SELECT cch.name,
        SUM(COALESCE(l.supply_assets_usd,0)+COALESCE(l.collateral_assets_usd,0))::float8 AS deposits,
        SUM(COALESCE(l.borrow_assets_usd,0))::float8 AS borrows,
        MAX(n.net30) AS net30
      FROM morpho_.markets mk
      JOIN latest l ON l.market_unique_key=mk.unique_key
      LEFT JOIN morpho_.chains cch ON cch.chain_id=mk.chain_id
      LEFT JOIN net n ON n.chain_id=mk.chain_id
      GROUP BY cch.name ORDER BY (SUM(COALESCE(l.supply_assets_usd,0)+COALESCE(l.collateral_assets_usd,0)) - SUM(COALESCE(l.borrow_assets_usd,0))) DESC LIMIT 8
    `);
    console.log('\n=== TOP 8 CHAINS — NET DEPOSITS 30D (telescoped weekly asset flows) ===\n');
    for (const r of ch.rows) {
      const net = r.net30 == null ? null : Number(r.net30);
      console.log(`  ${(r.name ?? '?').padEnd(16)} TVL ${fmt(Number(r.deposits) - Number(r.borrows)).padStart(9)}   net30d ${net == null ? '—' : (net >= 0 ? '+' : '') + fmt(net)}`);
    }

    // Sankey W net in/out (chain view, latest week)
    const sk = await c.query(`
      WITH lw AS (SELECT MAX(week_start) AS w FROM morpho_.morpho_asset_flows_weekly)
      SELECT asset_symbol, SUM(net_flow_usd)::float8 AS net
      FROM morpho_.morpho_asset_flows_weekly WHERE week_start=(SELECT w FROM lw)
      GROUP BY asset_symbol
    `);
    let inUsd = 0, outUsd = 0;
    for (const r of sk.rows) { const n = Number(r.net); if (n > 0) inUsd += n; else outUsd += -n; }
    console.log('\n=== NET SUPPLY FLOWS — W (latest week, by chain) ===\n');
    console.log(`  Net inflow  ${fmt(inUsd)}`);
    console.log(`  Net outflow ${fmt(outUsd)}`);

    // Morpho rank
    const slugs = ['aave-v3','aave-v2','sparklend','morpho-blue','compound-v3','compound-v2','fluid-lending','euler-v2'];
    const rk = await c.query(`
      WITH ld AS (SELECT MAX(snapshot_date) AS d FROM morpho_.protocol_tvl_daily WHERE protocol_slug=ANY($1))
      SELECT protocol_slug, SUM(tvl_usd)::float8 AS tvl FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug=ANY($1) AND snapshot_date=(SELECT d FROM ld) GROUP BY protocol_slug ORDER BY tvl DESC
    `, [slugs]);
    const idx = rk.rows.findIndex((r) => r.protocol_slug === 'morpho-blue');
    console.log('\n=== LENDING SECTOR RANK ===\n');
    console.log(`  Morpho rank #${idx + 1} of ${rk.rows.length} overcollateralized lending protocols`);
    if (idx > 0) {
      const above = rk.rows[idx - 1];
      console.log(`  Gap to ${above.protocol_slug}: ${fmt(Number(above.tvl) - Number(rk.rows[idx].tvl))}`);
    }
    console.log();
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
