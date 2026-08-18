import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { config } from 'dotenv';
import ws from 'ws';

const __d = dirname(fileURLToPath(import.meta.url));
config({ path: join(__d, '..', '.env') });
neonConfig.webSocketConstructor = ws;

const slugs = ['morpho-blue', 'aave-v3', 'aave-v2', 'sparklend', 'compound-v3', 'compound-v2', 'fluid-lending', 'euler-v2'];
const f = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(0)}M`);

async function main() {
  const p = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await p.connect();
  try {
    const r = await c.query(
      `WITH ld AS (SELECT protocol_slug, MAX(snapshot_date) d FROM morpho_.protocol_tvl_daily WHERE protocol_slug=ANY($1) GROUP BY protocol_slug)
       SELECT t.protocol_slug, SUM(t.tvl_usd)::float8 tvl, SUM(COALESCE(t.borrowed_usd,0))::float8 bor,
         COUNT(*) FILTER (WHERE t.borrowed_usd IS NOT NULL) nb
       FROM morpho_.protocol_tvl_daily t JOIN ld ON ld.protocol_slug=t.protocol_slug AND ld.d=t.snapshot_date
       GROUP BY t.protocol_slug ORDER BY (SUM(t.tvl_usd)+SUM(COALESCE(t.borrowed_usd,0))) DESC`,
      [slugs],
    );
    console.log('=== sector latest: ranked by DEPOSITS (tvl + borrowed) ===');
    const ranked = r.rows.map((x) => ({ slug: x.protocol_slug, tvl: +x.tvl, bor: +x.bor, dep: +x.tvl + +x.bor, nb: x.nb }));
    ranked.forEach((x, i) => console.log(
      `  #${i + 1} ${x.slug.padEnd(14)} deposits ${f(x.dep).padStart(8)}  borrows ${f(x.bor).padStart(8)}  tvl ${f(x.tvl).padStart(8)}  [${x.nb} chain-rows w/ borrowed]`,
    ));
    const mi = ranked.findIndex((x) => x.slug === 'morpho-blue');
    for (const metric of ['dep', 'bor', 'tvl'] as const) {
      const s = [...ranked].sort((a, b) => b[metric] - a[metric]);
      const i = s.findIndex((x) => x.slug === 'morpho-blue');
      const above = i > 0 ? s[i - 1] : null;
      console.log(`  Morpho by ${metric}: rank #${i + 1}/${s.length}${above ? `, gap to ${above.slug} ${f(above[metric] - s[i].dep === 0 ? 0 : above[metric] - s[i][metric])}` : ''}`);
    }
    void mi;
  } finally {
    c.release(); await p.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
