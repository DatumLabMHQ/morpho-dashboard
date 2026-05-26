import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const NON_CHAIN_KEYS = ['borrowed', 'staking', 'pool2', 'treasury', 'offers', 'vesting'];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const a = await client.query(
      `DELETE FROM morpho_.protocol_tvl_daily WHERE chain_slug = ANY($1) RETURNING 1`,
      [NON_CHAIN_KEYS],
    );
    const b = await client.query(
      `DELETE FROM morpho_.chain_lending_tvl_daily WHERE chain_slug = ANY($1) RETURNING 1`,
      [NON_CHAIN_KEYS],
    );
    // Also drop any chain_slug containing '-' (Optimism-borrowed, etc.) just in case
    const c = await client.query(
      `DELETE FROM morpho_.protocol_tvl_daily WHERE chain_slug LIKE '%-%' RETURNING 1`,
    );
    const d = await client.query(
      `DELETE FROM morpho_.chain_lending_tvl_daily WHERE chain_slug LIKE '%-%' RETURNING 1`,
    );
    console.log(`Removed:
      protocol_tvl_daily   non-chain: ${a.rowCount}, hyphenated: ${c.rowCount}
      chain_lending_tvl    non-chain: ${b.rowCount}, hyphenated: ${d.rowCount}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
