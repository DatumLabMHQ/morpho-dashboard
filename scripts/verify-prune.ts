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
  try {
    // 1. Latest dates present (data still current).
    const maxd = await c.query(`
      SELECT 'protocol_tvl_daily' t, MAX(snapshot_date)::text d FROM morpho_.protocol_tvl_daily
      UNION ALL SELECT 'chain_lending_tvl_daily', MAX(snapshot_date)::text FROM morpho_.chain_lending_tvl_daily`);
    console.log('=== latest snapshot_date ===');
    for (const r of maxd.rows) console.log(`  ${r.t.padEnd(26)} ${r.d}`);

    // 2. Granularity check for a comparator series (morpho-blue on Ethereum).
    const g = await c.query(`
      SELECT
        COUNT(*) FILTER (WHERE snapshot_date >= CURRENT_DATE - INTERVAL '120 days') AS recent_daily,
        COUNT(*) FILTER (WHERE snapshot_date <  CURRENT_DATE - INTERVAL '120 days') AS old_weekly,
        MIN(snapshot_date)::text AS earliest
      FROM morpho_.protocol_tvl_daily WHERE protocol_slug='morpho-blue' AND chain_slug='Ethereum'`);
    const r = g.rows[0];
    console.log(`\n=== morpho-blue/Ethereum series (protocol_tvl_daily) ===`);
    console.log(`  last 120d: ${r.recent_daily} rows (expect ~120 daily)`);
    console.log(`  older:     ${r.old_weekly} rows (expect ~85 weekly, i.e. <<730)`);
    console.log(`  earliest:  ${r.earliest}`);

    // 3. Denominator intact: Ethereum lending TVL recent values present.
    const d = await c.query(`
      SELECT snapshot_date::text d, ROUND(lending_tvl_usd/1e9, 2) tvl_b, protocol_count
      FROM morpho_.chain_lending_tvl_daily WHERE chain_slug='Ethereum'
      ORDER BY snapshot_date DESC LIMIT 3`);
    console.log(`\n=== chain_lending_tvl_daily (Ethereum, latest 3) ===`);
    for (const x of d.rows) console.log(`  ${x.d}  $${x.tvl_b}B  ${x.protocol_count} protocols`);

    // 4. Comparator coverage unchanged (sector chart needs all 11).
    const cov = await c.query(`
      SELECT COUNT(DISTINCT protocol_slug) n FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = ANY(ARRAY['morpho-blue','aave-v3','aave-v2','sparklend','compound-v3','compound-v2','fluid-lending','euler-v2','sky-lending','liquity-v1','liquity-v2'])`);
    console.log(`\ncomparator protocols still present: ${cov.rows[0].n}/11`);
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
