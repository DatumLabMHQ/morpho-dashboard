import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  const q = (s: string, p: unknown[] = []) => c.query(s, p);
  try {
    console.log('=== 1. freshness: now vs MAX(recorded_at) ===');
    const fr = await q(`SELECT now() AT TIME ZONE 'UTC' AS utc_now,
      (SELECT MAX(recorded_at) FROM morpho_.market_state_daily) AS mkt,
      (SELECT MAX(recorded_at) FROM morpho_.vault_state_daily) AS vlt,
      (SELECT MAX(recorded_at) FROM morpho_.chain_lending_tvl_daily) AS cld`);
    console.log(fr.rows[0]);

    console.log('\n=== 2. comparison cliff: last 5 snapshot_dates, morpho-blue + aave-v3 total tvl + #chains ===');
    const cliff = await q(`
      SELECT snapshot_date::text d, protocol_slug,
        ROUND(SUM(tvl_usd)/1e9,2) tvl_b, COUNT(DISTINCT chain_slug) chains
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug IN ('morpho-blue','aave-v3')
        AND snapshot_date >= CURRENT_DATE - INTERVAL '6 days'
      GROUP BY snapshot_date, protocol_slug ORDER BY d DESC, protocol_slug`);
    for (const r of cliff.rows) console.log(`  ${r.d}  ${String(r.protocol_slug).padEnd(11)} $${r.tvl_b}B  ${r.chains} chains`);

    console.log('\n=== 3. net supply flows: morpho_asset_flows_weekly latest week_starts ===');
    const wk = await q(`SELECT week_start::text w, COUNT(*) rows, ROUND(SUM(net_flow_usd)/1e6,1) net_m
      FROM morpho_.morpho_asset_flows_weekly GROUP BY week_start ORDER BY week_start DESC LIMIT 5`);
    for (const r of wk.rows) console.log(`  week ${r.w}  ${r.rows} rows  net $${r.net_m}M`);
    const today = await q(`SELECT CURRENT_DATE::text d, date_trunc('week', CURRENT_DATE)::date::text wk_start, EXTRACT(DOW FROM CURRENT_DATE) dow`);
    console.log(`  today=${today.rows[0].d} current_week_start=${today.rows[0].wk_start} dow=${today.rows[0].dow}`);

    console.log('\n=== 4. competitor_rates_daily: protocols + latest date + row counts ===');
    const comp = await q(`SELECT protocol_slug, COUNT(*) n, MAX(snapshot_date)::text latest,
      COUNT(*) FILTER (WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.competitor_rates_daily cr2 WHERE cr2.protocol_slug = cr.protocol_slug)) AS latest_rows
      FROM morpho_.competitor_rates_daily cr GROUP BY protocol_slug ORDER BY protocol_slug`);
    if (comp.rows.length === 0) console.log('  (empty)');
    for (const r of comp.rows) console.log(`  ${String(r.protocol_slug).padEnd(15)} ${r.n} rows  latest ${r.latest}  (${r.latest_rows} assets on latest day)`);

    console.log('\n=== 5. tbill_rates_daily ===');
    const tb = await q(`SELECT COUNT(*) n, MAX(snapshot_date)::text latest FROM morpho_.tbill_rates_daily`).catch(() => null);
    if (!tb) { const tb2 = await q(`SELECT COUNT(*) n, MAX(day)::text latest FROM morpho_.tbill_rates_daily`).catch(()=>null); console.log(tb2 ? tb2.rows[0] : '(table/col name differs)'); }
    else console.log(tb.rows[0]);
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
