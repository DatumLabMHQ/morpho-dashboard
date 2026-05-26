// Prints CR3, CR5, HHI + the top 5 curators by TVL.
// Mirrors the SQL in apps/web/lib/queries/curators.ts so the numbers match
// what the dashboard renders.

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
      WITH per_curator AS (
        SELECT v.curator_id,
               SUM(s.total_assets_usd)::float8 AS tvl
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL AND s.total_assets_usd > 0
        GROUP BY v.curator_id
      ),
      totals AS (SELECT SUM(tvl)::float8 AS total FROM per_curator),
      ranked AS (
        SELECT curator_id, tvl,
               ROW_NUMBER() OVER (ORDER BY tvl DESC) AS rnk,
               tvl / NULLIF((SELECT total FROM totals), 0) AS share
        FROM per_curator
      )
      SELECT
        (SELECT SUM(share) FILTER (WHERE rnk <= 3)::float8 FROM ranked) AS cr3,
        (SELECT SUM(share) FILTER (WHERE rnk <= 5)::float8 FROM ranked) AS cr5,
        (SELECT SUM(POWER(share * 100, 2))::float8 FROM ranked)         AS hhi
    `);
    console.log('\n=== Curator concentration ===\n');
    console.log(`CR3 = ${(r.rows[0].cr3 * 100).toFixed(1)}%`);
    console.log(`CR5 = ${(r.rows[0].cr5 * 100).toFixed(1)}%`);
    console.log(`HHI = ${Math.round(r.rows[0].hhi).toLocaleString()}  (DOJ: >2500 = highly concentrated)`);

    const top = await c.query(`
      WITH per_curator AS (
        SELECT v.curator_id,
               SUM(s.total_assets_usd)::float8 AS tvl,
               COUNT(*)::int AS vault_count
        FROM morpho_.vaults v
        JOIN LATERAL (
          SELECT total_assets_usd FROM morpho_.vault_state_daily x
          WHERE x.chain_id = v.chain_id AND x.vault_address = v.address
          ORDER BY x.snapshot_date DESC LIMIT 1
        ) s ON TRUE
        WHERE v.curator_id IS NOT NULL AND s.total_assets_usd > 0
        GROUP BY v.curator_id
      )
      SELECT pc.curator_id, c.name, pc.tvl, pc.vault_count
      FROM per_curator pc
      LEFT JOIN morpho_.curators c ON c.id = pc.curator_id
      ORDER BY pc.tvl DESC LIMIT 5
    `);
    console.log('\n=== Top 5 curators by TVL ===\n');
    console.table(
      top.rows.map((r) => ({
        rank: r.curator_id,
        name: r.name,
        tvl: `$${(r.tvl / 1e9).toFixed(2)}B`,
        vaults: r.vault_count,
      })),
    );
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
