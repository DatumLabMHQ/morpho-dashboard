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

  // 1. Current chain_lending_tvl_daily row for Ethereum latest day
  const r1 = await c.query(`
    SELECT snapshot_date::text, lending_tvl_usd::text, protocol_count, recorded_at::text
    FROM morpho_.chain_lending_tvl_daily
    WHERE chain_slug = 'Ethereum'
    ORDER BY snapshot_date DESC LIMIT 3
  `);
  console.log('chain_lending_tvl_daily for Ethereum (latest 3):');
  console.table(r1.rows);

  // 2. What the rebuild SHOULD produce — re-run the aggregation but only SELECT
  const r2 = await c.query(`
    SELECT
      t.snapshot_date::text,
      SUM(t.tvl_usd)::text AS expected_tvl,
      COUNT(DISTINCT t.protocol_slug)::int AS expected_count
    FROM morpho_.protocol_tvl_daily t
    JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
    WHERE t.chain_slug = 'Ethereum'
      AND s.category IN ('Lending', 'CDP')
      AND t.snapshot_date >= CURRENT_DATE - INTERVAL '365 days'
    GROUP BY t.snapshot_date
    ORDER BY t.snapshot_date DESC LIMIT 3
  `);
  console.log('\nExpected aggregate from protocol_tvl_daily (latest 3 days):');
  console.table(r2.rows);

  // 3. Top contributors to Ethereum on latest day
  const r3 = await c.query(`
    SELECT t.protocol_slug, s.category, t.tvl_usd::text AS tvl
    FROM morpho_.protocol_tvl_daily t
    JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
    WHERE t.chain_slug = 'Ethereum'
      AND s.category IN ('Lending', 'CDP')
      AND t.snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.protocol_tvl_daily WHERE chain_slug = 'Ethereum')
    ORDER BY t.tvl_usd DESC LIMIT 10
  `);
  console.log('\nTop 10 Ethereum lending+CDP in protocol_tvl_daily (latest day):');
  console.table(r3.rows);

  c.release();
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
