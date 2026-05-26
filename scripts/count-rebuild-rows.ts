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
    SELECT COUNT(*)::int AS rows_updated
    FROM morpho_.chain_lending_tvl_daily
    WHERE snapshot_date >= CURRENT_DATE - INTERVAL '60 days'
      AND recorded_at >= NOW() - INTERVAL '90 minutes'
  `);
  console.log(`rows_updated_60d_window: ${r.rows[0]!.rows_updated}`);
  c.release();
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
