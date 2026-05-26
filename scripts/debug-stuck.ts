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
  const client = await pool.connect();
  try {
    // Snapshot table state — how many rows? how many with null tvl?
    const r1 = await client.query(`
      SELECT
        COUNT(*) total,
        COUNT(*) FILTER (WHERE last_tvl_usd IS NULL) null_tvl,
        COUNT(*) FILTER (WHERE last_tvl_usd = 0) zero_tvl,
        COUNT(*) FILTER (WHERE last_history_synced_at IS NULL) never_synced
      FROM morpho_.defillama_protocols_snapshot
    `);
    console.log('snapshot summary:', r1.rows[0]);

    // Sample stuck rows
    const r2 = await client.query(`
      SELECT protocol_slug, name, category, last_tvl_usd, last_history_synced_at
      FROM morpho_.defillama_protocols_snapshot
      WHERE category IN ('Lending','CDP')
      ORDER BY last_history_synced_at DESC NULLS FIRST
      LIMIT 30
    `);
    console.table(r2.rows.slice(0, 15));

    // How many never-synced (last_history_synced_at null)?
    const r3 = await client.query(`
      SELECT COUNT(*)::int c
      FROM morpho_.defillama_protocols_snapshot
      WHERE category IN ('Lending','CDP')
        AND last_history_synced_at IS NULL
    `);
    console.log('lending/CDP never-synced:', r3.rows[0]);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
