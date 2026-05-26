import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });
neonConfig.webSocketConstructor = ws;

async function main() {
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error('DATABASE_URL not set'); process.exit(1); }

const pool = new Pool({ connectionString: dbUrl });
const client = await pool.connect();

async function q(label: string, sql: string) {
  const r = await client.query(sql);
  console.log(`\n=== ${label} ===`);
  console.table(r.rows);
}

try {
  await q('row counts', `
    SELECT 'chains' t, COUNT(*) c FROM morpho_.chains UNION ALL
    SELECT 'curators', COUNT(*) FROM morpho_.curators UNION ALL
    SELECT 'curator_addresses', COUNT(*) FROM morpho_.curator_addresses UNION ALL
    SELECT 'assets', COUNT(*) FROM morpho_.assets UNION ALL
    SELECT 'markets', COUNT(*) FROM morpho_.markets UNION ALL
    SELECT 'vaults', COUNT(*) FROM morpho_.vaults UNION ALL
    SELECT 'market_state_daily', COUNT(*) FROM morpho_.market_state_daily UNION ALL
    SELECT 'vault_state_daily', COUNT(*) FROM morpho_.vault_state_daily UNION ALL
    SELECT 'protocol_tvl_daily', COUNT(*) FROM morpho_.protocol_tvl_daily UNION ALL
    SELECT 'protocol_fees_daily', COUNT(*) FROM morpho_.protocol_fees_daily UNION ALL
    SELECT 'chain_lending_tvl_daily', COUNT(*) FROM morpho_.chain_lending_tvl_daily UNION ALL
    SELECT 'defillama_protocols_snapshot', COUNT(*) FROM morpho_.defillama_protocols_snapshot
  `);

  await q('Morpho TVL by chain (latest)', `
    SELECT chain_slug, ROUND(tvl_usd::numeric, 0) tvl_usd
    FROM morpho_.protocol_tvl_daily
    WHERE protocol_slug = 'morpho-blue'
      AND snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.protocol_tvl_daily WHERE protocol_slug = 'morpho-blue')
    ORDER BY tvl_usd DESC LIMIT 10
  `);

  await q('sync_runs (latest 8)', `
    SELECT id, job, status, rows_written, EXTRACT(EPOCH FROM (finished_at - started_at))::int duration_s
    FROM morpho_.sync_runs ORDER BY id DESC LIMIT 8
  `);
} finally {
  client.release();
  await pool.end();
}
}

main().catch((e) => { console.error(e); process.exit(1); });
