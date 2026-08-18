// Read-only: total DB size + the largest tables in the morpho_ schema, with row
// counts. Helps decide migrate-to-new-project vs prune-in-place.
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
    const db = await c.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS sz`);
    console.log(`Total database size: ${db.rows[0].sz}\n`);
    const t = await c.query(`
      SELECT relname AS table,
             pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
             to_char(c.reltuples::bigint, 'FM999,999,999') AS approx_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'morpho_' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 25
    `);
    console.log('largest tables (morpho_):');
    for (const r of t.rows) console.log(`  ${String(r.total).padStart(9)}  ${String(r.approx_rows).padStart(13)} rows  ${r.table}`);
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error('size check failed:', e.message); process.exit(1); });
