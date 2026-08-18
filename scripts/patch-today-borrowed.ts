// Bridges the one-time borrowed_usd gap: today's protocol_tvl_daily rows were
// written by the pre-borrowed worker, so deposits (= tvl + borrowed) drops on
// the latest day, creating a cliff on the sector chart. Carry forward
// yesterday's borrowed (stable day-to-day) into today's NULL rows. Only fills
// protocols that already had borrowed (the comparators); the new worker writes
// the real value on its next run.
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
    const r = await c.query(`
      UPDATE morpho_.protocol_tvl_daily t
      SET borrowed_usd = prev.borrowed_usd, recorded_at = NOW()
      FROM morpho_.protocol_tvl_daily prev
      WHERE t.snapshot_date >= CURRENT_DATE - 1
        AND t.borrowed_usd IS NULL
        AND prev.protocol_slug = t.protocol_slug
        AND prev.chain_slug    = t.chain_slug
        AND prev.snapshot_date = t.snapshot_date - 1
        AND prev.borrowed_usd IS NOT NULL
      RETURNING 1`);
    console.log(`carried forward borrowed into ${r.rowCount} recent rows`);
    // Verify the cliff is gone: deposits for aave-v3 / morpho-blue, last 3 days.
    const chk = await c.query(`
      SELECT snapshot_date::text d, protocol_slug,
        ROUND((SUM(tvl_usd)+SUM(COALESCE(borrowed_usd,0)))/1e9,2) deposits_b
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug IN ('aave-v3','morpho-blue') AND snapshot_date >= CURRENT_DATE - 2
      GROUP BY snapshot_date, protocol_slug ORDER BY d DESC, protocol_slug`);
    for (const x of chk.rows) console.log(`  ${x.d}  ${x.protocol_slug.padEnd(11)} deposits $${x.deposits_b}B`);
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
