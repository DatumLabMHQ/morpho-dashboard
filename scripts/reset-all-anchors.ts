// Forces a re-drain by clearing the anchor + sync-time fields on all lending+CDP
// protocols. Used when we change HISTORY_DAYS (the delta gate alone wouldn't
// re-trigger fetches if /protocols TVL hasn't moved >1%).

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
      UPDATE morpho_.defillama_protocols_snapshot
      SET last_fetched_history_tvl_usd = NULL,
          last_history_synced_at       = NULL
      WHERE category IN ('Lending','CDP')
    `);
    console.log(`cleared anchor + sync_at on ${r.rowCount} lending+CDP rows`);
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
