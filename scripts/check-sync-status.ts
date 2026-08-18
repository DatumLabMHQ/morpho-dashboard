// Read-only: recent sync_runs status, to tell whether the worker's WRITES are
// still succeeding (i.e. whether Neon is blocking writes at the storage cap).
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
    const recent = await c.query(`
      SELECT job, status, rows_written,
             to_char(started_at, 'MM-DD HH24:MI') AS started,
             LEFT(COALESCE(error_message, ''), 80) AS err
      FROM morpho_.sync_runs
      ORDER BY started_at DESC
      LIMIT 15
    `);
    console.log('=== last 15 sync runs ===');
    for (const r of recent.rows) {
      console.log(`  ${r.started}  ${String(r.status).padEnd(6)} ${String(r.job).padEnd(26)} rows=${r.rows_written ?? '-'}${r.err ? '  ERR: ' + r.err : ''}`);
    }
    const agg = await c.query(`
      SELECT status, COUNT(*)::int n, MAX(started_at) last
      FROM morpho_.sync_runs
      WHERE started_at > NOW() - INTERVAL '48 hours'
      GROUP BY status ORDER BY n DESC
    `);
    console.log('\n=== last 48h by status ===');
    for (const r of agg.rows) console.log(`  ${String(r.status).padEnd(6)} ${r.n}  (latest ${new Date(r.last).toISOString().slice(0, 16)})`);
    const fresh = await c.query(`SELECT MAX(recorded_at) AS m FROM morpho_.market_state_daily`);
    console.log(`\nmarket_state_daily newest write: ${fresh.rows[0].m ? new Date(fresh.rows[0].m).toISOString() : 'none'}`);
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error('check failed:', e.message); process.exit(1); });
