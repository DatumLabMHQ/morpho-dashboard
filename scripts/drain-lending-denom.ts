// Drains defillama-lending-denom until hasMore=false. Same retry policy as
// backfill-all.ts. When done, prints the new Ethereum lending TVL + Morpho share.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const WORKER_URL = process.env.WORKER_URL!;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN!;
if (!WORKER_URL || !ADMIN_TOKEN) {
  console.error('WORKER_URL and ADMIN_TOKEN required in .env');
  process.exit(1);
}

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
const MAX_TICKS_SAFETY = 200;       // bail-out if delta gate is still flapping

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TickRes {
  status: string;
  written: number;
  hasMore: boolean;
  notes?: {
    lendingProtocolsTotal?: number;
    toRefetchTotal?: number;
    batchProcessed?: number;
  };
}

async function tickWithRetry(): Promise<TickRes | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const r = await fetch(`${WORKER_URL}/backfill/tick?job=defillama-lending-denom`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return (await r.json()) as TickRes;
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length) {
        const d = RETRY_DELAYS_MS[attempt]!;
        console.warn(`tick error (attempt ${attempt + 1}): ${err}. retrying in ${d / 1000}s`);
        await sleep(d);
      } else {
        console.error(`retry exhausted: ${err}`);
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log(`Draining defillama-lending-denom at ${new Date().toISOString()}\n`);

  let ticks = 0;
  let prevRemaining = -1;
  let stuckCount = 0;

  while (ticks < MAX_TICKS_SAFETY) {
    const t0 = Date.now();
    const res = await tickWithRetry();
    const ms = Date.now() - t0;
    if (!res) {
      console.error('skipping tick');
      await sleep(5_000);
      continue;
    }
    ticks++;

    const total = Number(res.notes?.lendingProtocolsTotal ?? 0);
    const remaining = Number(res.notes?.toRefetchTotal ?? 0);
    const processed = total - remaining;
    const pct = total > 0 ? ((processed / total) * 100).toFixed(1) : '?';
    console.log(
      `[lending-denom] tick ${ticks}: ${processed}/${total} (${pct}%) | remaining=${remaining} | ${ms}ms`,
    );

    if (!res.hasMore) {
      console.log(`✓ DONE after ${ticks} ticks at ${new Date().toISOString()}`);
      break;
    }

    // Watchdog: if remaining doesn't decrease for 5 ticks, bail with diagnostic.
    if (remaining === prevRemaining) {
      stuckCount++;
      if (stuckCount >= 5) {
        console.error(
          `Watchdog: remaining stuck at ${remaining} for 5 ticks. Anchor fix may not be working as expected. Bailing.`,
        );
        process.exit(2);
      }
    } else {
      stuckCount = 0;
    }
    prevRemaining = remaining;
  }
  if (ticks >= MAX_TICKS_SAFETY) {
    console.warn(`Hit safety cap of ${MAX_TICKS_SAFETY} ticks.`);
  }

  // After drain, print the updated Ethereum number.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    const r = await c.query<{ tvl: string; morpho: string; count: number }>(`
      SELECT
        (SELECT lending_tvl_usd::text FROM morpho_.chain_lending_tvl_daily
         WHERE chain_slug='Ethereum' ORDER BY snapshot_date DESC LIMIT 1) AS tvl,
        (SELECT tvl_usd::text FROM morpho_.protocol_tvl_daily
         WHERE chain_slug='Ethereum' AND protocol_slug='morpho-blue'
         ORDER BY snapshot_date DESC LIMIT 1) AS morpho,
        (SELECT COUNT(DISTINCT t.protocol_slug)::int
         FROM morpho_.protocol_tvl_daily t
         JOIN morpho_.defillama_protocols_snapshot s ON s.protocol_slug = t.protocol_slug
         WHERE t.chain_slug='Ethereum'
           AND t.snapshot_date = (SELECT MAX(snapshot_date) FROM morpho_.protocol_tvl_daily WHERE chain_slug='Ethereum')
           AND s.category IN ('Lending','CDP')) AS count
    `);
    const tvl = Number(r.rows[0]?.tvl ?? 0);
    const morpho = Number(r.rows[0]?.morpho ?? 0);
    const count = r.rows[0]?.count ?? 0;
    const share = tvl > 0 ? (morpho / tvl) * 100 : 0;
    console.log(
      `\n--- Post-drain Ethereum snapshot ---\n` +
        `  Lending+CDP protocols (Ethereum, our DB): ${count}\n` +
        `  Ethereum chain_lending_tvl_usd:           $${Math.round(tvl).toLocaleString()}\n` +
        `  morpho-blue on Ethereum:                  $${Math.round(morpho).toLocaleString()}\n` +
        `  Implied Morpho share:                     ${share.toFixed(1)}%\n`,
    );
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
