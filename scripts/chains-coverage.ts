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
      SELECT ch.chain_id, ch.name, ch.slug,
             COUNT(DISTINCT m.unique_key)::int AS markets
      FROM morpho_.chains ch
      LEFT JOIN morpho_.markets m ON m.chain_id = ch.chain_id
      GROUP BY ch.chain_id, ch.name, ch.slug
      ORDER BY markets DESC NULLS LAST, ch.chain_id
    `);
    console.log('chain_id | name | slug | markets');
    for (const x of r.rows) console.log(`${x.chain_id} | ${x.name} | ${x.slug} | ${x.markets}`);
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
