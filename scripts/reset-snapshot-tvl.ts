import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });
neonConfig.webSocketConstructor = ws;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    const r = await c.query(`
      UPDATE morpho_.defillama_protocols_snapshot
      SET last_tvl_usd = NULL
      WHERE last_history_synced_at IS NULL
    `);
    console.log(`reset last_tvl_usd to NULL on ${r.rowCount} never-synced rows`);
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
