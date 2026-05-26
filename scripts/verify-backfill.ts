// Standalone verification summary — same queries that would have run at the end
// of backfill-all.ts, but factored so we can run it after killing the stuck loop.

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
    console.log('=========================================================');
    console.log(' VERIFICATION SUMMARY ');
    console.log('=========================================================\n');

    const counts = await c.query(`
      SELECT 'market_state_daily' t, COUNT(*)::bigint c FROM morpho_.market_state_daily UNION ALL
      SELECT 'vault_state_daily',     COUNT(*)::bigint   FROM morpho_.vault_state_daily   UNION ALL
      SELECT 'protocol_tvl_daily',    COUNT(*)::bigint   FROM morpho_.protocol_tvl_daily
    `);
    console.log('Row counts:');
    console.table(counts.rows.map((r) => ({ table: r.t, rows: String(r.c) })));

    const mh = await c.query(`
      SELECT MIN(snapshot_date)::text AS min_day, MAX(snapshot_date)::text AS max_day,
             COUNT(DISTINCT market_unique_key)::int AS distinct_markets
      FROM morpho_.market_state_daily
    `);
    const mh30 = await c.query(`
      SELECT COUNT(*)::int c FROM (
        SELECT market_unique_key FROM morpho_.market_state_daily
        GROUP BY market_unique_key HAVING COUNT(*) >= 30
      ) x
    `);
    console.log('Market state history:');
    console.table([{
      min_day: mh.rows[0]!.min_day,
      max_day: mh.rows[0]!.max_day,
      distinct_markets: mh.rows[0]!.distinct_markets,
      markets_with_30d_plus: mh30.rows[0]!.c,
    }]);

    const vh = await c.query(`
      SELECT MIN(snapshot_date)::text AS min_day, MAX(snapshot_date)::text AS max_day,
             COUNT(DISTINCT chain_id || ':' || vault_address)::int AS distinct_vaults
      FROM morpho_.vault_state_daily
    `);
    const vh30 = await c.query(`
      SELECT COUNT(*)::int c FROM (
        SELECT chain_id, vault_address FROM morpho_.vault_state_daily
        GROUP BY chain_id, vault_address HAVING COUNT(*) >= 30
      ) x
    `);
    console.log('Vault state history:');
    console.table([{
      min_day: vh.rows[0]!.min_day,
      max_day: vh.rows[0]!.max_day,
      distinct_vaults: vh.rows[0]!.distinct_vaults,
      vaults_with_30d_plus: vh30.rows[0]!.c,
    }]);

    const synced = await c.query<{ c: number }>(`
      SELECT COUNT(*)::int c FROM morpho_.defillama_protocols_snapshot
      WHERE category IN ('Lending','CDP') AND last_history_synced_at IS NOT NULL
    `);
    const lendingTotal = await c.query<{ c: number }>(`
      SELECT COUNT(*)::int c FROM morpho_.defillama_protocols_snapshot
      WHERE category IN ('Lending','CDP')
    `);
    console.log(`Lending+CDP protocols history-synced: ${synced.rows[0]!.c} of ${lendingTotal.rows[0]!.c}\n`);

    const chains = ['Ethereum', 'Base', 'Arbitrum', 'Polygon'] as const;
    const perChain: any[] = [];
    for (const chain of chains) {
      const r = await c.query(
        `SELECT
           (SELECT COUNT(DISTINCT t.protocol_slug)::int
            FROM morpho_.protocol_tvl_daily t
            JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
            WHERE t.chain_slug = $1
              AND t.snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.protocol_tvl_daily WHERE chain_slug = $1)
              AND s.category IN ('Lending','CDP')) AS our_synced,
           (SELECT lending_tvl_usd::text FROM morpho_.chain_lending_tvl_daily
            WHERE chain_slug = $1 ORDER BY snapshot_date DESC LIMIT 1) AS chain_lending,
           (SELECT tvl_usd::text FROM morpho_.protocol_tvl_daily
            WHERE chain_slug = $1 AND protocol_slug = 'morpho-blue' ORDER BY snapshot_date DESC LIMIT 1) AS morpho_tvl`,
        [chain],
      );
      const ours = Number(r.rows[0]?.our_synced ?? 0);
      const denom = Number(r.rows[0]?.chain_lending ?? 0);
      const morpho = Number(r.rows[0]?.morpho_tvl ?? 0);
      perChain.push({
        chain,
        our_synced_protocols: ours,
        our_chain_lending_tvl: `$${Math.round(denom).toLocaleString()}`,
        morpho_tvl: `$${Math.round(morpho).toLocaleString()}`,
        morpho_share: denom > 0 ? `${((morpho / denom) * 100).toFixed(1)}%` : '—',
      });
    }
    console.log('Per-chain Morpho share (Ethereum / Base / Arbitrum / Polygon):');
    console.table(perChain);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
