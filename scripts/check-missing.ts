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
  const slugs = [
    'maple', 'cooler-loans', 'crvusd', 'liquity-v2', 'frankencoin', 'usdd',
    'curve-llamalend', 'aave-v2', 'aave-v4', 'flux-finance', 'resupply', 'fraxlend',
  ];
  const r = await c.query(
    `SELECT
       s.protocol_slug,
       s.category,
       s.last_history_synced_at IS NOT NULL AS synced,
       (SELECT COUNT(*)::int FROM morpho_.protocol_tvl_daily
        WHERE protocol_slug = s.protocol_slug AND chain_slug = 'Ethereum') AS eth_rows,
       (SELECT tvl_usd::text FROM morpho_.protocol_tvl_daily
        WHERE protocol_slug = s.protocol_slug AND chain_slug = 'Ethereum'
        ORDER BY snapshot_date DESC LIMIT 1) AS eth_latest_tvl
     FROM morpho_.defillama_protocols_snapshot s
     WHERE s.protocol_slug = ANY($1)
     ORDER BY s.protocol_slug`,
    [slugs],
  );
  console.table(r.rows);

  const missingFromDb = slugs.filter((s) => !r.rows.find((row) => row.protocol_slug === s));
  if (missingFromDb.length > 0) {
    console.log(`\nProtocols not even in defillama_protocols_snapshot:`, missingFromDb);
  }

  c.release();
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
