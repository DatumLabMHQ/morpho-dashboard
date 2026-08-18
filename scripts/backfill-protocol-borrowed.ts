// One-off backfill: populate protocol_tvl_daily.borrowed_usd (active loans) from
// DefiLlama for every comparator protocol, 730d. Mirrors the defillama-tvl worker.
//   borrows (active loans) = chainTvls["{Chain}-borrowed"].tvl[].totalLiquidityUSD
//   deposits (supplied)    = net tvl + borrowed   (derived in the query layer)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config as loadEnv } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const COMPARATOR_SLUGS = [
  'morpho-blue', 'aave-v3', 'aave-v2', 'sparklend', 'compound-v3', 'compound-v2',
  'fluid-lending', 'euler-v2', 'sky-lending', 'liquity-v1', 'liquity-v2',
];
const NON_CHAIN = new Set(['borrowed', 'staking', 'pool2', 'treasury', 'offers', 'vesting']);
const isRealChainKey = (k: string) => !k.includes('-') && !NON_CHAIN.has(k);
const HISTORY_DAYS = 730;
const unixToDate = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  try {
    await c.query(`ALTER TABLE morpho_.protocol_tvl_daily ADD COLUMN IF NOT EXISTS borrowed_usd NUMERIC(38,2)`);
    const cutoffMs = Date.now() - HISTORY_DAYS * 86_400_000;

    for (const slug of COMPARATOR_SLUGS) {
      let detail: any;
      try {
        const res = await fetch(`https://api.llama.fi/protocol/${slug}`);
        if (!res.ok) { console.log(`  ${slug}: HTTP ${res.status} — skipped`); continue; }
        detail = await res.json();
      } catch (e) {
        console.log(`  ${slug}: fetch failed — ${(e as Error).message}`);
        continue;
      }
      const chainTvls = detail.chainTvls ?? {};

      // borrowed per "{Chain}|date"
      const borrowed = new Map<string, number>();
      for (const [k, data] of Object.entries<any>(chainTvls)) {
        const m = /^(.*)-borrowed$/.exec(k);
        if (!m || !isRealChainKey(m[1]) || !data?.tvl?.length) continue;
        for (const p of data.tvl) {
          if (p.date * 1000 < cutoffMs) continue;
          borrowed.set(`${m[1]}|${unixToDate(p.date)}`, p.totalLiquidityUSD);
        }
      }

      // rows keyed by slug|chain|date so duplicate datapoints (DefiLlama emits
      // multiple per UTC day) collapse to last-write-wins.
      const rowMap = new Map<string, [string, string, string, number, number | null]>();
      for (const [chainKey, data] of Object.entries<any>(chainTvls)) {
        if (!isRealChainKey(chainKey) || !data?.tvl?.length) continue;
        for (const p of data.tvl) {
          if (p.date * 1000 < cutoffMs) continue;
          const date = unixToDate(p.date);
          rowMap.set(`${slug}|${chainKey}|${date}`, [slug, chainKey, date, p.totalLiquidityUSD, borrowed.get(`${chainKey}|${date}`) ?? null]);
        }
      }
      const rows = [...rowMap.values()];

      // chunked upsert
      let written = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const vals: unknown[] = [];
        const ph = chunk.map((r, j) => {
          const b = j * 5;
          vals.push(r[0], r[1], r[2], r[3], r[4]);
          return `($${b + 1},$${b + 2},$${b + 3}::date,$${b + 4},$${b + 5})`;
        }).join(',');
        await c.query(
          `INSERT INTO morpho_.protocol_tvl_daily (protocol_slug, chain_slug, snapshot_date, tvl_usd, borrowed_usd)
           VALUES ${ph}
           ON CONFLICT (protocol_slug, chain_slug, snapshot_date)
           DO UPDATE SET tvl_usd = EXCLUDED.tvl_usd, borrowed_usd = EXCLUDED.borrowed_usd, recorded_at = NOW()`,
          vals,
        );
        written += chunk.length;
      }
      const borrowedRows = rows.filter((r) => r[4] != null).length;
      console.log(`  ${slug.padEnd(14)} ${written} rows (${borrowedRows} with borrowed)`);
    }

    // Sanity: latest aggregate per protocol.
    const chk = await c.query(`
      WITH ld AS (SELECT protocol_slug, MAX(snapshot_date) d FROM morpho_.protocol_tvl_daily GROUP BY protocol_slug)
      SELECT t.protocol_slug, SUM(t.tvl_usd)::float8 tvl, SUM(COALESCE(t.borrowed_usd,0))::float8 borrowed
      FROM morpho_.protocol_tvl_daily t JOIN ld ON ld.protocol_slug=t.protocol_slug AND ld.d=t.snapshot_date
      GROUP BY t.protocol_slug ORDER BY tvl DESC
    `);
    console.log('\n=== latest tvl / borrowed / deposits (tvl+borrowed) ===');
    for (const r of chk.rows) {
      const tvl = Number(r.tvl), bor = Number(r.borrowed);
      const f = (v: number) => v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(0)}M`;
      console.log(`  ${r.protocol_slug.padEnd(14)} tvl ${f(tvl).padStart(8)}  borrows ${f(bor).padStart(8)}  deposits ${f(tvl + bor).padStart(8)}`);
    }
  } finally {
    c.release(); await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
