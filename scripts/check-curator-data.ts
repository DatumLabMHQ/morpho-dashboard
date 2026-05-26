import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';
const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

async function main() {
  const p = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await p.connect();
  const r = await c.query(`
    SELECT 'allocations' t, COUNT(*)::int c FROM morpho_.vault_allocations_daily UNION ALL
    SELECT 'curators', COUNT(*) FROM morpho_.curators UNION ALL
    SELECT 'curator_addresses', COUNT(*) FROM morpho_.curator_addresses UNION ALL
    SELECT 'vaults', COUNT(*) FROM morpho_.vaults UNION ALL
    SELECT 'vaults_with_curator_id', COUNT(*) FROM morpho_.vaults WHERE curator_id IS NOT NULL UNION ALL
    SELECT 'vaults_with_fee_recipient', COUNT(*) FROM morpho_.vaults WHERE fee_recipient_address IS NOT NULL
  `);
  console.table(r.rows);
  c.release();
  await p.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
