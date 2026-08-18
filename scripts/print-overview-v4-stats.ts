// Headline numbers for the rebuilt Overview (v4). Mirrors lib/queries/overview.ts
// (getMorphoWideKpis + getLendingEfficiencyTable + getRiskPulse + ranking) but
// runs raw SQL with no Next cache layer. Prints every deliverable printout.

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
const pct = (v: number | null, d = 2): string => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const bps = (v: number | null): string => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v))} bps`);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    // ── Daily protocol-wide series (exclude markets where apy>1.0) ──
    const m = await c.query(`
      WITH daily AS (
        SELECT s.snapshot_date::date AS day,
          SUM(COALESCE(s.supply_assets_usd,0))::float8 AS supply,
          SUM(COALESCE(s.collateral_assets_usd,0))::float8 AS collateral,
          SUM(COALESCE(s.borrow_assets_usd,0))::float8 AS borrow,
          SUM(COALESCE(s.borrow_assets_usd,0)*LEAST(COALESCE(s.borrow_apy,0),1.0))::float8 AS borrow_interest,
          SUM(COALESCE(s.supply_assets_usd,0)*LEAST(COALESCE(s.supply_apy,0),1.0))::float8 AS supply_interest
        FROM morpho_.market_state_daily s
        WHERE s.snapshot_date >= CURRENT_DATE - INTERVAL '400 days'
          AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
          AND (s.borrow_apy IS NULL OR s.borrow_apy < 1.0)
        GROUP BY s.snapshot_date::date ORDER BY day
      ) SELECT * FROM daily
    `);
    const rows = m.rows.map((r) => {
      const supply = Number(r.supply), collateral = Number(r.collateral), borrow = Number(r.borrow);
      const bi = Number(r.borrow_interest), si = Number(r.supply_interest);
      const deposits = supply + collateral;
      const wB = borrow > 0 ? bi / borrow : null;
      const wS = supply > 0 ? si / supply : null;
      return {
        day: r.day, deposits, borrows: borrow, supply,
        borrowInterest: bi,
        nim: wB != null && wS != null ? wB - wS : null,
        util: deposits > 0 ? borrow / deposits : 0,
      };
    });
    const last = rows[rows.length - 1];
    const at = (off: number) => rows[rows.length - 1 - off] ?? null;
    const d1 = at(1), d30 = at(30), d365 = at(365);

    // Curator fees annualized (latest vault snapshot, exclude apy>=1.0)
    const v = await c.query(`
      SELECT SUM(COALESCE(total_assets_usd,0)*COALESCE(apy,0)*COALESCE(fee_bps,0)/10000.0)::float8 AS fee_annual
      FROM morpho_.vault_state_daily
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.vault_state_daily) AND COALESCE(apy,0) < 1.0
    `);
    const curatorFees = Number(v.rows[0].fee_annual);

    const dUsd = (cur: number, prior: number | undefined | null) => (prior == null ? null : cur - prior);
    console.log('\n========== SECTION 2 — 6 KPIs (as of ' + last.day + ') ==========\n');
    console.log(`  1. ACTIVE LOANS              ${fmt(last.borrows)}    24h ${fmt(dUsd(last.borrows, d1?.borrows))} · MoM ${fmt(dUsd(last.borrows, d30?.borrows))} · YoY ${fmt(dUsd(last.borrows, d365?.borrows))}`);
    console.log(`  2. BORROW INTEREST (ann.)    ${fmt(last.borrowInterest)}    24h ${fmt(dUsd(last.borrowInterest, d1?.borrowInterest))} · MoM ${fmt(dUsd(last.borrowInterest, d30?.borrowInterest))} · YoY ${fmt(dUsd(last.borrowInterest, d365?.borrowInterest))}`);
    const nimD30 = last.nim != null && d30?.nim != null ? (last.nim - d30.nim) * 10000 : null;
    const nimD365 = last.nim != null && d365?.nim != null ? (last.nim - d365.nim) * 10000 : null;
    console.log(`  3. NET INTEREST MARGIN       ${last.nim != null ? Math.round(last.nim * 10000) + ' bps' : '—'}    MoM ${bps(nimD30)} · YoY ${bps(nimD365)}`);
    console.log(`  4. CURATOR FEES (ann.)       ${fmt(curatorFees)}`);
    console.log(`  5. TOTAL DEPOSITS            ${fmt(last.deposits)}    24h ${fmt(dUsd(last.deposits, d1?.deposits))} · MoM ${fmt(dUsd(last.deposits, d30?.deposits))} · YoY ${fmt(dUsd(last.deposits, d365?.deposits))}`);
    const uD30 = d30 ? (last.util - d30.util) * 100 : null;
    const uD365 = d365 ? (last.util - d365.util) * 100 : null;
    console.log(`  6. WEIGHTED UTILIZATION      ${pct(last.util)}    MoM ${uD30 != null ? uD30.toFixed(2) + 'pp' : '—'} · YoY ${uD365 != null ? uD365.toFixed(2) + 'pp' : '—'}`);

    // ── Top 8 chains by ACTIVE LOANS + 30d Δ ──
    const ch = await c.query(`
      WITH latest AS (
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, borrow_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
        WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
      ),
      prior AS (
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, borrow_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily WHERE snapshot_date <= CURRENT_DATE - INTERVAL '30 days'
          ORDER BY market_unique_key, snapshot_date DESC) q
        WHERE (q.borrow_apy IS NULL OR q.borrow_apy <= 1.0) AND (q.supply_apy IS NULL OR q.supply_apy <= 1.0)
      )
      SELECT cch.name,
        SUM(COALESCE(l.borrow_assets_usd,0))::float8 AS loans_now,
        SUM(COALESCE(p.borrow_assets_usd,0))::float8 AS loans_30d
      FROM morpho_.markets mk
      JOIN latest l ON l.market_unique_key=mk.unique_key
      LEFT JOIN prior p ON p.market_unique_key=mk.unique_key
      LEFT JOIN morpho_.chains cch ON cch.chain_id=mk.chain_id
      GROUP BY cch.name ORDER BY SUM(COALESCE(l.borrow_assets_usd,0)) DESC LIMIT 8
    `);
    console.log('\n========== SECTION 4 — TOP 8 CHAINS BY ACTIVE LOANS (+30d Δ) ==========\n');
    for (const r of ch.rows) {
      const now = Number(r.loans_now), p30 = Number(r.loans_30d);
      const delta = p30 > 0 ? now - p30 : null;
      console.log(`  ${(r.name ?? '?').padEnd(16)} ${fmt(now).padStart(9)}   30d Δ ${delta == null ? '—' : (delta >= 0 ? '+' : '') + fmt(delta)}`);
    }

    // ── Section 6: collateral vs borrow mix asymmetry callout ──
    const mix = await c.query(`
      WITH latest AS (SELECT DISTINCT ON (market_unique_key) market_unique_key, collateral_assets_usd, borrow_assets_usd, supply_apy, borrow_apy
        FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC)
      SELECT
        UPPER(mk.collateral_asset_symbol) AS col_sym, UPPER(mk.loan_asset_symbol) AS loan_sym,
        SUM(COALESCE(l.collateral_assets_usd,0))::float8 AS col_usd,
        SUM(COALESCE(l.borrow_assets_usd,0))::float8 AS borrow_usd
      FROM morpho_.markets mk JOIN latest l ON l.market_unique_key=mk.unique_key
      WHERE (l.borrow_apy IS NULL OR l.borrow_apy<=1.0) AND (l.supply_apy IS NULL OR l.supply_apy<=1.0)
      GROUP BY GROUPING SETS ((UPPER(mk.collateral_asset_symbol)), (UPPER(mk.loan_asset_symbol)))
    `);
    let colTot = 0, borTot = 0;
    const colBy = new Map<string, number>(), borBy = new Map<string, number>();
    for (const r of mix.rows) {
      if (r.col_sym) { colBy.set(r.col_sym, Number(r.col_usd)); colTot += Number(r.col_usd); }
      if (r.loan_sym) { borBy.set(r.loan_sym, Number(r.borrow_usd)); borTot += Number(r.borrow_usd); }
    }
    const topCol = [...colBy.entries()].sort((a, b) => b[1] - a[1])[0];
    const topBor = [...borBy.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log('\n========== SECTION 6 — COLLATERAL vs BORROW MIX ==========\n');
    console.log(`  Top collateral: ${topCol?.[0]} ${pct(colTot > 0 ? topCol[1] / colTot : null, 1)} of $${(colTot / 1e9).toFixed(2)}B collateral`);
    console.log(`  Top borrow:     ${topBor?.[0]} ${pct(borTot > 0 ? topBor[1] / borTot : null, 1)} of $${(borTot / 1e9).toFixed(2)}B debt`);
    const btcCol = (colBy.get('WBTC') ?? 0) + (colBy.get('CBBTC') ?? 0) + (colBy.get('LBTC') ?? 0);
    const btcBor = (borBy.get('WBTC') ?? 0) + (borBy.get('CBBTC') ?? 0) + (borBy.get('LBTC') ?? 0);
    console.log(`  Asymmetry: BTC = ${pct(colTot > 0 ? btcCol / colTot : null, 0)} of collateral but only ${pct(borTot > 0 ? btcBor / borTot : null, 0)} of debt (parked, not borrowed against productively).`);

    // ── Section 8: Ethereum lending efficiency 4×6 ──
    const eAssets = ['USDC', 'USDT', 'DAI', 'WETH'];
    const eMorpho = await c.query(`
      WITH latest AS (
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
        WHERE (q.borrow_apy IS NULL OR q.borrow_apy<=1.0) AND (q.supply_apy IS NULL OR q.supply_apy<=1.0)
      )
      SELECT UPPER(mk.loan_asset_symbol) AS asset,
        SUM(l.supply_assets_usd*LEAST(l.supply_apy,1.0))::float8/NULLIF(SUM(l.supply_assets_usd),0) AS apy
      FROM morpho_.markets mk JOIN latest l ON l.market_unique_key=mk.unique_key
      WHERE mk.chain_id=1 AND UPPER(mk.loan_asset_symbol)=ANY($1) AND l.supply_assets_usd>0
      GROUP BY UPPER(mk.loan_asset_symbol)
    `, [eAssets]);
    const morphoBy = new Map(eMorpho.rows.map((r) => [r.asset, r.apy == null ? null : Number(r.apy)]));
    const eComp = await c.query(`
      WITH latest AS (SELECT DISTINCT ON (protocol_slug, asset_symbol) protocol_slug, asset_symbol, supply_apy, supply_usd
        FROM morpho_.competitor_rates_daily WHERE chain_id=1 ORDER BY protocol_slug, asset_symbol, snapshot_date DESC)
      SELECT UPPER(asset_symbol) AS asset, protocol_slug, supply_apy::float8 AS apy, supply_usd::float8 AS supply_usd FROM latest
    `);
    const comps = ['aave-v3', 'compound-v3', 'fluid-lending', 'euler-v2'];
    const compBy = new Map<string, { apy: number | null; supply: number }>();
    for (const r of eComp.rows) compBy.set(`${r.asset}|${r.protocol_slug}`, { apy: r.apy == null ? null : Number(r.apy), supply: Number(r.supply_usd ?? 1) });
    console.log('\n========== SECTION 8 — ETHEREUM LENDING EFFICIENCY (supply APY) ==========\n');
    console.log(`  ${'asset'.padEnd(6)} ${'morpho'.padStart(8)} ${'aave-v3'.padStart(8)} ${'comp-v3'.padStart(8)} ${'fluid'.padStart(8)} ${'euler'.padStart(8)} ${'sector'.padStart(8)} ${'spread'.padStart(10)}`);
    for (const a of eAssets) {
      const ma = morphoBy.get(a) ?? null;
      let num = 0, den = 0;
      const cells = comps.map((cs) => {
        const cell = compBy.get(`${a}|${cs}`);
        if (cell?.apy != null) { num += cell.apy * cell.supply; den += cell.supply; }
        return cell?.apy ?? null;
      });
      const sector = den > 0 ? num / den : null;
      const spread = ma != null && sector != null ? (ma - sector) * 10000 : null;
      console.log(`  ${a.padEnd(6)} ${pct(ma).padStart(8)} ${pct(cells[0]).padStart(8)} ${pct(cells[1]).padStart(8)} ${pct(cells[2]).padStart(8)} ${pct(cells[3]).padStart(8)} ${pct(sector).padStart(8)} ${bps(spread).padStart(10)}`);
    }

    // ── Section 9: risk pulse ──
    const rpBad = await c.query(`
      WITH latest AS (SELECT DISTINCT ON (market_unique_key) market_unique_key, bad_debt_assets_usd FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC)
      SELECT l.bad_debt_assets_usd::float8 AS bd, mk.collateral_asset_symbol AS col, mk.loan_asset_symbol AS loan
      FROM latest l JOIN morpho_.markets mk ON mk.unique_key=l.market_unique_key WHERE l.bad_debt_assets_usd>1000 ORDER BY l.bad_debt_assets_usd DESC
    `);
    const badTotal = rpBad.rows.reduce((s, r) => s + Number(r.bd), 0);
    const top = rpBad.rows[0];
    const rpStr = await c.query(`
      WITH latest AS (
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, borrow_assets_usd, utilization, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
        WHERE (q.borrow_apy IS NULL OR q.borrow_apy<=1.0) AND (q.supply_apy IS NULL OR q.supply_apy<=1.0)
      )
      SELECT COUNT(*) FILTER (WHERE utilization>0.9 AND supply_assets_usd>0)::int AS n,
        COALESCE(SUM(supply_assets_usd) FILTER (WHERE utilization>0.9),0)::float8 AS stressed_supply,
        COALESCE(SUM(borrow_assets_usd),0)::float8 AS total_borrow FROM latest
    `);
    const st = rpStr.rows[0];
    const rpLltv = await c.query(`
      WITH latest AS (
        SELECT * FROM (SELECT DISTINCT ON (market_unique_key) market_unique_key, supply_assets_usd, supply_apy, borrow_apy
          FROM morpho_.market_state_daily ORDER BY market_unique_key, snapshot_date DESC) q
        WHERE (q.borrow_apy IS NULL OR q.borrow_apy<=1.0) AND (q.supply_apy IS NULL OR q.supply_apy<=1.0)
      )
      SELECT SUM(mk.lltv::numeric*l.supply_assets_usd)::float8/NULLIF(SUM(l.supply_assets_usd),0) AS wl
      FROM morpho_.markets mk JOIN latest l ON l.market_unique_key=mk.unique_key WHERE mk.lltv IS NOT NULL AND l.supply_assets_usd>0
    `);
    console.log('\n========== SECTION 9 — RISK PULSE ==========\n');
    console.log(`  Bad debt:         ${fmt(badTotal)} across ${rpBad.rows.length} markets · top ${top ? `${top.col ?? '—'}/${top.loan} (${pct(badTotal > 0 ? Number(top.bd) / badTotal : null, 0)})` : '—'}`);
    console.log(`  Stressed markets: ${st.n}  ( util>90%, ${fmt(Number(st.stressed_supply))} supply, ${pct(Number(st.total_borrow) > 0 ? Number(st.stressed_supply) / Number(st.total_borrow) : null, 0)} of active loans )`);
    console.log(`  Weighted LLTV:    ${pct(rpLltv.rows[0].wl == null ? null : Number(rpLltv.rows[0].wl), 1)}`);

    // ── Section 10: Morpho rank ──
    const slugs = ['aave-v3', 'aave-v2', 'sparklend', 'morpho-blue', 'compound-v3', 'compound-v2', 'fluid-lending', 'euler-v2'];
    const rk = await c.query(`
      WITH ld AS (SELECT MAX(snapshot_date) AS d FROM morpho_.protocol_tvl_daily WHERE protocol_slug=ANY($1))
      SELECT protocol_slug, SUM(tvl_usd)::float8 AS tvl FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug=ANY($1) AND snapshot_date=(SELECT d FROM ld) GROUP BY protocol_slug ORDER BY tvl DESC
    `, [slugs]);
    const idx = rk.rows.findIndex((r) => r.protocol_slug === 'morpho-blue');
    console.log('\n========== SECTION 10 — LENDING SECTOR RANK ==========\n');
    console.log(`  Morpho rank #${idx + 1} of ${rk.rows.length} overcollateralized lending protocols by TVL`);
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
