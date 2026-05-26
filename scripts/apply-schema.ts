import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SCHEMA_DIR = join(REPO_ROOT, 'packages', 'db', 'schema');

loadEnv({ path: join(REPO_ROOT, '.env') });

// Neon's Pool uses a WebSocket transport in Node. The HTTP `neon()` helper runs
// one statement per call; Pool lets us send entire .sql files in one go.
neonConfig.webSocketConstructor = ws;

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const files = (await readdir(SCHEMA_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.error(`No .sql files found in ${SCHEMA_DIR}`);
    process.exit(1);
  }

  console.log(`Applying ${files.length} schema file(s) to Neon...`);

  const pool = new Pool({ connectionString: dbUrl });
  const client = await pool.connect();

  let failed: string | null = null;
  try {
    for (const file of files) {
      const sqlText = await readFile(join(SCHEMA_DIR, file), 'utf8');
      process.stdout.write(`  ${file} ... `);
      try {
        await client.query(sqlText);
        process.stdout.write('ok\n');
      } catch (err) {
        process.stdout.write('FAILED\n');
        failed = file;
        console.error(err);
        break;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  if (failed) {
    console.error(`\nStopped at ${failed}. Earlier files were applied; reruns are idempotent.`);
    process.exit(1);
  }

  console.log(`\nDone. ${files.length} file(s) applied.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
