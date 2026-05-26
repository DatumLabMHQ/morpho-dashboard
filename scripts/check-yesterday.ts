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
  const r = await c.query(`
    SELECT (MAX(snapshot_date) - INTERVAL '1 day')::text AS as_of
    FROM morpho_.chain_lending_tvl_daily
  `);
  const day = r.rows[0].as_of;
  console.log('as_of:', day);
  const r2 = await c.query(`
    SELECT l.chain_slug, l.lending_tvl_usd::text AS denom, l.protocol_count,
      m.tvl_usd::text AS morpho_tvl,
      (m.tvl_usd::numeric / NULLIF(l.lending_tvl_usd, 0) * 100)::text AS share_pct
    FROM morpho_.chain_lending_tvl_daily l
    JOIN morpho_.protocol_tvl_daily m
      ON m.chain_slug = l.chain_slug AND m.snapshot_date = l.snapshot_date
      AND m.protocol_slug = 'morpho-blue'
    WHERE l.snapshot_date = $1::date AND l.chain_slug IN ('Base','Ethereum')
  `, [day]);
  console.table(r2.rows);

  // 12mo ago
  const r3 = await c.query(`
    WITH ago AS (
      SELECT DISTINCT ON (m.chain_slug) m.chain_slug, m.snapshot_date::text AS d,
        (m.tvl_usd::numeric / NULLIF(l.lending_tvl_usd, 0) * 100)::text AS share_pct
      FROM morpho_.protocol_tvl_daily m
      JOIN morpho_.chain_lending_tvl_daily l
        ON l.chain_slug = m.chain_slug AND l.snapshot_date = m.snapshot_date
      WHERE m.protocol_slug = 'morpho-blue'
        AND m.chain_slug IN ('Base','Ethereum')
        AND m.snapshot_date <= ($1::date - INTERVAL '365 days')
      ORDER BY m.chain_slug, m.snapshot_date DESC
    )
    SELECT * FROM ago
  `, [day]);
  console.log('\n12mo ago:');
  console.table(r3.rows);

  // Date range of chain_lending_tvl_daily for Ethereum
  const r4 = await c.query(`
    SELECT MIN(snapshot_date)::text mind, MAX(snapshot_date)::text maxd, COUNT(*)::int n
    FROM morpho_.chain_lending_tvl_daily WHERE chain_slug='Ethereum'
  `);
  console.log('\nEthereum chain_lending date range:', r4.rows[0]);

  c.release();
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
