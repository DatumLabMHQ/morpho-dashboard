// One-time storage reclaim: collapse history older than 120 days to ONE row per
// ISO week per partition, on the two DefiLlama time-series tables. Keeps the
// last 120 days at daily granularity. Then VACUUM FULL to return space to disk.
//
// SAFE because:
//   - protocol_tvl_daily: charts/competitor-stacks read 24mo line/area series;
//     weekly resolution on old data is visually identical. The lending-denom
//     rebuild GROUP BYs whatever dates exist, so the derived chain_lending_tvl_daily
//     stays consistent (also downsampled here).
//   - market_state_daily / vault_state_daily are NOT touched (their daily rows
//     back the exact 1d/30d/365d KPI anchors).
//
// Dry-run by default (prints what would be deleted + projected size). Pass
// --apply to execute the DELETEs + VACUUM FULL.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const APPLY = process.argv.includes('--apply');
const KEEP_DAILY_DAYS = 120;

// (table, partition columns) for the ISO-week dedupe.
const TABLES: { table: string; partition: string }[] = [
  { table: 'morpho_.protocol_tvl_daily', partition: 'protocol_slug, chain_slug' },
  { table: 'morpho_.chain_lending_tvl_daily', partition: 'chain_slug' },
];

const dedupeCTE = (table: string, partition: string) => `
  SELECT ctid FROM (
    SELECT ctid,
      ROW_NUMBER() OVER (
        PARTITION BY ${partition}, date_trunc('week', snapshot_date::timestamp)
        ORDER BY snapshot_date DESC
      ) AS rn
    FROM ${table}
    WHERE snapshot_date < CURRENT_DATE - INTERVAL '${KEEP_DAILY_DAYS} days'
  ) q WHERE q.rn > 1`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    for (const { table, partition } of TABLES) {
      const total = await c.query(`SELECT COUNT(*)::bigint n FROM ${table}`);
      const totalN = Number(total.rows[0].n);
      const del = await c.query(`SELECT COUNT(*)::bigint n FROM (${dedupeCTE(table, partition)}) d`);
      const delN = Number(del.rows[0].n);
      const sz = await c.query(`SELECT pg_total_relation_size('${table}')::bigint b`);
      const mb = Number(sz.rows[0].b) / 1048576;
      const projMb = totalN > 0 ? (mb * (totalN - delN)) / totalN : mb;
      console.log(`${table}`);
      console.log(`  rows ${totalN.toLocaleString()} -> ${(totalN - delN).toLocaleString()} (delete ${delN.toLocaleString()})`);
      console.log(`  size ~${mb.toFixed(0)} MB -> ~${projMb.toFixed(0)} MB after VACUUM FULL\n`);

      if (APPLY && delN > 0) {
        process.stdout.write(`  deleting...`);
        await c.query(`DELETE FROM ${table} WHERE ctid IN (${dedupeCTE(table, partition)})`);
        process.stdout.write(` VACUUM FULL...`);
        await c.query(`VACUUM FULL ${table}`);
        console.log(' done.\n');
      }
    }
    const db = await c.query(`SELECT pg_size_pretty(pg_database_size(current_database())) s`);
    console.log(`${APPLY ? 'AFTER' : 'CURRENT'} total database size: ${db.rows[0].s}`);
    if (!APPLY) console.log('\n(dry run — re-run with --apply to execute)');
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
