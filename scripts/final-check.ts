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
  async function q(label: string, sql: string) {
    const r = await c.query(sql);
    console.log(`\n=== ${label} ===`);
    console.table(r.rows);
  }
  try {
    await q('row counts (final)', `
      SELECT 'protocol_tvl_daily' t, COUNT(*) c FROM morpho_.protocol_tvl_daily UNION ALL
      SELECT 'chain_lending_tvl_daily', COUNT(*) FROM morpho_.chain_lending_tvl_daily UNION ALL
      SELECT 'history-synced lending', COUNT(*) FROM morpho_.defillama_protocols_snapshot WHERE last_history_synced_at IS NOT NULL AND category IN ('Lending','CDP')
    `);

    await q('Morpho TVL by chain (latest 10)', `
      SELECT chain_slug, ROUND(tvl_usd::numeric, 0) tvl_usd
      FROM morpho_.protocol_tvl_daily
      WHERE protocol_slug = 'morpho-blue'
        AND snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.protocol_tvl_daily WHERE protocol_slug = 'morpho-blue')
      ORDER BY tvl_usd DESC LIMIT 10
    `);

    await q('Morpho share of chain lending (Base, Ethereum, Unichain, Katana)', `
      SELECT
        m.chain_slug,
        ROUND(m.tvl_usd::numeric, 0)                     morpho_tvl,
        ROUND(l.lending_tvl_usd::numeric, 0)             chain_lending_tvl,
        l.protocol_count                                  in_denom,
        ROUND((m.tvl_usd::numeric / NULLIF(l.lending_tvl_usd, 0)::numeric * 100)::numeric, 1) || '%' share
      FROM morpho_.protocol_tvl_daily m
      JOIN morpho_.chain_lending_tvl_daily l USING (chain_slug, snapshot_date)
      WHERE m.protocol_slug = 'morpho-blue'
        AND m.snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.protocol_tvl_daily WHERE protocol_slug = 'morpho-blue')
        AND m.chain_slug IN ('Base', 'Ethereum', 'Unichain', 'Katana', 'Arbitrum', 'Hyperliquid L1')
      ORDER BY m.tvl_usd DESC
    `);
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
