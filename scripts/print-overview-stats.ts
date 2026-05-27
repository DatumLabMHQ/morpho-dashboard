// Headline numbers for the rebuilt /overview research surface.
//
// Mirrors the queries in apps/web/lib/queries/overview.ts (kept inline here
// so the script can run without the Next.js cache layer / RSC boundary).
// Prints:
//   * 7 KPI snapshot values
//   * Top chain by current value for (deposits, loans, borrow interest, curation fees)
//   * Morpho's rank + gap to the protocol one rank above
//   * Count of markets + vaults launched in the last 30 days

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
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v).toLocaleString()}`;
};
const pct = (v: number | null): string =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    // ─── 7 KPI snapshot values ────────────────────────────────────────
    const kpis = await c.query(`
      WITH market_today AS (
        SELECT
          SUM(COALESCE(s.supply_assets_usd, 0))::float8     AS supply,
          SUM(COALESCE(s.collateral_assets_usd, 0))::float8 AS collateral,
          SUM(COALESCE(s.borrow_assets_usd, 0))::float8     AS borrow,
          SUM(
            COALESCE(s.borrow_assets_usd, 0) * COALESCE(s.borrow_apy, 0)
          )::float8                                          AS borrow_interest_annual,
          MAX(s.snapshot_date)::text                         AS as_of
        FROM morpho_.market_state_daily s
        WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.market_state_daily)
          AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
      ),
      vault_today AS (
        SELECT
          SUM(COALESCE(s.total_assets_usd, 0))::float8 AS assets,
          SUM(
            COALESCE(s.total_assets_usd, 0)
              * COALESCE(s.apy, 0)
              * COALESCE(s.fee_bps, 0) / 10000.0
          )::float8 AS fee_annual
        FROM morpho_.vault_state_daily s
        WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.vault_state_daily)
          AND COALESCE(s.apy, 0) < 1.0
      )
      SELECT
        m.supply, m.collateral, m.borrow, m.borrow_interest_annual,
        m.as_of, v.assets, v.fee_annual
      FROM market_today m, vault_today v
    `);
    const k = kpis.rows[0]!;
    const deposits = (Number(k.supply) || 0) + (Number(k.collateral) || 0);
    const loans    = Number(k.borrow) || 0;
    const tvl      = deposits - loans;
    console.log('\n=== 7 KPI LENSES — latest day (' + k.as_of + ') ===\n');
    console.log(`  Total Deposits          ${fmt(deposits)}`);
    console.log(`  Active Loans            ${fmt(loans)}`);
    console.log(`  TVL                     ${fmt(tvl)}`);
    console.log(`  Total Supply            ${fmt(Number(k.supply))}`);
    console.log(`  Annual Borrow Interest  ${fmt(Number(k.borrow_interest_annual))}`);
    console.log(`  Annual Curation Fees    ${fmt(Number(k.fee_annual))}`);
    console.log(`  Assets Under Curation   ${fmt(Number(k.assets))}`);

    // ─── Top chain per metric ─────────────────────────────────────────
    const topChainByMetric = async (expr: string, label: string) => {
      const r = await c.query(`
        WITH latest AS (
          SELECT
            ch.slug                AS chain_slug,
            ch.name                AS chain_name,
            SUM(${expr})::float8   AS value
          FROM morpho_.market_state_daily s
          JOIN morpho_.markets m ON m.unique_key = s.market_unique_key
          LEFT JOIN morpho_.chains ch ON ch.chain_id = m.chain_id
          WHERE s.snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.market_state_daily)
            AND (s.supply_apy IS NULL OR s.supply_apy < 1.0)
          GROUP BY ch.slug, ch.name
        ),
        total AS (SELECT SUM(value) AS t FROM latest)
        SELECT chain_name, value, (value / NULLIF((SELECT t FROM total), 0)) AS share
        FROM latest ORDER BY value DESC NULLS LAST LIMIT 1
      `);
      const x = r.rows[0];
      if (!x) { console.log(`  ${label}: —`); return; }
      console.log(`  ${label}: ${x.chain_name} (${fmt(Number(x.value))} · ${pct(Number(x.share))} of total)`);
    };
    console.log('\n=== TOP CHAIN BY METRIC ===\n');
    await topChainByMetric('COALESCE(s.supply_assets_usd, 0) + COALESCE(s.collateral_assets_usd, 0)', 'Top chain by deposits');
    await topChainByMetric('COALESCE(s.borrow_assets_usd, 0)',                                        'Top chain by active loans');

    // Top chain by last week's borrow interest (from materialized table)
    const weeklyTop = async (col: string, label: string) => {
      const r = await c.query(`
        WITH last_week AS (
          SELECT MAX(week_start) AS w FROM morpho_.overview_weekly_chain_metrics
        )
        SELECT ch.name AS chain_name, w.${col}::float8 AS value,
               (w.${col} / NULLIF((
                  SELECT SUM(${col}) FROM morpho_.overview_weekly_chain_metrics
                  WHERE week_start = (SELECT w FROM last_week)
                ), 0))::float8 AS share
        FROM morpho_.overview_weekly_chain_metrics w
        LEFT JOIN morpho_.chains ch ON ch.slug = w.chain_slug
        WHERE w.week_start = (SELECT w FROM last_week)
        ORDER BY w.${col} DESC NULLS LAST LIMIT 1
      `);
      const x = r.rows[0];
      if (!x) { console.log(`  ${label}: —`); return; }
      console.log(`  ${label}: ${x.chain_name} (${fmt(Number(x.value))} · ${pct(Number(x.share))} of last week's total)`);
    };
    await weeklyTop('borrow_interest_usd', 'Top chain by weekly borrow interest');
    await weeklyTop('curation_fees_usd',   'Top chain by weekly curation fees');

    // ─── Protocol ranking ─────────────────────────────────────────────
    const slugs = [
      'aave-v3','aave-v2','sparklend','morpho-blue','compound-v3','compound-v2','fluid-lending','euler-v2',
    ];
    const labels: Record<string, string> = {
      'aave-v3':'Aave V3', 'aave-v2':'Aave V2', 'sparklend':'SparkLend', 'morpho-blue':'Morpho',
      'compound-v3':'Compound V3', 'compound-v2':'Compound V2', 'fluid-lending':'Fluid', 'euler-v2':'Euler V2',
    };
    const rank = await c.query(`
      WITH last_day AS (
        SELECT MAX(snapshot_date) AS d FROM morpho_.protocol_tvl_daily
        WHERE protocol_slug = ANY($1::text[])
      )
      SELECT protocol_slug, SUM(tvl_usd)::float8 AS tvl
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = ANY($1::text[])
        AND snapshot_date = (SELECT d FROM last_day)
      GROUP BY protocol_slug
      ORDER BY tvl DESC
    `, [slugs]);
    console.log('\n=== OVERCOLLATERALIZED LENDING RANKING (latest TVL) ===\n');
    rank.rows.forEach((r, i) => {
      const marker = r.protocol_slug === 'morpho-blue' ? ' ←' : '';
      console.log(`  #${i + 1}  ${(labels[r.protocol_slug] ?? r.protocol_slug).padEnd(14)} ${fmt(Number(r.tvl)).padStart(10)}${marker}`);
    });
    const idx = rank.rows.findIndex((r) => r.protocol_slug === 'morpho-blue');
    if (idx > 0) {
      const above = rank.rows[idx - 1];
      const morpho = rank.rows[idx];
      const gap = Number(above.tvl) - Number(morpho.tvl);
      console.log(`\n  Morpho is rank #${idx + 1} of ${rank.rows.length}.`);
      console.log(`  Gap to ${labels[above.protocol_slug] ?? above.protocol_slug}: ${fmt(gap)}`);
    }

    // ─── Morpho vs Aave V3 share ──────────────────────────────────────
    const ratios = await c.query(`
      WITH last_day AS (
        SELECT MAX(snapshot_date) AS d FROM morpho_.protocol_tvl_daily WHERE protocol_slug = 'aave-v3'
      ),
      morpho_old_day AS (
        SELECT MAX(snapshot_date) AS d FROM morpho_.protocol_tvl_daily
        WHERE protocol_slug = 'morpho-blue' AND snapshot_date <= (CURRENT_DATE - INTERVAL '365 days')::date
      ),
      aave_old_day AS (
        SELECT MAX(snapshot_date) AS d FROM morpho_.protocol_tvl_daily
        WHERE protocol_slug = 'aave-v3' AND snapshot_date <= (CURRENT_DATE - INTERVAL '365 days')::date
      )
      SELECT
        (SELECT SUM(tvl_usd) FROM morpho_.protocol_tvl_daily WHERE protocol_slug='morpho-blue' AND snapshot_date=(SELECT d FROM last_day))      AS morpho_now,
        (SELECT SUM(tvl_usd) FROM morpho_.protocol_tvl_daily WHERE protocol_slug='aave-v3'     AND snapshot_date=(SELECT d FROM last_day))      AS aave_now,
        (SELECT SUM(tvl_usd) FROM morpho_.protocol_tvl_daily WHERE protocol_slug='morpho-blue' AND snapshot_date=(SELECT d FROM morpho_old_day)) AS morpho_old,
        (SELECT SUM(tvl_usd) FROM morpho_.protocol_tvl_daily WHERE protocol_slug='aave-v3'     AND snapshot_date=(SELECT d FROM aave_old_day))   AS aave_old
    `);
    const rr = ratios.rows[0]!;
    const nowR = Number(rr.morpho_now) / Number(rr.aave_now);
    const oldR = Number(rr.morpho_old) / Number(rr.aave_old);
    console.log(`\n  Morpho TVL / Aave V3 TVL: ${pct(nowR)} (was ${pct(oldR)} 12 months ago)`);

    // ─── Recent launches ──────────────────────────────────────────────
    const launches = await c.query(`
      SELECT
        (SELECT COUNT(*)::int FROM morpho_.markets WHERE created_at >= NOW() - INTERVAL '30 days') AS new_markets,
        (SELECT COUNT(*)::int FROM morpho_.vaults  WHERE created_at >= NOW() - INTERVAL '30 days') AS new_vaults
    `);
    const l = launches.rows[0]!;
    console.log('\n=== LAUNCHED IN LAST 30 DAYS ===\n');
    console.log(`  New markets: ${l.new_markets}`);
    console.log(`  New vaults:  ${l.new_vaults}`);
    console.log();
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
