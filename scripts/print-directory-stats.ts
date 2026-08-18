// Deliverable printouts for /vaults + /markets. Raw SQL via Pool (no Next cache),
// mirroring lib/queries/vaults.ts + markets.ts. Also validates the new SQL.

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
  const a = Math.abs(v); const s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${Math.round(a)}`;
};
const pct = (v: number | null, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const EX = `(supply_apy IS NULL OR supply_apy < 1.0) AND (borrow_apy IS NULL OR borrow_apy < 1.0)`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    // ============ VAULTS ============
    console.log('\n############## /VAULTS ##############');
    const vDaily = await c.query(`
      SELECT
        SUM(COALESCE(total_assets_usd,0))::float8 AS aum,
        SUM(COALESCE(total_assets_usd,0) * LEAST(COALESCE(apy, net_apy/NULLIF(1-fee_bps/10000.0,0),0),1.0) * COALESCE(fee_bps,0)/10000.0)::float8 AS curator_fees,
        COUNT(*) FILTER (WHERE total_assets_usd > 0)::int AS active_count,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY net_apy)::float8 AS median_net_apy,
        MAX(COALESCE(total_assets_usd,0))::float8 AS largest_aum
      FROM morpho_.vault_state_daily
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.vault_state_daily)
        AND (apy IS NULL OR apy <= 1.0) AND (net_apy IS NULL OR net_apy <= 1.0)
    `);
    const v = vDaily.rows[0];
    console.log('\n=== 5 KPIs ===');
    console.log(`  TOTAL AUM                  ${fmt(Number(v.aum))}`);
    console.log(`  ACTIVE VAULTS              ${v.active_count}`);
    console.log(`  MEDIAN NET APY DELIVERED   ${pct(v.median_net_apy == null ? null : Number(v.median_net_apy), 2)}`);
    console.log(`  TOTAL CURATOR FEES (ann.)  ${fmt(Number(v.curator_fees))}`);
    console.log(`  LARGEST VAULT AUM          ${fmt(Number(v.largest_aum))}`);

    const vTop = await c.query(`
      WITH latest AS (SELECT DISTINCT ON (chain_id, vault_address) chain_id, vault_address, total_assets_usd, net_apy
        FROM morpho_.vault_state_daily ORDER BY chain_id, vault_address, snapshot_date DESC)
      SELECT v.name, v.symbol, v.performance_fee_bps AS fee, ch.slug AS chain, l.total_assets_usd::float8 AS aum, l.net_apy::float8 AS net_apy
      FROM morpho_.vaults v JOIN latest l ON l.chain_id=v.chain_id AND l.vault_address=v.address
      LEFT JOIN morpho_.chains ch ON ch.chain_id=v.chain_id
      WHERE l.total_assets_usd > 0 ORDER BY l.total_assets_usd DESC LIMIT 10
    `);
    console.log('\n=== TOP 10 BY AUM (name · AUM · net APY · fee) ===');
    for (const r of vTop.rows) {
      console.log(`  ${(r.name ?? r.symbol ?? '?').slice(0, 26).padEnd(27)} ${fmt(Number(r.aum)).padStart(9)}  ${pct(r.net_apy == null ? null : Number(r.net_apy), 2).padStart(7)}  fee ${r.fee == null ? '—' : (r.fee / 100).toFixed(1) + '%'}  [${r.chain ?? '?'}]`);
    }

    const vAll = await c.query(`
      WITH latest AS (SELECT DISTINCT ON (chain_id, vault_address) chain_id, vault_address, total_assets_usd
        FROM morpho_.vault_state_daily ORDER BY chain_id, vault_address, snapshot_date DESC)
      SELECT l.total_assets_usd::float8 AS aum FROM latest l WHERE l.total_assets_usd > 0
    `);
    const aums = vAll.rows.map((r) => Number(r.aum));
    const buckets = [['<$100K', 0, 1e5], ['$100K–$1M', 1e5, 1e6], ['$1M–$10M', 1e6, 1e7], ['$10M–$100M', 1e7, 1e8], ['$100M–$1B', 1e8, 1e9], ['$1B+', 1e9, Infinity]] as const;
    console.log('\n=== AUM DISTRIBUTION (bin: count, total $) ===');
    for (const [label, lo, hi] of buckets) {
      const inb = aums.filter((a) => a >= lo && a < hi);
      console.log(`  ${label.padEnd(12)} ${String(inb.length).padStart(4)} vaults   ${fmt(inb.reduce((s, x) => s + x, 0))}`);
    }
    const sorted = [...aums].sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    console.log(`  median AUM ${fmt(med)} · ${((aums.filter((a) => a < 1e7).length / aums.length) * 100).toFixed(0)}% below $10M`);

    // ============ MARKETS ============
    console.log('\n\n############## /MARKETS ##############');
    const mAll = await c.query(`
      WITH latest AS (SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, borrow_assets_usd, bad_debt_assets_usd, utilization, supply_apy, borrow_apy
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC)
      SELECT m.loan_asset_symbol AS loan, m.collateral_asset_symbol AS coll, m.lltv::float8 AS lltv, ch.name AS chain,
        l.supply_assets_usd::float8 AS supply, l.borrow_assets_usd::float8 AS borrow, l.bad_debt_assets_usd::float8 AS bad_debt,
        l.utilization::float8 AS util, l.supply_apy::float8 AS supply_apy, l.borrow_apy::float8 AS borrow_apy
      FROM morpho_.markets m JOIN latest l ON l.market_unique_key=m.unique_key
      LEFT JOIN morpho_.chains ch ON ch.chain_id=m.chain_id
    `);
    type MR = { loan: string; coll: string | null; lltv: number | null; chain: string | null; supply: number; borrow: number; bad_debt: number; util: number | null; supply_apy: number | null; borrow_apy: number | null };
    const rows: MR[] = mAll.rows.map((r) => ({
      loan: r.loan, coll: r.coll, lltv: r.lltv == null ? null : Number(r.lltv), chain: r.chain,
      supply: Number(r.supply ?? 0), borrow: Number(r.borrow ?? 0), bad_debt: Number(r.bad_debt ?? 0),
      util: r.util == null ? null : Number(r.util), supply_apy: r.supply_apy == null ? null : Number(r.supply_apy), borrow_apy: r.borrow_apy == null ? null : Number(r.borrow_apy),
    }));
    const sane = rows.filter((r) => !(r.supply_apy != null && r.supply_apy >= 1.0));
    const live = rows.filter((r) => r.supply > 0 || r.borrow > 0);
    const wMed = (pairs: { value: number; weight: number }[]) => {
      const vv = pairs.filter((p) => p.weight > 0).sort((a, b) => a.value - b.value);
      const tot = vv.reduce((s, p) => s + p.weight, 0); if (!tot) return null; let cum = 0;
      for (const p of vv) { cum += p.weight; if (cum >= tot / 2) return p.value; } return null;
    };
    const largest = sane.reduce((m, r) => (r.borrow > m.borrow ? r : m), sane[0]);
    const at90 = sane.filter((r) => r.util != null && r.util >= 0.9);
    const bad = live.filter((r) => r.bad_debt > 1000);
    console.log('\n=== 6 KPIs ===');
    console.log(`  ACTIVE MARKETS             ${live.length}`);
    console.log(`  LARGEST MARKET (loans)     ${fmt(largest.borrow)}  ${largest.loan}/${largest.coll ?? '—'} [${largest.chain}]`);
    console.log(`  MEDIAN UTILIZATION (wtd)   ${pct(wMed(sane.filter((r) => r.util != null).map((r) => ({ value: r.util!, weight: r.supply }))))}`);
    console.log(`  MEDIAN LLTV (wtd)          ${pct(wMed(sane.filter((r) => r.lltv != null).map((r) => ({ value: r.lltv!, weight: r.supply }))), 0)}`);
    console.log(`  MARKETS ≥90% UTIL          ${at90.length}  (${fmt(at90.reduce((s, r) => s + r.supply, 0))} supply)`);
    console.log(`  MARKETS W/ BAD DEBT        ${bad.length}  (${fmt(bad.reduce((s, r) => s + r.bad_debt, 0))} exposure)`);

    console.log('\n=== TOP 10 BY ACTIVE LOANS ===');
    for (const r of [...sane].filter((r) => r.borrow > 0).sort((a, b) => b.borrow - a.borrow).slice(0, 10)) {
      console.log(`  ${`${r.loan}/${r.coll ?? '—'}`.slice(0, 24).padEnd(25)} ${fmt(r.borrow).padStart(9)}  util ${pct(r.util)}  [${r.chain}]`);
    }

    console.log('\n=== LLTV DISTRIBUTION (supply-weighted) ===');
    const lb = [['0–50%', 0, 50], ['50–70%', 50, 70], ['70–80%', 70, 80], ['80–90%', 80, 90], ['90–95%', 90, 95], ['95%+', 95, 101]] as const;
    for (const [label, lo, hi] of lb) {
      const inb = sane.filter((r) => r.lltv != null && r.lltv * 100 >= lo && r.lltv * 100 < hi);
      const byCls = new Map<string, number>();
      for (const r of inb) { const k = r.coll ?? '?'; byCls.set(k, (byCls.get(k) ?? 0) + r.supply); }
      const dom = [...byCls.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
      console.log(`  ${label.padEnd(7)} ${fmt(inb.reduce((s, r) => s + r.supply, 0)).padStart(9)}  ${String(inb.length).padStart(4)} mkts  dom: ${dom}`);
    }

    console.log('\n=== RISK SURFACE TOP 5 (market · chain · risk score) ===');
    const scored = sane.filter((r) => r.supply > 0 && r.util != null && r.lltv != null)
      .map((r) => ({ r, score: r.supply * (r.util ?? 0) * (r.lltv ?? 0) }))
      .sort((a, b) => b.score - a.score).slice(0, 5);
    for (const s of scored) console.log(`  ${`${s.r.loan}/${s.r.coll ?? '—'}`.slice(0, 24).padEnd(25)} [${s.r.chain}]  risk ${fmt(s.score)}`);
    console.log();
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
