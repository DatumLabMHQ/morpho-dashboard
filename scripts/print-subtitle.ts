// Prints the auto-generated chart subtitle to stdout.
// Mirrors the SQL in apps/web/lib/queries/chains.ts so we stay consistent
// with what the page actually renders.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const pct1 = (v: number | null) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    const latestRows = await c.query<{ as_of: string }>(
      `SELECT (MAX(snapshot_date) - INTERVAL '1 day')::text AS as_of
       FROM morpho_.chain_lending_tvl_daily`,
    );
    const asOf = latestRows.rows[0]!.as_of;

    const rows = await c.query<{
      chain_slug: string;
      share: number;
      share_12mo_ago: number | null;
    }>(
      `WITH latest AS (
         SELECT m.chain_slug,
                (m.tvl_usd::numeric / NULLIF(l.lending_tvl_usd, 0))::float8 AS share
         FROM morpho_.protocol_tvl_daily m
         JOIN morpho_.chain_lending_tvl_daily l
           ON l.chain_slug = m.chain_slug AND l.snapshot_date = m.snapshot_date
         WHERE m.protocol_slug = 'morpho-blue'
           AND m.snapshot_date = $1::date
           AND m.chain_slug IN ('Base', 'Ethereum')
       ),
       ago AS (
         SELECT DISTINCT ON (m.chain_slug)
           m.chain_slug,
           (m.tvl_usd::numeric / NULLIF(l.lending_tvl_usd, 0))::float8 AS share
         FROM morpho_.protocol_tvl_daily m
         JOIN morpho_.chain_lending_tvl_daily l
           ON l.chain_slug = m.chain_slug AND l.snapshot_date = m.snapshot_date
         WHERE m.protocol_slug = 'morpho-blue'
           AND m.chain_slug IN ('Base', 'Ethereum')
           AND m.snapshot_date <= ($1::date - INTERVAL '365 days')
         ORDER BY m.chain_slug, m.snapshot_date DESC
       )
       SELECT latest.chain_slug, latest.share, ago.share AS share_12mo_ago
       FROM latest LEFT JOIN ago USING (chain_slug)`,
      [asOf],
    );

    const byChain = new Map<string, { share: number; share_12mo_ago: number | null }>();
    for (const r of rows.rows) {
      byChain.set(r.chain_slug, { share: r.share, share_12mo_ago: r.share_12mo_ago });
    }

    const parts: string[] = [];
    for (const slug of ['Base', 'Ethereum'] as const) {
      const v = byChain.get(slug);
      if (!v) continue;
      const ago = v.share_12mo_ago != null
        ? `vs ${pct1(v.share_12mo_ago)} 12 months ago`
        : 'no 12mo baseline';
      parts.push(`${slug}: ${pct1(v.share)} (${ago})`);
    }
    const subtitle = parts.join(' · ');

    console.log('\n--- Auto-generated chart subtitle ---\n');
    console.log(subtitle);
    console.log(`\n(as of ${asOf})\n`);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
